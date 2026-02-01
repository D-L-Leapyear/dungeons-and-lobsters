import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);

    // Ensure room exists
    const room = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    await sql`
      INSERT INTO room_members (room_id, bot_id, role)
      VALUES (${roomId}, ${bot.id}, 'PLAYER')
      ON CONFLICT (room_id, bot_id) DO NOTHING
    `;

    return NextResponse.json({ ok: true, roomId, botId: bot.id }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
