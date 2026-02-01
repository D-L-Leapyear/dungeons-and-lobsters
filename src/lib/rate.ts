import { sql } from '@vercel/postgres';

export function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for');
  if (!xf) return 'unknown';
  return xf.split(',')[0]?.trim() || 'unknown';
}

/**
 * Clean up old rate limit entries (older than 24 hours).
 * This should be called periodically to prevent the rate_limits table from growing indefinitely.
 */
export async function cleanupOldRateLimits() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await sql`DELETE FROM rate_limits WHERE window_start < ${oneDayAgo.toISOString()}`;
}

/**
 * Rate limiting with automatic cleanup of old entries.
 * Uses atomic database operations to prevent race conditions.
 * Note: For production at scale, consider using Redis instead of Postgres for rate limiting.
 */
export async function rateLimit(opts: { key: string; windowSeconds: number; max: number }) {
  const now = new Date();
  const nowISO = now.toISOString();

  // Periodically clean up old entries (1% chance per call to avoid overhead)
  if (Math.random() < 0.01) {
    cleanupOldRateLimits().catch((err) => {
      console.error('[rateLimit] Cleanup failed:', err);
    });
  }

  // Use atomic INSERT ... ON CONFLICT DO UPDATE to prevent race conditions
  // This single query handles both the case where the key exists and where it doesn't
  const result = await sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${opts.key}, ${nowISO}, 1)
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE
        WHEN EXTRACT(EPOCH FROM (${nowISO}::timestamptz - rate_limits.window_start)) >= ${opts.windowSeconds}
        THEN ${nowISO}
        ELSE rate_limits.window_start
      END,
      count = CASE
        WHEN EXTRACT(EPOCH FROM (${nowISO}::timestamptz - rate_limits.window_start)) >= ${opts.windowSeconds}
        THEN 1
        WHEN rate_limits.count >= ${opts.max}
        THEN rate_limits.count
        ELSE rate_limits.count + 1
      END
    RETURNING window_start, count
  `;

  const row = result.rows[0] as { window_start: string; count: number };
  const start = new Date(row.window_start);
  const ageSec = (now.getTime() - start.getTime()) / 1000;

  // Check if we're still within the window
  if (ageSec >= opts.windowSeconds) {
    // Window expired, this is a new window (count should be 1)
    return { ok: true as const, remaining: opts.max - 1 };
  }

  // Check if limit exceeded
  if (row.count > opts.max) {
    // This shouldn't happen due to the CASE statement, but handle it anyway
    return { ok: false as const, remaining: 0, retryAfterSec: Math.ceil(opts.windowSeconds - ageSec) };
  }

  if (row.count >= opts.max) {
    return { ok: false as const, remaining: 0, retryAfterSec: Math.ceil(opts.windowSeconds - ageSec) };
  }

  return { ok: true as const, remaining: opts.max - row.count };
}
