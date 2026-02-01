import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type Body = {
  name?: string;
  class?: string;
  level?: number;
  maxHp?: number;
  currentHp?: number;
  portraitUrl?: string;
  sheet?: {
    // SRD-compatible attributes (OGL 1.0a)
    attributes?: {
      str?: number; // Strength (1-30)
      dex?: number; // Dexterity (1-30)
      con?: number; // Constitution (1-30)
      int?: number; // Intelligence (1-30)
      wis?: number; // Wisdom (1-30)
      cha?: number; // Charisma (1-30)
    };
    // Skill proficiencies (true = proficient, or object with details)
    skills?: Record<
      string,
      | boolean
      | {
          proficient?: boolean;
          expertise?: boolean; // Double proficiency
        }
    >;
    // Spells known/prepared (SRD-compliant only)
    spells?: {
      known?: string[]; // Spell names the character knows
      prepared?: string[]; // Spells currently prepared
      spellSlots?: {
        [key: string]: number; // e.g., "1": 3, "2": 2
      };
      spellcastingAbility?: 'int' | 'wis' | 'cha'; // Which attribute for spellcasting
    };
    // Other custom fields
    [key: string]: unknown;
  };
  isDead?: boolean;
};

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);
    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const exists = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (exists.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : bot.name;
    const clazz = typeof body.class === 'string' && body.class.trim() ? body.class.trim().slice(0, 40) : 'Adventurer';
    const level = Number.isFinite(body.level) ? Math.max(1, Math.min(20, Number(body.level))) : 1;
    const max_hp = Number.isFinite(body.maxHp) ? Math.max(1, Math.min(999, Number(body.maxHp))) : 10;
    const current_hp = Number.isFinite(body.currentHp) ? Math.max(0, Math.min(999, Number(body.currentHp))) : max_hp;
    const portrait_url = typeof body.portraitUrl === 'string' && body.portraitUrl.trim() ? body.portraitUrl.trim().slice(0, 2000) : null;
    const is_dead = body.isDead === true;

    const id = crypto.randomUUID();
    
    // Validate and normalize sheet data
    let sheet_json: Record<string, unknown> = {};
    if (typeof body.sheet === 'object' && body.sheet !== null) {
      sheet_json = body.sheet as Record<string, unknown>;
      
      // Validate attributes (1-30 range)
      if (sheet_json.attributes && typeof sheet_json.attributes === 'object') {
        const attrs = sheet_json.attributes as Record<string, unknown>;
        const validAttrs = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const normalizedAttrs: Record<string, number> = {};
        
        for (const attr of validAttrs) {
          const value = attrs[attr];
          if (typeof value === 'number') {
            normalizedAttrs[attr] = Math.max(1, Math.min(30, Math.round(value)));
          }
        }
        sheet_json.attributes = normalizedAttrs;
      }
      
      // Validate skills (keep as-is, just ensure it's an object)
      if (sheet_json.skills && typeof sheet_json.skills === 'object' && !Array.isArray(sheet_json.skills)) {
        // Skills are valid as-is
      } else if (sheet_json.skills) {
        // Invalid format, remove it
        delete sheet_json.skills;
      }
      
      // Calculate proficiency bonus if not set (SRD-compatible formula: 2 + (level - 1) / 4, rounded up)
      if (typeof sheet_json.proficiencyBonus !== 'number') {
        sheet_json.proficiencyBonus = Math.ceil(2 + (level - 1) / 4);
      }
    }

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

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
