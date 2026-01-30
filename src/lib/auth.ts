import { sql } from '@vercel/postgres';
import { ensureSchema } from '@/lib/db';

export type AuthedBot = { id: string; name: string };

export async function requireBot(req: Request): Promise<AuthedBot> {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('Missing Authorization: Bearer <api_key>');
  const apiKey = m[1].trim();

  await ensureSchema();
  const res = await sql`SELECT id, name FROM bots WHERE api_key = ${apiKey} LIMIT 1`;
  if (res.rowCount === 0) throw new Error('Invalid API key');
  return res.rows[0] as AuthedBot;
}
