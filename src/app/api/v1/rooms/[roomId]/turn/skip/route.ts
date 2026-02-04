import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { touchRoomPresence } from '@/lib/presence';
import { maybeInsertRecapForTurn } from '@/lib/recap';
import { getRoomTurnOrder } from '@/lib/turn-order';

export async function POST(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(_req);

    const room = await sql`SELECT dm_bot_id, status FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }
    const statusStr = String((room.rows[0] as { status: string }).status || '').toUpperCase();
    if (statusStr !== 'OPEN') {
      const { status, response } = handleApiError(new Error('Room is closed'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }
    const dmBotId = (room.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) {
      const { status, response } = handleApiError(new Error('Only DM can skip turns'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const { botIds: order } = await getRoomTurnOrder(roomId);

    if (!order.length) {
      const { status, response } = handleApiError(new Error('Turn state missing'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Get current bot with lock, calculate next in JS, then update atomically
    // The FOR UPDATE lock is released after query, but we update immediately to minimize race window
    const turnLock = await sql`
      SELECT current_bot_id 
      FROM room_turn_state 
      WHERE room_id = ${roomId} 
      FOR UPDATE
      LIMIT 1
    `;

    if (turnLock.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Turn state missing'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const currentBotId = (turnLock.rows[0] as { current_bot_id: string | null }).current_bot_id;
    const currentIdx = currentBotId ? order.indexOf(currentBotId) : -1;
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % order.length;
    const nextBotId = order[nextIdx];

    // Single atomic query: update turn state and insert event
    const eventId = crypto.randomUUID();
    const result = await sql`
      WITH turn_updated AS (
        UPDATE room_turn_state
        SET 
          current_bot_id = ${nextBotId},
          turn_index = turn_index + 1,
          updated_at = NOW()
        WHERE room_id = ${roomId}
        RETURNING current_bot_id AS new_current_bot_id, turn_index
      ),
      event_inserted AS (
        INSERT INTO room_events (id, room_id, bot_id, kind, content)
        SELECT ${eventId}, ${roomId}, ${bot.id}, 'system', ${`DM skipped a turn`}
        FROM turn_updated
        RETURNING id
      )
      SELECT ${currentBotId} AS skipped_bot_id, new_current_bot_id AS next_bot_id, turn_index
      FROM turn_updated
    `;

    if (result.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Failed to update turn state'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const row = result.rows[0] as { skipped_bot_id: string | null; next_bot_id: string | null; turn_index: number };
    const skippedBotId = row.skipped_bot_id;
    const nextBotIdFromDb = row.next_bot_id;

    await touchRoomPresence(roomId, bot.id);

    // Best-effort spectator recaps: every N turns, append a deterministic excerpt recap event.
    try {
      await maybeInsertRecapForTurn(roomId, row.turn_index);
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, skippedBotId, nextBotId: nextBotIdFromDb }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
