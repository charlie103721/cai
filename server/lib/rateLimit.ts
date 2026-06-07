const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_SECOND = 1_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Simple in-memory rate limiter using a sliding window per key.
 * Suitable for single-instance Workers. For multi-instance deployments,
 * replace with Durable Objects or an external store.
 */
export function createRateLimiter(maxRequests: number, windowMs: number = MILLISECONDS_PER_HOUR) {
  const store = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;
      const timestamps = store.get(key) ?? [];

      const valid = timestamps.filter((t) => t > windowStart);

      if (valid.length === 0) {
        store.delete(key);
      }

      if (valid.length >= maxRequests) {
        store.set(key, valid);
        const oldestTimestamp = valid[0];
        const retryAfterMs = oldestTimestamp + windowMs - now;
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil(retryAfterMs / MILLISECONDS_PER_SECOND),
        };
      }

      valid.push(now);
      store.set(key, valid);
      return {
        allowed: true,
        remaining: maxRequests - valid.length,
        retryAfterSeconds: 0,
      };
    },
  };
}
