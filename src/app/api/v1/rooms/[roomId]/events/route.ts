import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { generateRequestId, createLogger } from '@/lib/logger';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';

export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const ev = await sql`
      SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
      FROM room_events e
      LEFT JOIN bots b ON b.id = e.bot_id
      WHERE e.room_id = ${roomId}
      ORDER BY e.created_at ASC
      LIMIT 500
    `;
    const turn = await sql`SELECT room_id, current_bot_id, turn_index, updated_at FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;
    return NextResponse.json(
      { events: ev.rows, turn: turn.rows[0] ?? null },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  const log = createLogger({ requestId, roomId });

  try {
    requireValidUUID(roomId, 'roomId');
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
    if (!content) {
      const { status, response } = handleApiError(new Error('Missing content'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Hard cap per room: stop at 2000 events (cost safety)
    const evCount = await sql`SELECT COUNT(*)::int AS c FROM room_events WHERE room_id = ${roomId}`;
    const ec = (evCount.rows[0] as { c: number }).c;
    if (ec >= 2000) {
      await sql`UPDATE rooms SET status = 'CLOSED' WHERE id = ${roomId}`;
      const { status, response } = handleApiError(new Error('Room closed (event cap reached)'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Per-bot pacing: 1 event / 30s
    const last = await sql`
      SELECT created_at FROM room_events
      WHERE room_id = ${roomId} AND bot_id = ${bot.id} AND kind <> 'system'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (last.rowCount) {
      const t = new Date((last.rows[0] as { created_at: string }).created_at).getTime();
      if (Date.now() - t < 30000) {
        const { status, response } = handleApiError(new Error('Too fast. Wait before posting again.'), requestId);
        return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
      }
    }

    // Turn enforcement (v0): only the current bot can post.
    // Get member order first (read-only, stable data)
    const members = await sql`
      SELECT m.bot_id, m.role
      FROM room_members m
      WHERE m.room_id = ${roomId}
      ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
    `;

    if (members.rowCount === 0) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404, headers: { 'x-request-id': requestId } });
    }

    const order = members.rows.map((r) => (r as { bot_id: string }).bot_id);
    const currentBotIdx = order.indexOf(bot.id);
    if (currentBotIdx === -1) {
      return NextResponse.json({ error: 'You are not a member of this room' }, { status: 403, headers: { 'x-request-id': requestId } });
    }

    const nextBotIdx = (currentBotIdx + 1) % order.length;
    const nextBotId = order[nextBotIdx];

    // Single atomic query: lock turn state, validate it's bot's turn, insert event, and advance turn
    // This prevents race conditions since everything happens in one query
    const id = crypto.randomUUID();
    const result = await sql`
      WITH locked_turn AS (
        SELECT current_bot_id, turn_index 
        FROM room_turn_state 
        WHERE room_id = ${roomId} 
        FOR UPDATE
        LIMIT 1
      ),
      validated_turn AS (
        SELECT locked_turn.current_bot_id, locked_turn.turn_index
        FROM locked_turn
        WHERE locked_turn.current_bot_id IS NULL OR locked_turn.current_bot_id = ${bot.id}
      ),
      event_inserted AS (
        INSERT INTO room_events (id, room_id, bot_id, kind, content)
        SELECT ${id}, ${roomId}, ${bot.id}, ${kind}, ${content}
        FROM validated_turn
        RETURNING id
      )
      UPDATE room_turn_state
      SET 
        current_bot_id = ${nextBotId},
        turn_index = turn_index + 1,
        updated_at = NOW()
      FROM validated_turn, event_inserted
      WHERE room_turn_state.room_id = ${roomId}
      RETURNING room_turn_state.current_bot_id AS next_bot_id
    `;

    if (result.rowCount === 0) {
      // Either room doesn't exist or it's not the bot's turn
      const turnCheck = await sql`SELECT current_bot_id FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;
      if (turnCheck.rowCount === 0) {
        return NextResponse.json({ error: 'Room not found' }, { status: 404, headers: { 'x-request-id': requestId } });
      }
      const currentBotId = (turnCheck.rows[0] as { current_bot_id: string | null }).current_bot_id;
      if (currentBotId && currentBotId !== bot.id) {
        return NextResponse.json({ error: 'Not your turn' }, { status: 409, headers: { 'x-request-id': requestId } });
      }
      return NextResponse.json({ error: 'Failed to post event' }, { status: 500, headers: { 'x-request-id': requestId } });
    }

    const nextBotIdFromDb = (result.rows[0] as { next_bot_id: string | null }).next_bot_id;

    log.info('Event posted successfully', { eventId: id, botId: bot.id, kind });
    return NextResponse.json(
      { event: { id, roomId, botId: bot.id, kind, content }, nextBotId: nextBotIdFromDb },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error('Unknown error');
    log.error('Failed to post event', { roomId, error: error.message }, error);
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
