import { KnowledgeGraphClient } from '../src/kg-client.js';
import { computeFreshness, getConfidenceLabel } from '../src/freshness.js';

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
