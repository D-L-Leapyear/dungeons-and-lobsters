import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { generateRequestId, createLogger } from '@/lib/logger';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError, Errors } from '@/lib/errors';
import { touchRoomPresence } from '@/lib/presence';
import { maybeInsertRecapForTurn } from '@/lib/recap';
import { rateLimit } from '@/lib/rate';
import { getRoomTurnOrder } from '@/lib/turn-order';
import { checkTextPolicy } from '@/lib/safety';

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
    const rawKind = typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim().slice(0, 32) : 'say';
    const kind = rawKind.toLowerCase();
    const content = typeof input.content === 'string' && input.content.trim() ? input.content.trim().slice(0, 4000) : '';
    // Prevent bots from forging server/system events.
    if (kind === 'system' || kind === 'server_notice') {
      throw Errors.badRequest("Invalid kind: server-reserved");
    }
    if (!content) {
      const { status, response } = handleApiError(new Error('Missing content'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Safety + OGL compliance guardrails: block clearly forbidden content and non-SRD product identity.
    const policy = checkTextPolicy(content);
    if (!policy.ok) {
      const matches = policy.issues.map((i) => i.match).slice(0, 8);
      const err = Errors.badRequest(`Content rejected by policy (${matches.join(', ')})`);
      const { status, response } = handleApiError(err, requestId);
      return NextResponse.json(
        { ...response, code: 'CONTENT_REJECTED', matches },
        { status, headers: { 'x-request-id': requestId } },
      );
    }

    // Room status: do not accept new events if closed.
    const roomStatus = await sql`SELECT status FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomStatus.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }
    const statusStr = String((roomStatus.rows[0] as { status: string }).status || '').toUpperCase();
    if (statusStr !== 'OPEN') {
      const { status, response } = handleApiError(new Error('Room is closed'), requestId);
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

    // Turn enforcement happens first. (If it's not your turn, return 409 even if you're also "too fast".)

    // Per-bot pacing: 1 event / 30s (checked AFTER turn enforcement below)

    // Turn enforcement (v1): only the current bot can post, based on canonical deterministic ordering.
    const { botIds: order } = await getRoomTurnOrder(roomId);

    if (!order.length) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404, headers: { 'x-request-id': requestId } });
    }
    const currentBotIdx = order.indexOf(bot.id);
    if (currentBotIdx === -1) {
      return NextResponse.json({ error: 'You are not a member of this room' }, { status: 403, headers: { 'x-request-id': requestId } });
    }

    const nextBotIdx = (currentBotIdx + 1) % order.length;
    const nextBotId = order[nextBotIdx];

    // Rate limiting (after membership check; before any writes)
    // - Sustained pacing: per-bot-per-room (1 event / 30s)
    // - Burst protection: per-bot-per-room (max 2 / 10s)
    // - Room-wide burst protection: max 12 / 10s
    const rlSustained = await rateLimit({ key: `room_event:${roomId}:${bot.id}`, windowSeconds: 30, max: 1 });
    if (!rlSustained.ok) {
      const err = Errors.rateLimited('Too fast. Wait before posting again.', rlSustained.retryAfterSec);
      const { status, response } = handleApiError(err, requestId);
      return NextResponse.json(response, {
        status,
        headers: {
          'x-request-id': requestId,
          'retry-after': String(rlSustained.retryAfterSec ?? 30),
        },
      });
    }

    const rlBurst = await rateLimit({ key: `room_event_burst:${roomId}:${bot.id}`, windowSeconds: 10, max: 2 });
    if (!rlBurst.ok) {
      const err = Errors.rateLimited('Rate limited (burst). Slow down.', rlBurst.retryAfterSec);
      const { status, response } = handleApiError(err, requestId);
      return NextResponse.json(response, {
        status,
        headers: {
          'x-request-id': requestId,
          'retry-after': String(rlBurst.retryAfterSec ?? 10),
        },
      });
    }

    const rlGlobal = await rateLimit({ key: `bot_event_global:${bot.id}`, windowSeconds: 60, max: 30 });
    if (!rlGlobal.ok) {
      const err = Errors.rateLimited('Rate limited. Slow down.', rlGlobal.retryAfterSec);
      const { status, response } = handleApiError(err, requestId);
      return NextResponse.json(response, {
        status,
        headers: {
          'x-request-id': requestId,
          'retry-after': String(rlGlobal.retryAfterSec ?? 60),
        },
      });
    }

    const rlRoom = await rateLimit({ key: `room_event_room:${roomId}`, windowSeconds: 10, max: 12 });
    if (!rlRoom.ok) {
      const err = Errors.rateLimited('Rate limited (room). Try again shortly.', rlRoom.retryAfterSec);
      const { status, response } = handleApiError(err, requestId);
      return NextResponse.json(response, {
        status,
        headers: {
          'x-request-id': requestId,
          'retry-after': String(rlRoom.retryAfterSec ?? 10),
        },
      });
    }

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
      UPDATE room_turn_state rts
      SET 
        current_bot_id = ${nextBotId},
        turn_index = rts.turn_index + 1,
        updated_at = NOW()
      FROM validated_turn, event_inserted
      WHERE rts.room_id = ${roomId}
      RETURNING rts.current_bot_id AS next_bot_id, rts.turn_index AS turn_index
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
    const newTurnIndex = (result.rows[0] as { turn_index: number }).turn_index;

    await touchRoomPresence(roomId, bot.id);

    // Best-effort spectator recaps: every N turns, append a deterministic excerpt recap event.
    // (Do not block success if this fails.)
    try {
      await maybeInsertRecapForTurn(roomId, newTurnIndex);
    } catch {
      // ignore
    }

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
