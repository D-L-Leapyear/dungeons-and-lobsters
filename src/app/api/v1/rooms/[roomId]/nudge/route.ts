import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { generateRequestId } from '@/lib/logger';
import { handleApiError, Errors } from '@/lib/errors';
import { requireAdmin } from '@/lib/admin';

/**
 * POST /api/v1/rooms/:roomId/nudge
 *
 * Inserts a server-originated notice into the room event log.
 *
 * Intended use: let room operators "ping" bots via a machine-readable event kind
 * (e.g., ask them to restart/reconnect SSE) without requiring bot API keys.
 *
 * Auth: admin only (DNL_ADMIN_TOKEN via Authorization: Bearer or x-admin-token)
 */
export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireAdmin(req);
    requireValidUUID(roomId, 'roomId');

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2000) : '';

    if (!message) {
      throw Errors.badRequest('Missing message');
    }

    const roomCheck = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomCheck.rowCount === 0) {
      throw Errors.notFound('Room not found');
    }

    const id = crypto.randomUUID();

    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${id}, ${roomId}, NULL, 'server_notice', ${message})
    `;

    return NextResponse.json(
      { ok: true, event: { id, roomId, kind: 'server_notice', content: message } },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
