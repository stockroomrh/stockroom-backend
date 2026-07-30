// No `import "server-only"` here (unlike most of lib/server/**) — this
// module is unit-tested directly (rate-limit.test.ts), same reason
// lib/server/policy/policy-engine.ts omits it. It's still only ever
// imported from app/api/** route handlers in practice.

export class RateLimitError extends Error {
  constructor(message: string, public retryAfterSeconds: number) {
    super(message);
  }
}

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

// Prevents unbounded memory growth from one-off keys (e.g. per-IP fallback
// keys from anonymous callers) that are never touched again.
const STALE_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > STALE_MS) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * In-memory sliding-window rate limiter, keyed per caller per route. Throws
 * RateLimitError once `limit` calls land within `windowSeconds`.
 *
 * Deliberately simple and dependency-free rather than reaching for a shared
 * store (Redis/Upstash) this environment doesn't have credentials for. This
 * is single-process state — it resets on restart and won't be shared across
 * multiple serverless instances if this app is ever deployed that way. It's
 * a real, meaningful guardrail against one client hammering a fund-moving
 * route from a single instance, not a substitute for a proper distributed
 * limiter in a true multi-instance production deployment.
 */
export function checkRateLimit(key: string, limit: number, windowSeconds: number): void {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    throw new RateLimitError(`Too many requests — try again in ${retryAfterSeconds}s.`, retryAfterSeconds);
  }
}
