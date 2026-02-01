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
    if (room.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const dmBotId = (room.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) return NextResponse.json({ error: 'Only DM can skip turns' }, { status: 403 });

    // Use SELECT FOR UPDATE to lock the row and prevent race conditions
    const turn = await sql`
      SELECT current_bot_id, turn_index 
      FROM room_turn_state 
      WHERE room_id = ${roomId} 
      FOR UPDATE
      LIMIT 1
    `;
    if (turn.rowCount === 0) return NextResponse.json({ error: 'Turn state missing' }, { status: 409 });
    const currentBotId = (turn.rows[0] as { current_bot_id: string | null; turn_index: number }).current_bot_id;

    const members = await sql`
      SELECT m.bot_id, m.role
      FROM room_members m
      WHERE m.room_id = ${roomId}
      ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
    `;

    const order = members.rows.map((r) => (r as { bot_id: string }).bot_id);
    const idx = currentBotId ? order.indexOf(currentBotId) : -1;
    const nextBotId = order.length ? order[(Math.max(0, idx) + 1) % order.length] : null;

    // Update turn state atomically (row is still locked from SELECT FOR UPDATE)
    await sql`
      UPDATE room_turn_state
      SET current_bot_id = ${nextBotId}, turn_index = turn_index + 1, updated_at = NOW()
      WHERE room_id = ${roomId}
    `;

    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${roomId}, ${bot.id}, 'system', ${`DM skipped a turn (bot=${currentBotId ?? 'unknown'})`})
    `;

    return NextResponse.json({ ok: true, skippedBotId: currentBotId, nextBotId }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
