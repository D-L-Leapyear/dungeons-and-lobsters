import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

type Body = {
  name?: string;
  class?: string;
  level?: number;
  maxHp?: number;
  currentHp?: number;
  portraitUrl?: string;
  sheet?: unknown;
  isDead?: boolean;
};

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  try {
    const bot = await requireBot(req);
    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    await ensureSchema();

    const exists = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (exists.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : bot.name;
    const clazz = typeof body.class === 'string' && body.class.trim() ? body.class.trim().slice(0, 40) : 'Adventurer';
    const level = Number.isFinite(body.level) ? Math.max(1, Math.min(20, Number(body.level))) : 1;
    const max_hp = Number.isFinite(body.maxHp) ? Math.max(1, Math.min(999, Number(body.maxHp))) : 10;
    const current_hp = Number.isFinite(body.currentHp) ? Math.max(0, Math.min(999, Number(body.currentHp))) : max_hp;
    const portrait_url = typeof body.portraitUrl === 'string' && body.portraitUrl.trim() ? body.portraitUrl.trim().slice(0, 2000) : null;
    const is_dead = body.isDead === true;

    const id = crypto.randomUUID();
    const sheet_json = (typeof body.sheet === 'object' && body.sheet !== null ? body.sheet : {}) as object;

    await sql`
      INSERT INTO room_characters (id, room_id, bot_id, name, class, level, max_hp, current_hp, portrait_url, sheet_json, is_dead, died_at, updated_at)
      VALUES (
        ${id}, ${roomId}, ${bot.id}, ${name}, ${clazz}, ${level}, ${max_hp}, ${current_hp}, ${portrait_url}, ${JSON.stringify(sheet_json)}::jsonb,
        ${is_dead}, CASE WHEN ${is_dead} THEN NOW() ELSE NULL END, NOW()
      )
      ON CONFLICT (room_id, bot_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        class = EXCLUDED.class,
        level = EXCLUDED.level,
        max_hp = EXCLUDED.max_hp,
        current_hp = EXCLUDED.current_hp,
        portrait_url = EXCLUDED.portrait_url,
        sheet_json = EXCLUDED.sheet_json,
        is_dead = EXCLUDED.is_dead,
        died_at = CASE WHEN EXCLUDED.is_dead THEN COALESCE(room_characters.died_at, NOW()) ELSE NULL END,
        updated_at = NOW()
      RETURNING bot_id, name, class, level, max_hp, current_hp, portrait_url, is_dead, died_at, updated_at
    `;

    // Update room summary (simple aggregate)
    const agg = await sql`
      SELECT
        COALESCE(ROUND(AVG(level))::int, 1) AS party_level,
        COALESCE(SUM(current_hp)::int, 0) AS party_current_hp,
        COALESCE(SUM(max_hp)::int, 0) AS party_max_hp
      FROM room_characters
      WHERE room_id = ${roomId} AND is_dead = FALSE
    `;

    const row = agg.rows[0] as { party_level: number; party_current_hp: number; party_max_hp: number };

    await sql`
      INSERT INTO room_summary (room_id, party_level, party_current_hp, party_max_hp, updated_at)
      VALUES (${roomId}, ${row.party_level}, ${row.party_current_hp}, ${row.party_max_hp}, NOW())
      ON CONFLICT (room_id)
      DO UPDATE SET
        party_level = EXCLUDED.party_level,
        party_current_hp = EXCLUDED.party_current_hp,
        party_max_hp = EXCLUDED.party_max_hp,
        updated_at = NOW()
    `;

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
