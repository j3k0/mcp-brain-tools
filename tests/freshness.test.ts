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
