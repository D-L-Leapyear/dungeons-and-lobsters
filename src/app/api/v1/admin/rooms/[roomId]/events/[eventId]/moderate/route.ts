import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireAdmin } from '@/lib/admin';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError, Errors } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type Action = 'hide' | 'unhide' | 'delete';

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string; eventId: string }> }) {
  const { roomId, eventId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireAdmin(req);
    requireValidUUID(roomId, 'roomId');
    requireValidUUID(eventId, 'eventId');

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const action = (typeof input.action === 'string' ? input.action : '').toLowerCase() as Action;
    const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 400) : '';

    if (!action || !(['hide', 'unhide', 'delete'] as const).includes(action)) {
      throw Errors.badRequest("Invalid action (expected 'hide' | 'unhide' | 'delete')");
    }

    const actor = 'admin';

    // Verify event exists (and belongs to room) first.
    const exists = await sql`
      SELECT id, room_id, hidden
      FROM room_events
      WHERE id = ${eventId}
      LIMIT 1
    `;
    if ((exists.rowCount ?? 0) === 0) throw Errors.notFound('Event not found');
    const row = exists.rows[0] as { id: string; room_id: string; hidden?: boolean };
    if (row.room_id !== roomId) throw Errors.badRequest('Event does not belong to this room');

    if (action === 'delete') {
      await sql`DELETE FROM room_events WHERE id = ${eventId}`;
    } else if (action === 'hide') {
      await sql`
        UPDATE room_events
        SET hidden = TRUE,
            hidden_at = NOW(),
            hidden_reason = ${reason},
            hidden_by = ${actor}
        WHERE id = ${eventId}
      `;
    } else if (action === 'unhide') {
      await sql`
        UPDATE room_events
        SET hidden = FALSE,
            hidden_at = NULL,
            hidden_reason = '',
            hidden_by = ${actor}
        WHERE id = ${eventId}
      `;
    }

    // Best-effort audit log (a separate table) + telemetry mirror.
    const logId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO room_event_moderation_log (id, room_id, event_id, action, reason, actor)
        VALUES (${logId}, ${roomId}, ${eventId}, ${action}, ${reason}, ${actor})
      `;
    } catch {
      // ignore (schema may not be migrated yet)
    }

    try {
      await sql`
        INSERT INTO telemetry_events (id, kind, ok, room_id, meta)
        VALUES (
          ${crypto.randomUUID()},
          'event_moderation',
          TRUE,
          ${roomId},
          ${JSON.stringify({ action, eventId, reason, actor })}::jsonb
        )
      `;
    } catch {
      // ignore
    }

    return NextResponse.json(
      { ok: true, action, eventId, roomId },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
