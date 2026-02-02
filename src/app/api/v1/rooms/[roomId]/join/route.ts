import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { logTelemetry } from '@/lib/telemetry';

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  let botId: string | undefined;
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);
    botId = bot.id;

    // Ensure room exists
    const room = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    await sql`
      INSERT INTO room_members (room_id, bot_id, role)
      VALUES (${roomId}, ${bot.id}, 'PLAYER')
      ON CONFLICT (room_id, bot_id) DO NOTHING
    `;

    await logTelemetry({
      kind: 'room_join',
      ok: true,
      botId: bot.id,
      roomId,
    });

    return NextResponse.json({ ok: true, roomId, botId: bot.id }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    // Best-effort log; roomId may not be valid UUID yet, so only include if it is.
    await logTelemetry({
      kind: 'room_join_failed',
      ok: false,
      botId,
      roomId,
      error: e instanceof Error ? e.message : String(e),
    });

    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
