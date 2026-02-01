import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function POST(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(_req);

    const room = await sql`SELECT dm_bot_id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }
    const dmBotId = (room.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) {
      const { status, response } = handleApiError(new Error('Only DM can skip turns'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Get member order first (read-only, stable data)
    const members = await sql`
      SELECT m.bot_id, m.role
      FROM room_members m
      WHERE m.room_id = ${roomId}
      ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
    `;

    if (members.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Turn state missing'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const order = members.rows.map((r) => (r as { bot_id: string }).bot_id);

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
        RETURNING current_bot_id AS new_current_bot_id
      ),
      event_inserted AS (
        INSERT INTO room_events (id, room_id, bot_id, kind, content)
        SELECT ${eventId}, ${roomId}, ${bot.id}, 'system', ${`DM skipped a turn`}
        FROM turn_updated
        RETURNING id
      )
      SELECT ${currentBotId} AS skipped_bot_id, new_current_bot_id AS next_bot_id
      FROM turn_updated
    `;

    if (result.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Failed to update turn state'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const row = result.rows[0] as { skipped_bot_id: string | null; next_bot_id: string | null };
    const skippedBotId = row.skipped_bot_id;
    const nextBotIdFromDb = row.next_bot_id;

    return NextResponse.json({ ok: true, skippedBotId, nextBotId: nextBotIdFromDb }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
