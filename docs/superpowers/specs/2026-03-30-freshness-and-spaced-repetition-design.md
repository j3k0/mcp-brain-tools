# Freshness & Spaced Repetition for MCP Elastic Memory

## Problem

After restoring from a backup or simply over time, knowledge graph entities
become stale. The server currently treats a 2-year-old observation identically
to one written moments ago. Agents have no signal to distinguish trusted
information from outdated claims, leading to confident recommendations based on
facts that may no longer be true.

Inspired by Claude Code's built-in memory handling — which treats memory as
"what was believed true at a point in time" and requires verification before
acting — this design adds freshness tracking, spaced repetition, and behavioral
guidance to the MCP memory server.

## Design Principles

1. **Freshness is a first-class concept.** Every entity carries a computed
   freshness coefficient that agents see in search results.
2. **Verification is explicit.** Writing to an entity is not the same as
   confirming it's still true. A dedicated `verify_entity` tool signals
   intentional validation and extends the review interval.
3. **Spaced repetition governs review cadence.** Information that gets
   repeatedly verified earns longer intervals. Unverified information surfaces
   for review sooner.
4. **Progressive search depth.** Default queries return fresh entities.
   If nothing is found, the server automatically widens to include aging and
   archival data — so nothing valuable is permanently lost.
5. **DRY — don't store what you can derive.** Memory is for context, decisions,
   and knowledge that isn't in source code, git history, or documentation.
6. **Observations are entities.** Each observation gets its own freshness
   lifecycle, enabling per-fact review intervals.

## Data Model Changes

### New Fields on ESEntity

```typescript
interface ESEntity {
  // Existing fields
  name: string;
  entityType: string;
  lastRead: string;           // ISO timestamp
  lastWrite: string;          // ISO timestamp
  readCount: number;
  relevanceScore: number;
  zone?: string;

  // New spaced repetition fields
  verifiedAt: string;         // ISO timestamp — last explicit verification
  verifyCount: number;        // times explicitly verified (starts at 0)
  reviewInterval: number;     // days until next review (default: 7, max: 365)
  nextReviewAt: string;       // ISO timestamp — verifiedAt + reviewInterval
}
```

The `observations: string[]` field is **removed from storage**. Observations
become entities (see below).

### Defaults for New Entities

| Field            | Default                          |
|------------------|----------------------------------|
| `verifiedAt`     | creation time                    |
| `verifyCount`    | 0                                |
| `reviewInterval` | 7 days (overridable at creation) |
| `nextReviewAt`   | creation time + reviewInterval   |

### On Verification

- `verifiedAt` = now
- `verifyCount` += 1
- `reviewInterval` = min(current * 2, 365) — unless explicitly overridden
- `nextReviewAt` = now + new reviewInterval

### Elasticsearch Mapping Additions

New fields added to the existing mapping:

- `verifiedAt`: date
- `verifyCount`: integer
- `reviewInterval`: integer (days)
- `nextReviewAt`: date

## Freshness Coefficient

Computed at query time, never stored:

```
freshness = 1 - (daysSinceVerified / reviewInterval)
```

Where `daysSinceVerified = (now - verifiedAt)` in days.

### Examples

| Scenario                              | freshness |
|---------------------------------------|-----------|
| Just verified, interval = 30 days     | 1.0       |
| 15 days since verify, interval = 30   | 0.5       |
| At review date (30/30)                | 0.0       |
| 30 days overdue (60/30)               | -1.0      |
| 60 days overdue (90/30)               | -2.0      |

## Confidence Labels

Instead of exposing the raw freshness number, the server maps it to
human-readable labels that agents can act on immediately:

| Freshness range | Label       | Agent guidance                    |
|-----------------|-------------|-----------------------------------|
| >= 0.5          | `fresh`     | Trust it                          |
| >= 0            | `normal`    | Use it, review if critical        |
| >= -1           | `aging`     | Verify before acting on it        |
| >= -2           | `stale`     | Treat as a lead, not a fact       |
| < -2            | `archival`  | Useful as historical context only |

## Search Behavior — Progressive Depth

### Default Search (`search_nodes`, `inspect_knowledge_graph`)

Three-pass strategy:

1. **Pass 1:** `freshness >= 0` — returns `fresh` and `normal` entities
2. **Pass 2:** `freshness >= -2` — adds `aging` and `stale` entities
3. **Pass 3:** no freshness filter — adds `archival` entities

Each pass only executes if the previous returned zero results.

### Search Result Metadata (per entity)

```json
{
  "name": "iaptic-server",
  "entityType": "Project",
  "confidence": "aging",
  "needsReview": true,
  "daysSinceLastWrite": 142
}
```

- `confidence` — always present
- `needsReview` — only present when `true` (freshness < 0)
- `daysSinceLastWrite` — raw number, useful for `git log --since`

### Per-Tool Behavior

| Tool                       | Freshness filtering          | Staleness metadata |
|----------------------------|------------------------------|--------------------|
| `search_nodes`             | Progressive (3-pass)         | Yes                |
| `inspect_knowledge_graph`  | Progressive (3-pass)         | Yes                |
| `open_nodes`               | No filter (explicit lookup)  | Yes                |
| `get_recent`               | No filter (access-pattern)   | Yes                |

## Observations as Entities

### Motivation

With per-entity freshness tracking, observations stored as `string[]` become a
limitation: "my name is Jean-Christophe" and "build is broken" on the same
entity can't have different review intervals. Promoting observations to entities
solves this.

### How It Works

**On `add_observations("iaptic-server", ["uses TypeScript"])`:**

1. Create an entity:
   ```json
   {
     "name": "iaptic-server: uses TypeScript",
     "entityType": "observation",
     "reviewInterval": 7
   }
   ```
2. Create a relation:
   ```json
   {
     "from": "iaptic-server: uses TypeScript",
     "to": "iaptic-server",
     "relationType": "is_observation_of"
   }
   ```

**Naming convention:** `"parent-name: observation text"`

**On entity retrieval (`open_nodes`, `search_nodes` with observations):**

1. Fetch the entity
2. Query all entities with `is_observation_of` relation to it
3. Assemble in the response with per-observation freshness:

```json
{
  "name": "iaptic-server",
  "entityType": "Project",
  "confidence": "fresh",
  "observations": [
    { "name": "iaptic-server: uses TypeScript", "confidence": "normal" },
    { "name": "iaptic-server: build is broken", "confidence": "stale", "needsReview": true }
  ]
}
```

### Impact

- The `observations: string[]` field is removed from ES storage
- The `add_observations` API is preserved — callers don't need to change
- Each observation gets its own freshness lifecycle
- Observation entities are searchable independently

## New Tool: `verify_entity`

### Purpose

Explicit signal that an agent has checked and confirmed an entity's information
is still accurate.

### Parameters

```typescript
{
  name: string;            // entity to verify
  memory_zone: string;     // zone it lives in
  reviewInterval?: number; // optional override in days
}
```

### Behavior

- `verifiedAt` = now
- `verifyCount` += 1
- `reviewInterval` = override if provided, otherwise min(current * 2, 365)
- `nextReviewAt` = now + reviewInterval

### Returns

```json
{
  "success": true,
  "entity": {
    "name": "iaptic-server",
    "confidence": "fresh",
    "reviewInterval": 28,
    "nextReviewAt": "2026-04-27T..."
  }
}
```

### When to Call

- After confirming a `needsReview` entity is still accurate
- After using information from memory and finding it correct
- During periodic memory maintenance sweeps
- Set `reviewInterval` based on content volatility:
  - Stable facts (names, architecture decisions): 180-365 days
  - Project state (current sprint, team assignments): 14-30 days
  - Volatile state (build status, active bugs): 1-7 days

### When NOT to Call

- If the information is wrong — use `update_entities` or `delete_entities`
- If you haven't actually checked — verification must be genuine

## Modified Tools

### `create_entities`

New optional parameter: `reviewInterval` (number, days). Allows agents to set
the initial review cadence based on content nature at creation time.

### `add_observations`

Internal behavior changes: creates observation entities with
`"parent: observation text"` naming and `is_observation_of` relations. The API
signature is unchanged.

New optional parameter: `reviewInterval` (number, days). Applied to each
created observation entity.

## Tool Description Guidance

### On `search_nodes` / `inspect_knowledge_graph`

> Memory records can become stale. Check the `confidence` and `needsReview`
> fields on returned entities. For `aging` or `stale` results, verify before
> acting — e.g., use `git log --since` to check if the underlying reality has
> changed. If confirmed still valid, call `verify_entity` to refresh the review
> clock. If wrong, update or delete the entity.

### On `create_entities` / `add_observations`

> Do not store information that can be derived from source code, git history,
> or documentation. Memory is for context, decisions, and knowledge that isn't
> in the codebase. Ask: "would reading the code or running git log give me
> this?" If yes, don't store it. Set `reviewInterval` based on how quickly the
> information is likely to change.

### On `verify_entity`

> Call this after confirming an entity's information is still accurate. Set
> `reviewInterval` based on content volatility — stable facts (names,
> architecture decisions) deserve long intervals (180-365 days), volatile state
> (build status, current bugs) deserves short ones (1-7 days). If the
> information is wrong, use `update_entities` or `delete_entities` instead.

### General (all tools)

> Treat memory as "what was believed true at a point in time." Trust current
> observations (code, logs, git) over recalled memory when they conflict. Update
> or remove stale memories rather than acting on them.

## Migration

No migration needed. The existing database will be dropped and recreated with
the new schema. All zones start fresh.
