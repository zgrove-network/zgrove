import { issueChallengeNonce } from "@zgrove/protocol";

export interface ChallengeStoreOptions {
  readonly ttlSeconds: number;
  /** Anyone can ask for a challenge, so the outstanding set needs a ceiling. */
  readonly maxOutstanding: number;
}

export interface IssuedChallenge {
  readonly nonce: string;
  readonly expiresAt: number;
}

export interface ChallengeStore {
  issue(publicKey: string, nowSeconds: number): IssuedChallenge;
  /** Single use: a nonce is spent whether or not what followed succeeded. */
  consume(nonce: string, publicKey: string, nowSeconds: number): boolean;
  size(): number;
}

interface Outstanding {
  readonly publicKey: string;
  readonly expiresAt: number;
}

/**
 * In memory on purpose. A challenge lives for seconds, and a restart that
 * forgets them costs a worker one extra round trip — cheaper than a table
 * that has to be swept.
 */
export function createChallengeStore(
  options: ChallengeStoreOptions,
): ChallengeStore {
  // Insertion order is expiry order, since every entry gets the same TTL.
  const outstanding = new Map<string, Outstanding>();

  function expire(nowSeconds: number): void {
    for (const [nonce, entry] of outstanding) {
      if (entry.expiresAt > nowSeconds) {
        return;
      }
      outstanding.delete(nonce);
    }
  }

  return {
    issue(publicKey, nowSeconds) {
      expire(nowSeconds);

      // Under flood, drop the oldest rather than refuse the newcomer: the
      // oldest is closest to expiring anyway, and refusing would let one
      // sender lock everyone else out by filling the map.
      while (outstanding.size >= options.maxOutstanding) {
        const oldest = outstanding.keys().next();
        if (oldest.done === true) {
          break;
        }
        outstanding.delete(oldest.value);
      }

      const nonce = issueChallengeNonce();
      const expiresAt = nowSeconds + options.ttlSeconds;
      outstanding.set(nonce, { publicKey, expiresAt });
      return { nonce, expiresAt };
    },

    consume(nonce, publicKey, nowSeconds) {
      const entry = outstanding.get(nonce);
      if (entry === undefined) {
        return false;
      }

      // Spent on sight. A nonce that survived a failed attempt could be
      // attacked repeatedly; one round trip per attempt is the cost of not
      // allowing that.
      outstanding.delete(nonce);

      // Bound to the key that asked for it, so one worker cannot spend
      // another's challenge.
      return entry.expiresAt > nowSeconds && entry.publicKey === publicKey;
    },

    size: () => outstanding.size,
  };
}
