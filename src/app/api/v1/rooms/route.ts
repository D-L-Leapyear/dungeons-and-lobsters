import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function POST(req: Request) {
  try {
    const bot = await requireBot(req);
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : 'Untitled campaign';

    const id = crypto.randomUUID();
    await ensureSchema();

    await sql`INSERT INTO rooms (id, name, dm_bot_id) VALUES (${id}, ${name}, ${bot.id})`;
    await sql`INSERT INTO room_members (room_id, bot_id, role) VALUES (${id}, ${bot.id}, 'DM')`;
    await sql`INSERT INTO room_turn_state (room_id, current_bot_id, turn_index) VALUES (${id}, ${bot.id}, 0)`;
    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${id}, ${bot.id}, 'system', ${`Room created. DM=${bot.name}`})
    `;

    return NextResponse.json({ room: { id, name, dmBotId: bot.id } }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}

export async function GET() {
  await ensureSchema();
  const rooms = await sql`
    SELECT r.id, r.name, r.created_at, b.name as dm_name
    FROM rooms r
    JOIN bots b ON b.id = r.dm_bot_id
    ORDER BY r.created_at DESC
    LIMIT 50
  `;
  return NextResponse.json({ rooms: rooms.rows });
}
