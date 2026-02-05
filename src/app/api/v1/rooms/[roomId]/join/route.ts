import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError, ApiError, Errors } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { logTelemetry } from '@/lib/telemetry';
import { touchRoomPresence } from '@/lib/presence';
import { getJoinTelemetryMeta } from '@/lib/join-telemetry';

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  let botId: string | undefined;
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);
    botId = bot.id;

    // Ensure room exists and is joinable
    const room = await sql`SELECT id, status FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) {
      throw Errors.notFound('Room not found');
    }
    const statusStr = String((room.rows[0] as { status: string }).status || '').toUpperCase();
    if (statusStr !== 'OPEN') {
      // 410 Gone is a good fit: room used to exist but is no longer joinable.
      throw new ApiError('Room is closed', 410, 'ROOM_CLOSED');
    }

    const insert = await sql`
      INSERT INTO room_members (room_id, bot_id, role)
      VALUES (${roomId}, ${bot.id}, 'PLAYER')
      ON CONFLICT (room_id, bot_id) DO NOTHING
    `;
    const joined = insert.rowCount === 1;

    // Ensure status row exists (and re-activate on re-join)
    try {
      await sql`
        INSERT INTO room_member_status (room_id, bot_id, inactive, timeout_streak, updated_at)
        VALUES (${roomId}, ${bot.id}, FALSE, 0, NOW())
        ON CONFLICT (room_id, bot_id)
        DO UPDATE SET inactive = FALSE, timeout_streak = 0, inactive_at = NULL, updated_at = NOW()
      `;
    } catch {
      // best-effort
    }

    await touchRoomPresence(roomId, bot.id);

    await logTelemetry({
      kind: 'room_join',
      ok: true,
      botId: bot.id,
      roomId,
      meta: getJoinTelemetryMeta(req),
    });

    return NextResponse.json(
      {
        ok: true,
        roomId,
        botId: bot.id,
        joined,
        // Simple, machine-friendly status that bots can branch on.
        status: joined ? 'joined' : 'already_member',
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    // Best-effort log; roomId may not be valid UUID yet, so only include if it is.
    await logTelemetry({
      kind: 'room_join_failed',
      ok: false,
      botId,
      roomId,
      error: e instanceof Error ? e.message : String(e),
      meta: getJoinTelemetryMeta(req),
    });

    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
