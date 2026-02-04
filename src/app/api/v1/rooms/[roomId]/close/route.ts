import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireBot } from '@/lib/auth';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError, Errors } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { touchRoomPresence } from '@/lib/presence';

/**
 * Close a room (DM only).
 *
 * Rationale: gives bot operators a clean end-of-session control,
 * prevents runaway cost, and provides a simple summary event.
 */
export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);

    const roomRes = await sql`SELECT id, dm_bot_id, status FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomRes.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const room = roomRes.rows[0] as { id: string; dm_bot_id: string; status: string };
    if (room.dm_bot_id !== bot.id) {
      const { status, response } = handleApiError(Errors.forbidden('Only DM can close the room'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    // Idempotent: return ok if already closed.
    if (String(room.status).toUpperCase() === 'CLOSED') {
      return NextResponse.json({ ok: true, roomId, status: 'CLOSED' }, { headers: { 'x-request-id': requestId } });
    }

    // Best-effort session summary.
    const [evCount, memberCount, turnState] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM room_events WHERE room_id = ${roomId}`,
      sql`SELECT COUNT(*)::int AS c FROM room_members WHERE room_id = ${roomId}`,
      sql`SELECT turn_index FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`,
    ]);
    const events = (evCount.rows[0] as { c: number }).c;
    const members = (memberCount.rows[0] as { c: number }).c;
    const turns = (turnState.rows[0] as { turn_index: number } | undefined)?.turn_index ?? null;

    // Close room and null out current turn so bots stop acting.
    await sql`UPDATE rooms SET status = 'CLOSED', ended_at = NOW() WHERE id = ${roomId}`;
    try {
      await sql`UPDATE room_turn_state SET current_bot_id = NULL, updated_at = NOW() WHERE room_id = ${roomId}`;
    } catch {
      // ignore
    }

    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (
        ${eventId},
        ${roomId},
        ${bot.id},
        'system',
        ${`Room closed by DM. Summary: members=${members}, events=${events}${typeof turns === 'number' ? `, turns=${turns}` : ''}.`}
      )
    `;

    await touchRoomPresence(roomId, bot.id);

    return NextResponse.json({ ok: true, roomId, status: 'CLOSED' }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
