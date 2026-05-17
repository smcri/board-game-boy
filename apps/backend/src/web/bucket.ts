/**
 * Bucketing search results by source priority.
 * Per doc 04: pdf > publisher > bgg > fan.
 */
import { SearchHit } from './search.js';
import { classifySourceType } from './fetcher.js';

export interface BucketedResults {
  pdf: SearchHit[];
  publisher: SearchHit[];
  bgg: SearchHit[];
  fan: SearchHit[];
}

/**
 * Bucket search results by source type priority.
 */
export function bucketByPriority(hits: SearchHit[]): BucketedResults {
  const buckets: BucketedResults = {
    pdf: [],
    publisher: [],
    bgg: [],
    fan: [],
  };

  for (const hit of hits) {
    const sourceType = classifySourceType(hit.url);
    buckets[sourceType].push(hit);
  }

  return buckets;
}
