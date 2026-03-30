import { KnowledgeGraphClient } from '../src/kg-client.js';
import { computeFreshness, getConfidenceLabel } from '../src/freshness.js';

const TEST_ES_NODE = process.env.TEST_ES_NODE || 'http://localhost:9200';
const TEST_ZONE = 'test-freshness';

describe('Freshness & Spaced Repetition', () => {
  let client: KnowledgeGraphClient;

  beforeAll(async () => {
    client = new KnowledgeGraphClient({ node: TEST_ES_NODE });
    try { await client.deleteMemoryZone(TEST_ZONE); } catch {}
    await client.addMemoryZone(TEST_ZONE, 'Freshness test zone');
  }, 30000);

  afterAll(async () => {
    try { await client.deleteMemoryZone(TEST_ZONE); } catch {}
  }, 15000);

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
      await client.addObservations(
        'test-obs-parent',
        ['uses TypeScript', 'build is broken'],
        TEST_ZONE,
      );

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
  });

  describe('Progressive search with freshness', () => {
    beforeAll(async () => {
      // Create a fresh entity (just created = fresh)
      await client.saveEntity({
        name: 'recentconcept',
        entityType: 'concept',
        observations: [],
        relevanceScore: 1.0,
      }, TEST_ZONE);

      // Create an entity that simulates being overdue for review
      await client.saveEntity({
        name: 'outdatedknowledge',
        entityType: 'concept',
        observations: [],
        relevanceScore: 1.0,
        reviewInterval: 1, // 1 day interval
      }, TEST_ZONE);

      // Manually backdate verifiedAt to make it stale (30 days ago)
      const esClient = (client as any).client;
      const indexName = `knowledge-graph@${TEST_ZONE}`;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await esClient.update({
        index: indexName,
        id: `entity:outdatedknowledge`,
        doc: {
          verifiedAt: thirtyDaysAgo,
          nextReviewAt: new Date(new Date(thirtyDaysAgo).getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        refresh: true,
      });
    });

    it('should include confidence and needsReview in search results', async () => {
      const results = await client.userSearch({
        query: 'recentconcept',
        zone: TEST_ZONE,
      });

      const freshEntity = results.entities.find(e => e.name === 'recentconcept');
      expect(freshEntity).toBeDefined();
      expect(freshEntity!.confidence).toBe('fresh');
      expect(freshEntity!.needsReview).toBeUndefined();
    });

    it('should include daysSinceLastWrite in search results', async () => {
      const results = await client.userSearch({
        query: 'recentconcept',
        zone: TEST_ZONE,
      });

      const freshEntity = results.entities.find(e => e.name === 'recentconcept');
      expect(freshEntity).toBeDefined();
      expect(typeof freshEntity!.daysSinceLastWrite).toBe('number');
      expect(freshEntity!.daysSinceLastWrite).toBeLessThan(1);
    });

    it('should find stale entities via progressive widening when no fresh results', async () => {
      const results = await client.userSearch({
        query: 'outdatedknowledge',
        zone: TEST_ZONE,
      });

      const staleEntity = results.entities.find(e => e.name === 'outdatedknowledge');
      expect(staleEntity).toBeDefined();
      expect(staleEntity!.needsReview).toBe(true);
      expect(staleEntity!.confidence).toBe('archival');
    });
  });
});

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
