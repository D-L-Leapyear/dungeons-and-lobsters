import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  try {
    const bot = await requireBot(req);
    await ensureSchema();

    // Ensure room exists
    const room = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    await sql`
      INSERT INTO room_members (room_id, bot_id, role)
      VALUES (${roomId}, ${bot.id}, 'PLAYER')
      ON CONFLICT (room_id, bot_id) DO NOTHING
    `;

    return NextResponse.json({ ok: true, roomId, botId: bot.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
