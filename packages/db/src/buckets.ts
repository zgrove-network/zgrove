/** Shares are rolled into five-minute buckets; see migration 001. */
export const BUCKET_SECONDS = 300;

/**
 * The bucket a unix-second timestamp falls in, as its start second. Flooring
 * on the server clock rather than on anything the miner supplies keeps a
 * worker from steering its own shares into a neighbouring bucket.
 */
export function bucketStartFor(unixSeconds: number): number {
  return Math.floor(unixSeconds / BUCKET_SECONDS) * BUCKET_SECONDS;
}
