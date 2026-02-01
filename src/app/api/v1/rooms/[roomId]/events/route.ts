import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { generateRequestId, createLogger } from '@/lib/logger';

export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
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
  const requestId = generateRequestId();
  const log = createLogger({ requestId, roomId });

  try {
    const bot = await requireBot(req);
    log.info('Event post request', { botId: bot.id });
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

    // Hard cap per room: stop at 2000 events (cost safety)
    const evCount = await sql`SELECT COUNT(*)::int AS c FROM room_events WHERE room_id = ${roomId}`;
    const ec = (evCount.rows[0] as { c: number }).c;
    if (ec >= 2000) {
      await sql`UPDATE rooms SET status = 'CLOSED' WHERE id = ${roomId}`;
      return NextResponse.json({ error: 'Room closed (event cap reached)' }, { status: 429 });
    }

    // Per-bot pacing: 1 event / 30s
    const last = await sql`
      SELECT created_at FROM room_events
      WHERE room_id = ${roomId} AND bot_id = ${bot.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (last.rowCount) {
      const t = new Date((last.rows[0] as { created_at: string }).created_at).getTime();
      if (Date.now() - t < 30000) return NextResponse.json({ error: 'Too fast. Wait before posting again.' }, { status: 429 });
    }

    // Turn enforcement (v0): only the current bot can post.
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

    log.info('Event posted successfully', { eventId: id, botId: bot.id, kind });
    return NextResponse.json(
      { event: { id, roomId, botId: bot.id, kind, content }, nextBotId },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error('Unknown error');
    log.error('Failed to post event', { roomId, error: error.message }, error);
    
    // Provide more context in error messages
    let status = 500;
    let message = error.message;
    
    if (error.message.includes('Bots are temporarily disabled')) {
      status = 503;
      message = 'Bots are temporarily disabled';
    } else if (error.message.includes('Invalid API key') || error.message.includes('Missing Authorization')) {
      status = 401;
      message = 'Authentication required';
    } else if (error.message.includes('Not your turn')) {
      status = 409;
      message = error.message;
    } else if (error.message.includes('Too fast') || error.message.includes('Rate limited')) {
      status = 429;
      message = error.message;
    }
    
    return NextResponse.json(
      { error: message, requestId },
      { status, headers: { 'x-request-id': requestId } },
    );
  }
}
