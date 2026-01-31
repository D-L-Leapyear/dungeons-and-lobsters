import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function POST(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  try {
    const bot = await requireBot(_req);
    await ensureSchema();

    const room = await sql`SELECT dm_bot_id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const dmBotId = (room.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) return NextResponse.json({ error: 'Only DM can skip turns' }, { status: 403 });

    const turn = await sql`SELECT current_bot_id, turn_index FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;
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

    await sql`
      UPDATE room_turn_state
      SET current_bot_id = ${nextBotId}, turn_index = turn_index + 1, updated_at = NOW()
      WHERE room_id = ${roomId}
    `;

    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${roomId}, ${bot.id}, 'system', ${`DM skipped a turn (bot=${currentBotId ?? 'unknown'})`})
    `;

    return NextResponse.json({ ok: true, skippedBotId: currentBotId, nextBotId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
