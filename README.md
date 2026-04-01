# mcp-brain-tools

An MCP server that gives AI agents persistent memory with built-in freshness tracking and spaced repetition. Backed by Elasticsearch.

Unlike simple key-value memory stores, mcp-brain-tools tracks how old each piece of knowledge is, flags what needs review, and lets agents verify information to keep it fresh — inspired by how spaced repetition helps humans retain knowledge.

## Features

- **Spaced repetition freshness** — each entity has a review interval that doubles on verification (capped at 365 days). Confidence labels (fresh/normal/aging/stale/archival) tell agents what to trust.
- **Progressive search** — queries return fresh results first, automatically widening to include older data only when needed.
- **Observations as entities** — each observation gets its own freshness lifecycle, so "build is broken" (1-day review) and "founded in 2015" (365-day review) age independently.
- **Memory zones** — isolate knowledge by project, team, or domain.
- **AI-powered filtering** — optional Groq integration scores search results by relevance.
- **DRY by design** — tool descriptions guide agents not to store what's already in code, git, or docs.

## Setup

### Prerequisites

- Node.js >= 18
- Docker (for Elasticsearch) or a remote Elasticsearch instance

### Install and build

```bash
npm install
npm run build
```

### Start Elasticsearch

```bash
npm run es:start
```

Or point to your own instance via `ES_NODE` environment variable.

### Configure your MCP client

Add to your Claude Code, Claude Desktop, or other MCP client config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/mcp-brain-tools/dist/index.js"],
      "env": {
        "ES_NODE": "http://localhost:9200",
        "GROQ_API_KEY": "your-key-here"
      }
    }
  }
}
```

`GROQ_API_KEY` is optional — enables AI-powered search filtering and zone relevance scoring.

### Install the auto-memory hook (Claude Code only)

The memory hook runs on every user message and automatically injects relevant context — no agent cooperation needed.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/mcp-brain-tools/dist/memory-hook.js"
          }
        ]
      }
    ]
  }
}
```

The hook uses the same `ES_NODE`, `AI_API_KEY`/`GROQ_API_KEY`, `AI_API_BASE`, and `AI_MODEL` env vars (set them in the `env` block of your settings, or export them in your shell profile).

`AI_API_BASE` defaults to Groq's endpoint but accepts any OpenAI-compatible API URL.

## How it works

### Entities and observations

Entities represent anything worth remembering — people, projects, decisions, facts. Each entity has:

- A **name** and **type**
- **Spaced repetition fields**: `verifiedAt`, `reviewInterval`, `nextReviewAt`
- A **confidence label** computed from freshness: `1 - (daysSinceVerified / reviewInterval)`

Observations are stored as separate entities linked via `is_observation_of` relations. Each observation has its own review cadence:

```
Entity: "iaptic-server" (type: Project, reviewInterval: 30 days)
  <- "iaptic-server: uses TypeScript" (reviewInterval: 180 days)
  <- "iaptic-server: migration in progress" (reviewInterval: 7 days)
```

### Freshness lifecycle

1. **Entity created** — `confidence: "fresh"`, default review in 7 days
2. **Review date passes** — `confidence: "aging"`, `needsReview: true`
3. **Agent verifies** (via `verify_entity`) — interval doubles, confidence resets to fresh
4. **Long overdue** — `confidence: "stale"` then `"archival"`, excluded from default search

### Progressive search

When searching, the server uses three passes:

1. `freshness >= 0` — fresh and normal entities
2. `freshness >= -2` — adds aging and stale
3. No filter — adds archival

This keeps results clean while ensuring nothing is permanently lost.

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_entities` | Create entities with optional observations and reviewInterval |
| `update_entities` | Update existing entities |
| `delete_entities` | Delete entities (with optional cascade) |
| `add_observations` | Add observations as separate entities with own freshness |
| `verify_entity` | Confirm entity is still accurate, extend review interval |
| `search_nodes` | Search with progressive freshness filtering |
| `open_nodes` | Get specific entities by name with freshness metadata |
| `get_recent` | Get recently accessed entities |
| `create_relations` | Create relationships between entities |
| `delete_relations` | Remove relationships |
| `inspect_knowledge_graph` | AI-powered entity retrieval with tentative answers |
| `inspect_files` | AI-powered file content inspection |
| `list_zones` | List memory zones (with AI relevance scoring) |
| `create_zone` / `delete_zone` | Manage memory zones |
| `copy_entities` / `move_entities` | Transfer entities between zones |
| `merge_zones` | Merge zones with conflict resolution |
| `zone_stats` | Get entity/relation counts for a zone |
| `mark_important` | Boost entity relevance score |
| `get_time_utc` | Get current UTC time |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ES_NODE` | `http://localhost:9200` | Elasticsearch URL |
| `ES_USERNAME` | — | Elasticsearch username |
| `ES_PASSWORD` | — | Elasticsearch password |
| `GROQ_API_KEY` | — | Groq API key for AI filtering |
| `GROQ_MODELS` | `openai/gpt-oss-120b,llama-3.3-70b-versatile` | Comma-separated model list |
| `KG_INDEX_PREFIX` | `knowledge-graph` | Elasticsearch index prefix |
| `KG_DEFAULT_ZONE` | `default` | Default memory zone |
| `DEBUG` | `false` | Enable debug logging |

## Recommended agent instructions

For agents to actively use the memory server, add something like this to your `CLAUDE.md` (or equivalent instructions file):

```markdown
## Memory

Use MCP Memory (`mcp__memory__*` tools) — a shared knowledge graph across all agents, projects, and computers.

**When to SAVE (immediately, before moving on):**
- Something you tried didn't work (non-transient) → save what failed and why, so no agent repeats it
- A decision was made (architectural, design, workflow) → save the decision and the reason
- The user corrects you or gives explicit instructions → save the rule
- You learn something non-obvious that took effort to discover → save it

**When to SEARCH (before starting, not after failing):**
- **At the start of every non-trivial task** — search before thinking, not after hitting a wall
- About to try an approach that might have been attempted before → search first
- User references something from a past session → search before asking

**Rules:**
- Skip anything easy to find in code, git log, or docs
- Use the project name as the zone for project-specific knowledge; `default` for general knowledge
- Keep entries short — the AI filters server-side, so be generous rather than selective
- Short `reviewInterval` (e.g. 3–7 days) for volatile facts; longer (30–180) for stable ones
```

The key insight: agents need explicit trigger-based instructions ("when X, do Y"), not just descriptions of what the tool does.

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode
npm run test:jest      # Run Jest tests
npm run es:start       # Start Elasticsearch
npm run es:stop        # Stop Elasticsearch
npm run es:reset       # Wipe data and restart
npm run import         # Import from JSON
npm run export         # Export to JSON
```

## License

MIT
