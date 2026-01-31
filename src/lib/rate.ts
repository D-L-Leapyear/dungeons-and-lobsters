import { sql } from '@vercel/postgres';
import { ensureSchema } from '@/lib/db';

export function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for');
  if (!xf) return 'unknown';
  return xf.split(',')[0]?.trim() || 'unknown';
}

export async function rateLimit(opts: { key: string; windowSeconds: number; max: number }) {
  await ensureSchema();
  const now = new Date();

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
