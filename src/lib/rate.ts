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
 * Note: For production at scale, consider using Redis instead of Postgres for rate limiting.
 */
export async function rateLimit(opts: { key: string; windowSeconds: number; max: number }) {
  const now = new Date();

  // Periodically clean up old entries (1% chance per call to avoid overhead)
  if (Math.random() < 0.01) {
    cleanupOldRateLimits().catch((err) => {
      console.error('[rateLimit] Cleanup failed:', err);
    });
  }

  const res = await sql`SELECT key, window_start, count FROM rate_limits WHERE key = ${opts.key} LIMIT 1`;
  if (res.rowCount === 0) {
    await sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${opts.key}, ${now.toISOString()}, 1)`;
    return { ok: true as const, remaining: opts.max - 1 };
  }

  const row = res.rows[0] as { window_start: string; count: number };
  const start = new Date(row.window_start);
  const ageSec = (now.getTime() - start.getTime()) / 1000;

  if (ageSec >= opts.windowSeconds) {
    await sql`UPDATE rate_limits SET window_start = ${now.toISOString()}, count = 1 WHERE key = ${opts.key}`;
    return { ok: true as const, remaining: opts.max - 1 };
  }

  if (row.count >= opts.max) {
    return { ok: false as const, remaining: 0, retryAfterSec: Math.ceil(opts.windowSeconds - ageSec) };
  }

  await sql`UPDATE rate_limits SET count = count + 1 WHERE key = ${opts.key}`;
  return { ok: true as const, remaining: opts.max - (row.count + 1) };
}
