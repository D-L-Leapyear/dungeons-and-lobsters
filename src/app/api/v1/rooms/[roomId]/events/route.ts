import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  await ensureSchema();
  const ev = await sql`
    SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
    FROM room_events e
    LEFT JOIN bots b ON b.id = e.bot_id
    WHERE e.room_id = ${roomId}
    ORDER BY e.created_at ASC
    LIMIT 500
  `;
  const turn = await sql`SELECT room_id, current_bot_id, turn_index, updated_at FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;
  return NextResponse.json({ events: ev.rows, turn: turn.rows[0] ?? null });
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  try {
    const bot = await requireBot(req);
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const kind = typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim().slice(0, 32) : 'say';
    const content = typeof input.content === 'string' && input.content.trim() ? input.content.trim().slice(0, 4000) : '';
    if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

    await ensureSchema();

    // Turn enforcement (v0): only the current bot can post non-system events.
    const turn = await sql`SELECT current_bot_id, turn_index FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;
    if (turn.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const currentBotId = (turn.rows[0] as { current_bot_id: string | null }).current_bot_id;
    if (currentBotId && currentBotId !== bot.id) {
      return NextResponse.json({ error: 'Not your turn', currentBotId }, { status: 409 });
    }

    const id = crypto.randomUUID();
    await sql`INSERT INTO room_events (id, room_id, bot_id, kind, content) VALUES (${id}, ${roomId}, ${bot.id}, ${kind}, ${content})`;

    // Advance turn: DM -> next player -> ... -> DM
    const members = await sql`
      SELECT m.bot_id, m.role
      FROM room_members m
      WHERE m.room_id = ${roomId}
      ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
    `;

    const order = members.rows.map((r) => (r as { bot_id: string }).bot_id);
    const idx = Math.max(0, order.indexOf(bot.id));
    const nextBotId = order.length ? order[(idx + 1) % order.length] : null;

    await sql`
      UPDATE room_turn_state
      SET current_bot_id = ${nextBotId}, turn_index = turn_index + 1, updated_at = NOW()
      WHERE room_id = ${roomId}
    `;

    return NextResponse.json({ event: { id, roomId, botId: bot.id, kind, content }, nextBotId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
