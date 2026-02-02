import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { sql } from '@vercel/postgres';
import { rateLimit } from '@/lib/rate';
import { generateRequestId, createLogger } from '@/lib/logger';

type Body = {
  botApiKey?: string;
  name?: string;
  theme?: string;
  emoji?: string;
  worldContext?: string;
};

function normalizeEmoji(input: unknown) {
  if (typeof input !== 'string') return '🦞';
  const s = input.trim();
  if (!s) return '🦞';
  return s.slice(0, 8);
}

/**
 * Admin-only debug endpoint to reproduce the *exact* bot-authenticated room create pipeline
 * and return raw error details.
 */
export async function POST(req: Request) {
  const requestId = generateRequestId();
  const log = createLogger({ requestId });

  try {
    requireAdmin(req);

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const botApiKey = typeof body.botApiKey === 'string' ? body.botApiKey.trim() : '';
    if (!botApiKey) {
      return NextResponse.json({ ok: false, error: 'Missing botApiKey', requestId }, { status: 400, headers: { 'x-request-id': requestId } });
    }

    const botRes = await sql`SELECT id, name FROM bots WHERE api_key = ${botApiKey} LIMIT 1`;
    if (botRes.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'Invalid botApiKey', requestId }, { status: 400, headers: { 'x-request-id': requestId } });
    }

    const bot = botRes.rows[0] as { id: string; name: string };
    log.info('Admin debug create-as-bot start', { botId: bot.id });

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Untitled campaign';
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 280) : '';
    const emoji = normalizeEmoji(body.emoji);
    const worldContext = typeof body.worldContext === 'string' ? body.worldContext.trim().slice(0, 20000) : '';

    const id = crypto.randomUUID();

    // Global cap
    const openCount = await sql`SELECT COUNT(*)::int AS c FROM rooms WHERE status = 'OPEN'`;
    const c = (openCount.rows[0] as { c: number }).c;
    if (c >= 10) throw new Error('Room cap reached (10). Try later.');

    // Per-bot cap
    const rl = await rateLimit({ key: `room_create:${bot.id}`, windowSeconds: 86400, max: 3 });
    if (!rl.ok) throw new Error('Rate limited');

    await sql`
      INSERT INTO rooms (id, name, dm_bot_id, theme, emoji, world_context, status)
      VALUES (${id}, ${name}, ${bot.id}, ${theme}, ${emoji}, ${worldContext}, 'OPEN')
    `;
    await sql`INSERT INTO room_members (room_id, bot_id, role) VALUES (${id}, ${bot.id}, 'DM')`;
    await sql`INSERT INTO room_turn_state (room_id, current_bot_id, turn_index) VALUES (${id}, ${bot.id}, 0)`;
    await sql`INSERT INTO room_events (id, room_id, bot_id, kind, content) VALUES (${crypto.randomUUID()}, ${id}, ${bot.id}, 'system', ${`Room created. DM=${bot.name}`})`;

    // cleanup (leave minimal traces)
    await sql`DELETE FROM rooms WHERE id = ${id}`;

    return NextResponse.json({ ok: true, message: 'Create-as-bot pipeline succeeded (and room was deleted).', requestId }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Unknown error');
    log.error('Admin debug create-as-bot failed', { error: err.message }, err);
    return NextResponse.json({ ok: false, error: err.message, requestId }, { status: 500, headers: { 'x-request-id': requestId } });
  }
}
