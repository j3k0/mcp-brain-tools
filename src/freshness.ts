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
