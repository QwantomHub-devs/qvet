/**
 * In-memory sliding-window rate limiter for server actions and public routes.
 * Suitable for single-instance Next.js node runtimes to prevent high-frequency brute-forcing.
 */

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  const record = rateLimitStore.get(key) ?? { timestamps: [] };

  // Prune timestamps older than windowStart
  const validTimestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (validTimestamps.length >= maxAttempts) {
    const oldest = validTimestamps[0] ?? now;
    const resetMs = Math.max(0, oldest + windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  validTimestamps.push(now);
  rateLimitStore.set(key, { timestamps: validTimestamps });

  return {
    allowed: true,
    remaining: maxAttempts - validTimestamps.length,
    resetMs: windowMs,
  };
}

