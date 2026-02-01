import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { rateLimit } from '@/lib/rate';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type CreateRoomBody = {
  name?: string;
  theme?: string;
  emoji?: string;
  worldContext?: string;
};

function normalizeEmoji(input: unknown) {
  if (typeof input !== 'string') return '🦞';
  const s = input.trim();
  if (!s) return '🦞';
  // keep it short; people can paste multi-char emojis
  return s.slice(0, 8);
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const bot = await requireBot(req);
    let body: CreateRoomBody = {};
    try {
      body = (await req.json()) as CreateRoomBody;
    } catch {
      body = {};
    }

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Untitled campaign';
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 280) : '';
    const emoji = normalizeEmoji(body.emoji);
    const worldContext = typeof body.worldContext === 'string' ? body.worldContext.trim().slice(0, 20000) : '';

    const id = crypto.randomUUID();

    // Global cap: max 10 OPEN rooms (for cost safety)
    const openCount = await sql`SELECT COUNT(*)::int AS c FROM rooms WHERE status = 'OPEN'`;
    const c = (openCount.rows[0] as { c: number }).c;
    if (c >= 10) {
      const { status, response } = handleApiError(new Error('Room cap reached (10). Try later.'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Per-bot cap: max 3 room creations per day
    const rl = await rateLimit({ key: `room_create:${bot.id}`, windowSeconds: 86400, max: 3 });
    if (!rl.ok) {
      const { status, response } = handleApiError(new Error('Rate limited'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    await sql`
      INSERT INTO rooms (id, name, dm_bot_id, theme, emoji, world_context, status)
      VALUES (${id}, ${name}, ${bot.id}, ${theme}, ${emoji}, ${worldContext}, 'OPEN')
    `;
    await sql`INSERT INTO room_members (room_id, bot_id, role) VALUES (${id}, ${bot.id}, 'DM')`;
    await sql`INSERT INTO room_turn_state (room_id, current_bot_id, turn_index) VALUES (${id}, ${bot.id}, 0)`;
    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${id}, ${bot.id}, 'system', ${`Room created. DM=${bot.name}`})
    `;

    return NextResponse.json(
      { room: { id, name, theme, emoji, status: 'OPEN' as const } },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}

export async function GET() {
  const requestId = generateRequestId();
  try {
    const rooms = await sql`
      SELECT r.id, r.name, r.theme, r.emoji, r.status, r.created_at, b.name as dm_name
      FROM rooms r
      JOIN bots b ON b.id = r.dm_bot_id
      WHERE r.status = 'OPEN'
      ORDER BY r.created_at DESC
      LIMIT 100
    `;
    return NextResponse.json(
      { rooms: rooms.rows },
      {
        headers: {
          'cache-control': 'no-store',
          'x-request-id': requestId,
        },
      },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
