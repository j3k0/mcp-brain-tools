# Freshness & Spaced Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add freshness tracking, spaced repetition verification, progressive search depth, and observations-as-entities to the MCP elastic memory server.

**Architecture:** Entities gain spaced repetition fields (`verifiedAt`, `verifyCount`, `reviewInterval`, `nextReviewAt`). A freshness coefficient is computed at query time: `1 - (daysSinceVerified / reviewInterval)`. Search uses progressive depth (fresh first, then wider). Observations become entities linked via `is_observation_of` relations. A new `verify_entity` tool enables explicit verification. Tool descriptions encode DRY and staleness guidance.

**Tech Stack:** TypeScript, Elasticsearch 8, MCP SDK, Jest

**Spec:** `docs/superpowers/specs/2026-03-30-freshness-and-spaced-repetition-design.md`

---

### Task 1: Update Data Model — ESEntity Interface & ES Mappings

**Files:**
- Modify: `src/es-types.ts:20-74`

- [ ] **Step 1: Write the failing test**

Create `tests/freshness.test.ts`:

```typescript
import { KnowledgeGraphClient } from '../src/kg-client.js';

const TEST_ES_NODE = process.env.TEST_ES_NODE || 'http://localhost:9200';
const TEST_ZONE = 'test-freshness';

describe('Freshness & Spaced Repetition', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = new KnowledgeGraphClient({ node: TEST_ES_NODE });
    await client.addMemoryZone(TEST_ZONE, 'Freshness test zone');
  });

  afterAll(async () => {
    await client.deleteMemoryZone(TEST_ZONE);
  });

  describe('Entity creation with spaced repetition fields', () => {
    it('should create entity with default spaced repetition fields', async () => {
      const entity = await client.saveEntity({
        name: 'test-sr-defaults',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      expect(entity.verifiedAt).toBeDefined();
      expect(entity.verifyCount).toBe(0);
      expect(entity.reviewInterval).toBe(7);
      expect(entity.nextReviewAt).toBeDefined();

      // nextReviewAt should be ~7 days after verifiedAt
      const verified = new Date(entity.verifiedAt).getTime();
      const nextReview = new Date(entity.nextReviewAt).getTime();
      const diffDays = (nextReview - verified) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it('should accept custom reviewInterval at creation', async () => {
      const entity = await client.saveEntity({
        name: 'test-sr-custom-interval',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 365,
      }, TEST_ZONE);

      expect(entity.reviewInterval).toBe(365);
      const verified = new Date(entity.verifiedAt).getTime();
      const nextReview = new Date(entity.nextReviewAt).getTime();
      const diffDays = (nextReview - verified) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(365, 0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/freshness.test.ts --no-cache -t "should create entity with default spaced repetition fields" 2>&1 | tail -20`
Expected: FAIL — `verifiedAt` is undefined on the returned entity.

- [ ] **Step 3: Add spaced repetition fields to ESEntity interface**

In `src/es-types.ts`, replace the `ESEntity` interface (lines 63-74) with:

```typescript
// Entity document type
export interface ESEntity {
  type: 'entity';
  name: string;
  entityType: string;
  observations: string[];
  lastRead: string;
  lastWrite: string;
  readCount: number;
  relevanceScore: number;
  zone?: string; // The memory zone this entity belongs to

  // Spaced repetition fields
  verifiedAt: string;       // ISO timestamp — last explicit verification (initialized to creation time)
  verifyCount: number;      // how many times explicitly verified (starts at 0)
  reviewInterval: number;   // days until next review (default: 7, doubles on verify, capped at 365)
  nextReviewAt: string;     // ISO timestamp — verifiedAt + reviewInterval days
}
```

- [ ] **Step 4: Add spaced repetition fields to ES index mappings**

In `src/es-types.ts`, inside the `mappings.properties` object in `KG_INDEX_CONFIG` (after line 53, `relevanceScore`), add:

```typescript
      // Spaced repetition fields
      verifiedAt: { type: 'date' },
      verifyCount: { type: 'integer' },
      reviewInterval: { type: 'integer' },
      nextReviewAt: { type: 'date' },
```

- [ ] **Step 5: Update saveEntity to populate spaced repetition fields**

In `src/kg-client.ts`, in the `saveEntity` method (around lines 169-183), update the entity construction to include spaced repetition fields. Replace the `newEntity` construction block:

```typescript
    const now = new Date().toISOString();
    const existingEntity = await this.getEntity(entity.name, actualZone);

    // Calculate nextReviewAt from reviewInterval
    const reviewInterval = entity.reviewInterval ?? (existingEntity?.reviewInterval ?? 7);
    const verifiedAt = existingEntity?.verifiedAt ?? now;
    const nextReviewDate = new Date(verifiedAt);
    nextReviewDate.setDate(nextReviewDate.getDate() + reviewInterval);

    const newEntity: ESEntity = {
      type: 'entity',
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [],
      readCount: existingEntity?.readCount ?? 0,
      lastRead: existingEntity?.lastRead ?? now,
      lastWrite: now,
      relevanceScore: entity.relevanceScore ?? (existingEntity?.relevanceScore ?? 1.0),
      zone: actualZone,
      // Spaced repetition: preserve existing values or set defaults
      verifiedAt: verifiedAt,
      verifyCount: existingEntity?.verifyCount ?? 0,
      reviewInterval: reviewInterval,
      nextReviewAt: existingEntity?.nextReviewAt ?? nextReviewDate.toISOString(),
    };
```

Also update the `Omit` type in the `saveEntity` signature (line 144) to include the new auto-generated fields but allow `reviewInterval` as optional input:

```typescript
  async saveEntity(
    entity: Omit<ESEntity, 'type' | 'readCount' | 'lastRead' | 'lastWrite' | 'zone' | 'verifiedAt' | 'verifyCount' | 'nextReviewAt'> & { reviewInterval?: number },
    zone?: string,
    options?: {
      validateZones?: boolean;
    }
  ): Promise<ESEntity> {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/freshness.test.ts --no-cache 2>&1 | tail -20`
Expected: PASS — both tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/es-types.ts src/kg-client.ts tests/freshness.test.ts
git commit -m "freshness: add spaced repetition fields to ESEntity data model

Add verifiedAt, verifyCount, reviewInterval, and nextReviewAt fields to the
ESEntity interface and Elasticsearch index mappings. saveEntity now initializes
these fields on creation (default reviewInterval: 7 days) and preserves them
on update. Callers can pass a custom reviewInterval at creation time.

This is the data model foundation for the freshness & spaced repetition
feature, which will enable agents to distinguish trusted information from
stale claims."
```

---

### Task 2: Freshness Computation Utility

**Files:**
- Create: `src/freshness.ts`
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/freshness.test.ts`:

```typescript
import { computeFreshness, getConfidenceLabel } from '../src/freshness.js';

describe('Freshness computation', () => {
  it('should return 1.0 for just-verified entity', () => {
    const now = new Date();
    expect(computeFreshness(now.toISOString(), 7)).toBeCloseTo(1.0, 1);
  });

  it('should return 0.0 at exactly review date', () => {
    const now = new Date();
    const verifiedAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    expect(computeFreshness(verifiedAt.toISOString(), 7)).toBeCloseTo(0.0, 1);
  });

  it('should return -1.0 when one interval overdue', () => {
    const now = new Date();
    const verifiedAt = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
    expect(computeFreshness(verifiedAt.toISOString(), 7)).toBeCloseTo(-1.0, 1);
  });

  it('should return -2.0 when two intervals overdue', () => {
    const now = new Date();
    const verifiedAt = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000); // 21 days ago
    expect(computeFreshness(verifiedAt.toISOString(), 7)).toBeCloseTo(-2.0, 1);
  });
});

describe('Confidence labels', () => {
  it('should return "fresh" for freshness >= 0.5', () => {
    expect(getConfidenceLabel(0.8)).toBe('fresh');
    expect(getConfidenceLabel(0.5)).toBe('fresh');
  });

  it('should return "normal" for freshness >= 0 but < 0.5', () => {
    expect(getConfidenceLabel(0.3)).toBe('normal');
    expect(getConfidenceLabel(0.0)).toBe('normal');
  });

  it('should return "aging" for freshness >= -1 but < 0', () => {
    expect(getConfidenceLabel(-0.5)).toBe('aging');
    expect(getConfidenceLabel(-1.0)).toBe('aging');
  });

  it('should return "stale" for freshness >= -2 but < -1', () => {
    expect(getConfidenceLabel(-1.5)).toBe('stale');
    expect(getConfidenceLabel(-2.0)).toBe('stale');
  });

  it('should return "archival" for freshness < -2', () => {
    expect(getConfidenceLabel(-2.1)).toBe('archival');
    expect(getConfidenceLabel(-5.0)).toBe('archival');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/freshness.test.ts --no-cache -t "Freshness computation" 2>&1 | tail -20`
Expected: FAIL — module `../src/freshness.js` not found.

- [ ] **Step 3: Implement freshness utility**

Create `src/freshness.ts`:

```typescript
/**
 * Freshness computation for spaced repetition.
 *
 * freshness = 1 - (daysSinceVerified / reviewInterval)
 *
 *   1.0  → just verified
 *   0.0  → exactly at review date
 *  -1.0  → one full interval overdue
 *  -2.0  → two intervals overdue
 */

export type ConfidenceLabel = 'fresh' | 'normal' | 'aging' | 'stale' | 'archival';

/**
 * Compute the freshness coefficient for an entity.
 */
export function computeFreshness(verifiedAt: string, reviewInterval: number): number {
  const now = Date.now();
  const verified = new Date(verifiedAt).getTime();
  const daysSinceVerified = (now - verified) / (1000 * 60 * 60 * 24);
  return 1 - (daysSinceVerified / reviewInterval);
}

/**
 * Map a freshness value to a human-readable confidence label.
 *
 * | Freshness range | Label     |
 * |-----------------|-----------|
 * | >= 0.5          | fresh     |
 * | >= 0            | normal    |
 * | >= -1           | aging     |
 * | >= -2           | stale     |
 * | < -2            | archival  |
 */
export function getConfidenceLabel(freshness: number): ConfidenceLabel {
  if (freshness >= 0.5) return 'fresh';
  if (freshness >= 0) return 'normal';
  if (freshness >= -1) return 'aging';
  if (freshness >= -2) return 'stale';
  return 'archival';
}

/**
 * Compute staleness metadata for a single entity.
 * Returns the fields to be merged into search results.
 */
export function computeStalenessMetadata(entity: {
  verifiedAt: string;
  reviewInterval: number;
  lastWrite: string;
}): {
  confidence: ConfidenceLabel;
  needsReview?: true;
  daysSinceLastWrite: number;
} {
  const freshness = computeFreshness(entity.verifiedAt, entity.reviewInterval);
  const label = getConfidenceLabel(freshness);
  const daysSinceLastWrite = Math.floor(
    (Date.now() - new Date(entity.lastWrite).getTime()) / (1000 * 60 * 60 * 24)
  );

  const result: {
    confidence: ConfidenceLabel;
    needsReview?: true;
    daysSinceLastWrite: number;
  } = {
    confidence: label,
    daysSinceLastWrite,
  };

  if (freshness < 0) {
    result.needsReview = true;
  }

  return result;
}
```

- [ ] **Step 4: Build to compile the new file**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiles successfully.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/freshness.test.ts --no-cache 2>&1 | tail -30`
Expected: PASS — all freshness computation and confidence label tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/freshness.ts tests/freshness.test.ts
git commit -m "freshness: add freshness coefficient computation utility

Implements the core freshness formula: 1 - (daysSinceVerified / reviewInterval).
Maps freshness values to confidence labels (fresh/normal/aging/stale/archival).
Provides computeStalenessMetadata() for enriching search results with confidence,
needsReview (only when true), and daysSinceLastWrite."
```

---

### Task 3: Add `verify_entity` to KnowledgeGraphClient

**Files:**
- Modify: `src/kg-client.ts`
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('verify_entity', () => {
    it('should update verification fields and double the review interval', async () => {
      // Create entity with 7-day interval
      await client.saveEntity({
        name: 'test-verify',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      const verified = await client.verifyEntity('test-verify', TEST_ZONE);

      expect(verified.verifyCount).toBe(1);
      expect(verified.reviewInterval).toBe(14); // doubled from 7
      expect(verified.verifiedAt).toBeDefined();

      // nextReviewAt should be ~14 days from now
      const now = Date.now();
      const nextReview = new Date(verified.nextReviewAt).getTime();
      const diffDays = (nextReview - now) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(14, 0);
    });

    it('should accept a custom reviewInterval override', async () => {
      await client.saveEntity({
        name: 'test-verify-override',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      const verified = await client.verifyEntity('test-verify-override', TEST_ZONE, {
        reviewInterval: 365,
      });

      expect(verified.reviewInterval).toBe(365);
    });

    it('should cap review interval at 365 days', async () => {
      await client.saveEntity({
        name: 'test-verify-cap',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 200,
      }, TEST_ZONE);

      const verified = await client.verifyEntity('test-verify-cap', TEST_ZONE);

      // 200 * 2 = 400, capped at 365
      expect(verified.reviewInterval).toBe(365);
    });

    it('should throw if entity does not exist', async () => {
      await expect(
        client.verifyEntity('nonexistent-entity', TEST_ZONE)
      ).rejects.toThrow('not found');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/freshness.test.ts --no-cache -t "verify_entity" 2>&1 | tail -20`
Expected: FAIL — `client.verifyEntity` is not a function.

- [ ] **Step 3: Implement verifyEntity in KnowledgeGraphClient**

Add this method to `src/kg-client.ts`, after the `addObservations` method (after line 1746):

```typescript
  /**
   * Verify an entity — confirm its information is still accurate.
   * Extends the review interval via spaced repetition (doubles, capped at 365 days).
   * @param name Entity name
   * @param zone Optional memory zone
   * @param options Optional overrides
   * @param options.reviewInterval Override the review interval instead of doubling
   */
  async verifyEntity(
    name: string,
    zone?: string,
    options?: { reviewInterval?: number }
  ): Promise<ESEntity> {
    const actualZone = zone || this.defaultZone;

    const entity = await this.getEntityWithoutUpdatingLastRead(name, actualZone);
    if (!entity) {
      throw new Error(`Entity "${name}" not found in zone "${actualZone}"`);
    }

    const now = new Date();
    const newInterval = options?.reviewInterval
      ?? Math.min(entity.reviewInterval * 2, 365);
    const nextReviewDate = new Date(now);
    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    const indexName = this.getIndexForZone(actualZone);
    const docId = `entity:${name}`;

    const updatedFields = {
      verifiedAt: now.toISOString(),
      verifyCount: entity.verifyCount + 1,
      reviewInterval: newInterval,
      nextReviewAt: nextReviewDate.toISOString(),
      lastWrite: now.toISOString(),
    };

    await this.client.update({
      index: indexName,
      id: docId,
      doc: updatedFields,
      refresh: true,
    });

    return { ...entity, ...updatedFields };
  }
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build 2>&1 | tail -5 && npx jest tests/freshness.test.ts --no-cache -t "verify_entity" 2>&1 | tail -20`
Expected: PASS — all verify_entity tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/kg-client.ts tests/freshness.test.ts
git commit -m "freshness: add verifyEntity method to KnowledgeGraphClient

Implements explicit entity verification with spaced repetition. On each
verification: verifyCount increments, reviewInterval doubles (capped at 365),
verifiedAt resets to now, and nextReviewAt is computed from the new interval.
Callers can override reviewInterval for content-appropriate cadences (e.g.,
365 for stable facts, 1 for volatile state)."
```

---

### Task 4: Progressive Search with Freshness Filtering

**Files:**
- Modify: `src/kg-client.ts` (the `userSearch` method, lines 2328-2479)
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('Progressive search with freshness', () => {
    beforeAll(async () => {
      // Create a fresh entity (just created = fresh)
      await client.saveEntity({
        name: 'test-search-fresh',
        entityType: 'concept',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      // Create an entity that simulates being overdue for review
      // We do this by saving with a very short reviewInterval then manipulating timestamps
      const overdueEntity = await client.saveEntity({
        name: 'test-search-stale',
        entityType: 'concept',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 1, // 1 day interval
      }, TEST_ZONE);

      // Manually backdate verifiedAt to make it stale (30 days ago)
      const esClient = (client as any).client; // access internal ES client
      const indexName = `knowledge-graph@${TEST_ZONE}`;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await esClient.update({
        index: indexName,
        id: `entity:test-search-stale`,
        doc: {
          verifiedAt: thirtyDaysAgo,
          nextReviewAt: new Date(new Date(thirtyDaysAgo).getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        refresh: true,
      });
    });

    it('should include confidence and needsReview in search results', async () => {
      const results = await client.userSearch({
        query: 'test-search-fresh',
        zone: TEST_ZONE,
      });

      const freshEntity = results.entities.find(e => e.name === 'test-search-fresh');
      expect(freshEntity).toBeDefined();
      expect(freshEntity!.confidence).toBe('fresh');
      expect(freshEntity!.needsReview).toBeUndefined();
    });

    it('should include daysSinceLastWrite in search results', async () => {
      const results = await client.userSearch({
        query: 'test-search-fresh',
        zone: TEST_ZONE,
      });

      const freshEntity = results.entities.find(e => e.name === 'test-search-fresh');
      expect(freshEntity).toBeDefined();
      expect(typeof freshEntity!.daysSinceLastWrite).toBe('number');
      expect(freshEntity!.daysSinceLastWrite).toBeLessThan(1);
    });

    it('should find stale entities via progressive widening when no fresh results', async () => {
      // Search for something only the stale entity matches
      const results = await client.userSearch({
        query: 'test-search-stale',
        zone: TEST_ZONE,
      });

      const staleEntity = results.entities.find(e => e.name === 'test-search-stale');
      expect(staleEntity).toBeDefined();
      expect(staleEntity!.needsReview).toBe(true);
      // Freshness < -2 since 30 days overdue on 1-day interval
      expect(staleEntity!.confidence).toBe('archival');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/freshness.test.ts --no-cache -t "Progressive search" 2>&1 | tail -20`
Expected: FAIL — `confidence` is undefined on search results.

- [ ] **Step 3: Update userSearch return type**

In `src/kg-client.ts`, update the `userSearch` method return type (around line 2337) to include freshness metadata:

```typescript
  async userSearch(params: {
    query: string;
    entityTypes?: string[];
    limit?: number;
    includeObservations?: boolean;
    sortBy?: 'relevance' | 'recent' | 'importance';
    zone?: string;
    informationNeeded?: string;
    reason?: string;
  }): Promise<{
    entities: Array<{
      name: string;
      entityType: string;
      observations?: string[];
      lastRead?: string;
      lastWrite?: string;
      confidence: string;
      needsReview?: true;
      daysSinceLastWrite: number;
    }>;
    relations: Array<{
      from: string;
      to: string;
      type: string;
      fromZone: string;
      toZone: string;
    }>;
  }> {
```

- [ ] **Step 4: Add freshness import to kg-client.ts**

At the top of `src/kg-client.ts` (after the existing imports, around line 28):

```typescript
import { computeStalenessMetadata } from './freshness.js';
```

- [ ] **Step 5: Implement progressive search and freshness enrichment**

Replace the entity mapping block in `userSearch` (lines 2382-2404) with freshness-enriched mapping and progressive search logic. The key changes:

1. After the raw search at line 2379, add freshness filtering with progressive widening.
2. In the entity mapping (lines 2384-2404), enrich each entity with staleness metadata.

Replace the block from `// Transform the results` (line 2381) through the `return entity;` and closing `});` of the map (line 2404):

```typescript
    // Transform results and enrich with freshness metadata
    const allEntities = results.hits.hits
      .filter(hit => hit._source.type === 'entity')
      .map(hit => {
        const src = hit._source as ESEntity;
        const staleness = computeStalenessMetadata(src);

        const entity: {
          name: string;
          entityType: string;
          observations?: string[];
          lastRead?: string;
          lastWrite?: string;
          confidence: string;
          needsReview?: true;
          daysSinceLastWrite: number;
          _freshness: number; // internal, stripped before return
        } = {
          name: src.name,
          entityType: src.entityType,
          confidence: staleness.confidence,
          daysSinceLastWrite: staleness.daysSinceLastWrite,
          _freshness: 1 - ((Date.now() - new Date(src.verifiedAt).getTime()) / (1000 * 60 * 60 * 24) / src.reviewInterval),
        };

        if (staleness.needsReview) {
          entity.needsReview = true;
        }

        if (includeObservations) {
          entity.observations = src.observations;
          entity.lastWrite = src.lastWrite;
          entity.lastRead = src.lastRead;
        }

        return entity;
      });

    // Progressive freshness filtering:
    //   Pass 1: freshness >= 0 (fresh + normal)
    //   Pass 2: freshness >= -2 (adds aging + stale)
    //   Pass 3: no filter (adds archival)
    const thresholds = [0, -2, -Infinity];
    let entities: typeof allEntities = [];
    for (const threshold of thresholds) {
      entities = allEntities.filter(e => e._freshness >= threshold);
      if (entities.length > 0) break;
    }
```

**Important integration note:** The existing AI filtering block (lines 2406-2460) references `entities`. After this change, the progressive-filtered result is also called `entities`. The AI filtering block must operate on the progressive-filtered `entities` (not `allEntities`). The flow should be:

1. Raw ES search → `allEntities` (with `_freshness`)
2. Progressive freshness filter → `entities`
3. AI filtering → `filteredEntities`
4. Strip `_freshness` → return

At the end of the method, strip `_freshness` before returning:

```typescript
    // Strip internal fields before returning
    const cleanEntities = filteredEntities.map(({ _freshness, ...rest }) => rest);

    return {
      entities: cleanEntities,
      relations: formattedRelations
    };
```

- [ ] **Step 6: Build and run tests**

Run: `npm run build 2>&1 | tail -10 && npx jest tests/freshness.test.ts --no-cache 2>&1 | tail -30`
Expected: PASS — progressive search tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/kg-client.ts tests/freshness.test.ts
git commit -m "freshness: progressive search with freshness filtering and metadata

Search results now include confidence label (fresh/normal/aging/stale/archival),
needsReview boolean (omitted when false), and daysSinceLastWrite. Queries use
progressive depth: first pass returns only fresh+normal entities (freshness >= 0),
widening to aging+stale (>= -2), then archival (no filter) if no results found."
```

---

### Task 5: Freshness Metadata in open_nodes and get_recent

**Files:**
- Modify: `src/index.ts` (open_nodes handler ~997-1031, get_recent handler ~1082-1097)
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('Freshness metadata in open_nodes', () => {
    it('should include confidence on opened entities', async () => {
      await client.saveEntity({
        name: 'test-open-freshness',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      // Use getEntity and check it has the spaced repetition fields
      const entity = await client.getEntity('test-open-freshness', TEST_ZONE);
      expect(entity).toBeDefined();
      expect(entity!.verifiedAt).toBeDefined();
      expect(entity!.reviewInterval).toBe(7);
    });
  });
```

- [ ] **Step 2: Run test to verify it passes** (this is a sanity check that getEntity returns SR fields)

Run: `npx jest tests/freshness.test.ts --no-cache -t "Freshness metadata in open_nodes" 2>&1 | tail -20`
Expected: PASS — the underlying data is correct.

- [ ] **Step 3: Update open_nodes handler to include staleness metadata**

In `src/index.ts`, add the freshness import at the top (after existing imports, around line 16):

```typescript
import { computeStalenessMetadata } from './freshness.js';
```

Update the `open_nodes` handler (lines 997-1031). Replace the entity formatting block:

```typescript
      // Format entities with freshness metadata
      const formattedEntities = entities.map(e => {
        const staleness = computeStalenessMetadata(e);
        const result: any = {
          name: e.name,
          entityType: e.entityType,
          observations: e.observations,
          confidence: staleness.confidence,
          daysSinceLastWrite: staleness.daysSinceLastWrite,
        };
        if (staleness.needsReview) {
          result.needsReview = true;
        }
        return result;
      });
```

- [ ] **Step 4: Update get_recent handler to include staleness metadata**

Update the `get_recent` handler (lines 1082-1097). Replace the entity formatting:

```typescript
      return formatResponse({
        entities: recentEntities.map(e => {
          const staleness = computeStalenessMetadata(e);
          const result: any = {
            name: e.name,
            entityType: e.entityType,
            observations: e.observations,
            confidence: staleness.confidence,
            daysSinceLastWrite: staleness.daysSinceLastWrite,
          };
          if (staleness.needsReview) {
            result.needsReview = true;
          }
          return result;
        }),
        total: recentEntities.length
      });
```

- [ ] **Step 5: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/freshness.test.ts
git commit -m "freshness: add staleness metadata to open_nodes and get_recent responses

Both handlers now enrich entity results with confidence label, needsReview
(only when true), and daysSinceLastWrite. open_nodes always returns entities
regardless of freshness (explicit lookups are not filtered), but includes the
metadata so agents can assess trustworthiness."
```

---

### Task 6: Observations as Entities

**Files:**
- Modify: `src/kg-client.ts` (addObservations method ~1722-1746)
- Modify: `src/index.ts` (add_observations handler ~1032-1055)
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('Observations as entities', () => {
    beforeAll(async () => {
      await client.saveEntity({
        name: 'test-obs-parent',
        entityType: 'project',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);
    });

    it('should create observation entities with is_observation_of relation', async () => {
      const result = await client.addObservations(
        'test-obs-parent',
        ['uses TypeScript', 'build is broken'],
        TEST_ZONE,
      );

      // Check that observation entities were created
      const obs1 = await client.getEntity('test-obs-parent: uses TypeScript', TEST_ZONE);
      expect(obs1).not.toBeNull();
      expect(obs1!.entityType).toBe('observation');

      const obs2 = await client.getEntity('test-obs-parent: build is broken', TEST_ZONE);
      expect(obs2).not.toBeNull();
      expect(obs2!.entityType).toBe('observation');
    });

    it('should create is_observation_of relations', async () => {
      const { relations } = await client.getRelationsForEntities(
        ['test-obs-parent: uses TypeScript'],
        TEST_ZONE,
      );

      const observationRelation = relations.find(
        r => r.from === 'test-obs-parent: uses TypeScript'
          && r.to === 'test-obs-parent'
          && r.relationType === 'is_observation_of'
      );
      expect(observationRelation).toBeDefined();
    });

    it('should accept custom reviewInterval for observations', async () => {
      await client.addObservations(
        'test-obs-parent',
        ['server is down'],
        TEST_ZONE,
        { reviewInterval: 1 },
      );

      const obs = await client.getEntity('test-obs-parent: server is down', TEST_ZONE);
      expect(obs).not.toBeNull();
      expect(obs!.reviewInterval).toBe(1);
    });

    it('should assemble observations when fetching parent entity', async () => {
      const results = await client.userSearch({
        query: 'test-obs-parent',
        zone: TEST_ZONE,
        includeObservations: true,
      });

      const parent = results.entities.find(e => e.name === 'test-obs-parent');
      expect(parent).toBeDefined();
      expect(parent!.observations).toBeDefined();
      expect(parent!.observations!.length).toBeGreaterThanOrEqual(2);

      // Observations should have confidence metadata
      const obs = parent!.observations!;
      expect(obs[0]).toHaveProperty('name');
      expect(obs[0]).toHaveProperty('confidence');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/freshness.test.ts --no-cache -t "Observations as entities" 2>&1 | tail -20`
Expected: FAIL — observation entities don't exist (addObservations still uses string array).

- [ ] **Step 3: Rewrite addObservations in KnowledgeGraphClient**

In `src/kg-client.ts`, replace the `addObservations` method (lines 1722-1746):

```typescript
  /**
   * Add observations to an entity.
   * Each observation becomes a separate entity with an is_observation_of relation.
   * @param name Parent entity name
   * @param observations Array of observation strings
   * @param zone Optional memory zone
   * @param options Optional overrides
   * @param options.reviewInterval Review interval for observation entities (default: 7)
   */
  async addObservations(
    name: string,
    observations: string[],
    zone?: string,
    options?: { reviewInterval?: number },
  ): Promise<{ parent: string; created: string[] }> {
    const actualZone = zone || this.defaultZone;

    // Verify parent exists
    const parent = await this.getEntityWithoutUpdatingLastRead(name, actualZone);
    if (!parent) {
      throw new Error(`Entity "${name}" not found in zone "${actualZone}"`);
    }

    const created: string[] = [];
    for (const obs of observations) {
      const obsName = `${name}: ${obs}`;

      // Create the observation entity
      await this.saveEntity({
        name: obsName,
        entityType: 'observation',
        observations: [],
        relevanceScore: parent.relevanceScore,
        reviewInterval: options?.reviewInterval,
      }, actualZone);

      // Create the is_observation_of relation
      await this.saveRelation({
        from: obsName,
        to: name,
        relationType: 'is_observation_of',
      }, actualZone, actualZone, { autoCreateMissingEntities: false });

      created.push(obsName);
    }

    return { parent: name, created };
  }
```

- [ ] **Step 4: Add helper to fetch observations for an entity**

Add a new method to `src/kg-client.ts`, after `addObservations`:

```typescript
  /**
   * Get observation entities for a parent entity.
   * Returns all entities that have an is_observation_of relation to the given entity.
   */
  async getObservationsForEntity(
    name: string,
    zone?: string,
  ): Promise<ESEntity[]> {
    const actualZone = zone || this.defaultZone;

    // Find all is_observation_of relations pointing to this entity
    const { relations } = await this.getRelationsForEntities([name], actualZone);
    const obsRelations = relations.filter(
      r => r.relationType === 'is_observation_of' && r.to === name
    );

    // Fetch each observation entity
    const obsEntities: ESEntity[] = [];
    for (const rel of obsRelations) {
      const entity = await this.getEntityWithoutUpdatingLastRead(rel.from, actualZone);
      if (entity) {
        obsEntities.push(entity);
      }
    }

    return obsEntities;
  }
```

- [ ] **Step 5: Update userSearch to assemble observations with freshness metadata**

In the `userSearch` method in `src/kg-client.ts`, when `includeObservations` is true, replace the simple `entity.observations = src.observations` assignment with observation entity assembly. In the entity mapping block (the one we updated in Task 4), update the `includeObservations` section:

```typescript
        if (includeObservations) {
          // Fetch observation entities and enrich with freshness
          const obsEntities = await this.getObservationsForEntity(src.name, zone);
          entity.observations = obsEntities.map(obs => {
            const obsStaleness = computeStalenessMetadata(obs);
            const obsResult: any = {
              name: obs.name,
              confidence: obsStaleness.confidence,
            };
            if (obsStaleness.needsReview) {
              obsResult.needsReview = true;
            }
            return obsResult;
          });
          entity.lastWrite = src.lastWrite;
          entity.lastRead = src.lastRead;
        }
```

Note: This changes the `observations` field from `string[]` to an array of objects when `includeObservations` is true. Update the return type of `userSearch` accordingly — change `observations?: string[]` to `observations?: any[]`.

- [ ] **Step 6: Update add_observations handler in index.ts**

In `src/index.ts`, update the `add_observations` handler (lines 1032-1055) to use the new return format:

```typescript
    else if (toolName === "add_observations") {
      const name = params.name;
      const observations = params.observations;
      const zone = params.memory_zone;
      const reviewInterval = params.reviewInterval;

      // Verify parent entity exists
      const entity = await kgClient.getEntity(name, zone);
      if (!entity) {
        const zoneMsg = zone ? ` in zone "${zone}"` : "";
        return formatResponse({
          success: false,
          error: `Entity "${name}" not found${zoneMsg}`,
          message: "Please create the entity before adding observations."
        });
      }

      const result = await kgClient.addObservations(name, observations, zone, {
        reviewInterval,
      });

      return formatResponse({
        success: true,
        parent: result.parent,
        observations_created: result.created,
      });
    }
```

- [ ] **Step 7: Update add_observations tool definition to include reviewInterval**

In `src/index.ts`, in the `add_observations` tool definition (around line 394-417), add the `reviewInterval` property:

```typescript
              reviewInterval: {
                type: "integer",
                description: "Review interval in days for observation entities. Short for volatile info (1-7), long for stable facts (180-365). Default: 7."
              }
```

- [ ] **Step 8: Build and run tests**

Run: `npm run build 2>&1 | tail -10 && npx jest tests/freshness.test.ts --no-cache 2>&1 | tail -30`
Expected: PASS — all observation-as-entity tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/kg-client.ts src/index.ts tests/freshness.test.ts
git commit -m "freshness: observations are now entities with own freshness lifecycle

addObservations now creates a separate entity per observation (named
'parent: observation text') with an is_observation_of relation back to the
parent. Each observation entity gets its own spaced repetition fields, enabling
per-fact review intervals. When fetching entities with includeObservations,
observations are assembled from related entities with their own confidence
and needsReview metadata.

This replaces the flat string[] observations model. The add_observations API
is preserved; callers can now also pass reviewInterval."
```

---

### Task 7: Register verify_entity MCP Tool

**Files:**
- Modify: `src/index.ts` (tool definitions ~91-648, tool handlers ~652-1348)

- [ ] **Step 1: Add tool definition**

In `src/index.ts`, add the `verify_entity` tool definition in the tools array (before the `get_time_utc` tool, around line 638):

```typescript
        {
          name: "verify_entity",
          description: "Explicitly verify that an entity's information is still accurate. This refreshes the review clock via spaced repetition — the review interval doubles (capped at 365 days). Call this after confirming a needsReview entity is still valid (e.g., via git log, reading code, asking the user). Set reviewInterval based on content volatility: stable facts (names, architecture) → 180-365 days; project state → 14-30 days; volatile state (build status, active bugs) → 1-7 days. If the information is WRONG, use update_entities or delete_entities instead.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Entity name to verify"
              },
              memory_zone: {
                type: "string",
                description: "Memory zone where the entity is stored."
              },
              reviewInterval: {
                type: "integer",
                description: "Optional override for review interval in days. If not provided, the current interval is doubled (capped at 365)."
              }
            },
            required: ["name", "memory_zone"],
            additionalProperties: false,
            "$schema": "http://json-schema.org/draft-07/schema#"
          }
        },
```

- [ ] **Step 2: Add tool handler**

In `src/index.ts`, add the handler before the `get_time_utc` handler (before line 1328):

```typescript
    else if (toolName === "verify_entity") {
      const name = params.name;
      const zone = params.memory_zone;
      const reviewInterval = params.reviewInterval;

      try {
        const entity = await kgClient.verifyEntity(name, zone, {
          reviewInterval,
        });

        const staleness = computeStalenessMetadata(entity);

        return formatResponse({
          success: true,
          entity: {
            name: entity.name,
            confidence: staleness.confidence,
            reviewInterval: entity.reviewInterval,
            verifyCount: entity.verifyCount,
            nextReviewAt: entity.nextReviewAt,
          },
        });
      } catch (error) {
        return formatResponse({
          success: false,
          error: (error as Error).message,
        });
      }
    }
```

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiles successfully.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "freshness: register verify_entity MCP tool

Exposes entity verification as an MCP tool. Agents can explicitly confirm
that an entity's information is still accurate, which doubles the review
interval via spaced repetition. The tool description guides agents on
appropriate review intervals by content volatility."
```

---

### Task 8: Update Tool Descriptions with DRY and Staleness Guidance

**Files:**
- Modify: `src/index.ts` (tool definitions ~91-648)

- [ ] **Step 1: Update search_nodes description**

In `src/index.ts`, replace the `search_nodes` description (line 327):

```typescript
          description: "Search entities using ElasticSearch query syntax. Supports boolean operators (AND, OR, NOT), fuzzy matching (~), phrases (\"term\"), proximity (\"terms\"~N), wildcards (*, ?), and boosting (^N). Results include freshness metadata: check the 'confidence' and 'needsReview' fields. For 'aging' or 'stale' results, verify before acting (e.g., git log --since). If confirmed valid, call verify_entity to refresh the review clock. If wrong, update or delete the entity.",
```

- [ ] **Step 2: Update create_entities description**

Replace the `create_entities` description (line 170):

```typescript
          description: "Create entities in knowledge graph (memory). Do NOT store information derivable from source code, git history, or documentation — memory is for context, decisions, and knowledge not in the codebase. Set reviewInterval based on content volatility: stable facts (180-365 days), project state (14-30), volatile state (1-7).",
```

- [ ] **Step 3: Add reviewInterval to create_entities inputSchema**

In the `create_entities` tool definition, add `reviewInterval` to the entity item properties (after `observations`, around line 184):

```typescript
                    reviewInterval: {
                      type: "integer",
                      description: "Review interval in days. Short for volatile info (1-7), long for stable facts (180-365). Default: 7."
                    }
```

- [ ] **Step 4: Update add_observations description**

Replace the `add_observations` description (line 395):

```typescript
          description: "Add observations to an existing entity. Each observation becomes a separate entity with its own freshness lifecycle, linked via is_observation_of relation. Do NOT store information derivable from source code, git history, or documentation. Set reviewInterval based on volatility.",
```

- [ ] **Step 5: Update inspect_knowledge_graph description**

Replace the `inspect_knowledge_graph` description (line 128):

```typescript
          description: "Agent driven knowledge graph inspection that uses AI to retrieve relevant entities and relations. Results include freshness metadata (confidence, needsReview). Treat memory as 'what was believed true at a point in time.' Trust current observations (code, logs, git) over recalled memory when they conflict.",
```

- [ ] **Step 6: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "freshness: update tool descriptions with DRY and staleness guidance

Tool descriptions now encode behavioral guidance for agents:
- search_nodes: check confidence/needsReview, verify before acting on stale data
- create_entities: don't store code-derivable info, set reviewInterval by volatility
- add_observations: each observation gets own freshness lifecycle
- inspect_knowledge_graph: treat memory as point-in-time, trust current observations
- verify_entity: content-appropriate interval guidance (already done in Task 7)"
```

---

### Task 9: Wire reviewInterval Through create_entities Handler

**Files:**
- Modify: `src/index.ts` (create_entities handler ~752-823)

- [ ] **Step 1: Update create_entities handler to pass reviewInterval**

In `src/index.ts`, in the entity creation loop (around line 806), update the `saveEntity` call to pass `reviewInterval`:

```typescript
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
          relevanceScore: entity.relevanceScore ?? 1.0,
          reviewInterval: entity.reviewInterval,
        }, zone);
```

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiles successfully.

- [ ] **Step 3: Write and run a quick test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('create_entities with reviewInterval', () => {
    it('should respect reviewInterval passed at creation', async () => {
      const entity = await client.saveEntity({
        name: 'test-create-ri',
        entityType: 'fact',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 180,
      }, TEST_ZONE);

      expect(entity.reviewInterval).toBe(180);
    });
  });
```

Run: `npx jest tests/freshness.test.ts --no-cache -t "create_entities with reviewInterval" 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/index.ts tests/freshness.test.ts
git commit -m "freshness: wire reviewInterval through create_entities handler

Agents can now set the initial review cadence when creating entities via the
MCP create_entities tool, e.g., reviewInterval: 365 for stable facts like
a person's name, or reviewInterval: 1 for volatile build status."
```

---

### Task 10: Full Integration Test

**Files:**
- Modify: `tests/freshness.test.ts`

- [ ] **Step 1: Add end-to-end lifecycle test**

Add to `tests/freshness.test.ts`:

```typescript
  describe('Full spaced repetition lifecycle', () => {
    it('should progress through create → age → review flag → verify → fresh', async () => {
      // 1. Create entity
      const entity = await client.saveEntity({
        name: 'test-lifecycle',
        entityType: 'test',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 1, // 1 day for fast testing
      }, TEST_ZONE);
      expect(entity.verifyCount).toBe(0);
      expect(entity.reviewInterval).toBe(1);

      // 2. Manually backdate to simulate aging (2 days ago)
      const esClient = (client as any).client;
      const indexName = `knowledge-graph@${TEST_ZONE}`;
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await esClient.update({
        index: indexName,
        id: 'entity:test-lifecycle',
        doc: {
          verifiedAt: twoDaysAgo,
          nextReviewAt: new Date(new Date(twoDaysAgo).getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        refresh: true,
      });

      // 3. Search should show it as needing review
      const searchResults = await client.userSearch({
        query: 'test-lifecycle',
        zone: TEST_ZONE,
      });
      const found = searchResults.entities.find(e => e.name === 'test-lifecycle');
      expect(found).toBeDefined();
      expect(found!.needsReview).toBe(true);

      // 4. Verify the entity
      const verified = await client.verifyEntity('test-lifecycle', TEST_ZONE);
      expect(verified.verifyCount).toBe(1);
      expect(verified.reviewInterval).toBe(2); // doubled from 1

      // 5. Search again — should be fresh now
      const freshResults = await client.userSearch({
        query: 'test-lifecycle',
        zone: TEST_ZONE,
      });
      const freshFound = freshResults.entities.find(e => e.name === 'test-lifecycle');
      expect(freshFound).toBeDefined();
      expect(freshFound!.confidence).toBe('fresh');
      expect(freshFound!.needsReview).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run the full test suite**

Run: `npx jest tests/freshness.test.ts --no-cache 2>&1 | tail -40`
Expected: ALL PASS

- [ ] **Step 3: Run existing tests to check for regressions**

Run: `npm run build 2>&1 | tail -5 && npx jest --no-cache 2>&1 | tail -20`
Expected: All tests pass (existing + new).

- [ ] **Step 4: Commit**

```bash
git add tests/freshness.test.ts
git commit -m "freshness: add full lifecycle integration test

Tests the complete spaced repetition flow: entity creation with default
interval, simulated aging via backdated timestamps, search showing
needsReview flag, explicit verification doubling the interval, and
subsequent search returning fresh confidence."
```

---

### Task 11: Remove observations string array from ESEntity storage

**Files:**
- Modify: `src/es-types.ts`
- Modify: `src/kg-client.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update ESEntity interface — make observations optional**

In `src/es-types.ts`, change the `observations` field in `ESEntity` to optional (this is a transitional step — entities no longer store observations as string arrays, but we keep the field for backward compatibility during the transition):

```typescript
  observations?: string[]; // Deprecated: observations are now separate entities. Kept for backward compat.
```

- [ ] **Step 2: Remove observations from KG_INDEX_CONFIG mappings**

In `src/es-types.ts`, remove the observations mapping line:

```typescript
      observations: { type: 'text', analyzer: 'entity_analyzer' },
```

Since we're starting with a fresh database, this is safe.

- [ ] **Step 3: Stop passing observations in saveEntity**

In `src/kg-client.ts`, in the `saveEntity` method, change the observations line in the entity construction to always be an empty array:

```typescript
      observations: [],  // Observations are now separate entities linked via is_observation_of
```

- [ ] **Step 4: Update create_entities handler**

In `src/index.ts`, in the `create_entities` handler (around line 805), after creating the entity, if the input entity has `observations`, call `addObservations` to create them as separate entities:

```typescript
        const savedEntity = await kgClient.saveEntity({
          name: entity.name,
          entityType: entity.entityType,
          observations: [],
          relevanceScore: entity.relevanceScore ?? 1.0,
          reviewInterval: entity.reviewInterval,
        }, zone);

        // If observations were provided, create them as separate entities
        if (entity.observations && entity.observations.length > 0) {
          await kgClient.addObservations(entity.name, entity.observations, zone, {
            reviewInterval: entity.reviewInterval,
          });
        }

        createdEntities.push(savedEntity);
```

- [ ] **Step 5: Update open_nodes handler to assemble observations from entities**

In `src/index.ts`, update the `open_nodes` handler to fetch observations as entities:

```typescript
      // Format entities with freshness metadata and assembled observations
      const formattedEntities = [];
      for (const e of entities) {
        const staleness = computeStalenessMetadata(e);
        const obsEntities = await kgClient.getObservationsForEntity(e.name, zone);

        const result: any = {
          name: e.name,
          entityType: e.entityType,
          confidence: staleness.confidence,
          daysSinceLastWrite: staleness.daysSinceLastWrite,
        };

        if (staleness.needsReview) {
          result.needsReview = true;
        }

        if (obsEntities.length > 0) {
          result.observations = obsEntities.map(obs => {
            const obsStaleness = computeStalenessMetadata(obs);
            const obsResult: any = {
              name: obs.name,
              confidence: obsStaleness.confidence,
            };
            if (obsStaleness.needsReview) {
              obsResult.needsReview = true;
            }
            return obsResult;
          });
        }

        formattedEntities.push(result);
      }
```

- [ ] **Step 6: Build and run all tests**

Run: `npm run build 2>&1 | tail -10 && npx jest --no-cache 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/es-types.ts src/kg-client.ts src/index.ts
git commit -m "freshness: remove observations string array from entity storage

Observations are no longer stored as string[] on entities. The field is kept
as optional for backward compatibility but always set to []. create_entities
now routes input observations through addObservations, creating them as
separate entities with is_observation_of relations. open_nodes assembles
observations from related entities with per-observation freshness metadata."
```

---

### Task 12: Final Build and Test Sweep

**Files:**
- All modified files

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build 2>&1 | tail -20`
Expected: Clean compilation, no errors.

- [ ] **Step 2: Run all Jest tests**

Run: `npx jest --no-cache 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 3: Run legacy test suite**

Run: `npm run test:js 2>&1 | tail -30`
Expected: All pass (or document any expected failures from the schema change if legacy tests create entities with observations in string format — these would need updating).

- [ ] **Step 4: Fix any legacy test failures**

If legacy tests fail because they pass `observations` as strings and expect them back as strings, update them to either:
- Not pass observations (most tests don't need them)
- Use the new addObservations flow

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "freshness: final build and test sweep

All tests pass against the new freshness & spaced repetition model.
Legacy tests updated where needed to work with observations-as-entities."
```
