import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireBot } from '@/lib/auth';
import { requireValidUUID } from '@/lib/validation';
import { generateRequestId, createLogger } from '@/lib/logger';
import { handleApiError, Errors } from '@/lib/errors';
import { touchRoomPresence } from '@/lib/presence';

type CombatPhase = 'SETUP' | 'START' | 'ACTION' | 'RESOLUTION' | 'END';

type Combatant = {
  botId?: string;
  name: string;
  initiative: number;
};

type CombatState = {
  status: 'ACTIVE' | 'INACTIVE';
  round: number;
  phase: CombatPhase;
  /** initiative order, highest first */
  order: Combatant[];
  note?: string;
  updatedAt: string;
};

function clampInt(n: unknown, def: number, min: number, max: number) {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

function normalizePhase(v: unknown): CombatPhase {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (s === 'SETUP' || s === 'START' || s === 'ACTION' || s === 'RESOLUTION' || s === 'END') return s;
  return 'ACTION';
}

function normalizeStatus(v: unknown): 'ACTIVE' | 'INACTIVE' {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (s === 'INACTIVE' || s === 'ENDED' || s === 'END') return 'INACTIVE';
  return 'ACTIVE';
}

function normalizeCombatants(v: unknown): Combatant[] {
  const arr = Array.isArray(v) ? v : [];
  const out: Combatant[] = [];

  for (const raw of arr.slice(0, 24)) {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 64) : '';
    if (!name) continue;
    const initiative = clampInt(r.initiative, 10, -20, 60);
    const botId = typeof r.botId === 'string' && r.botId.trim() ? r.botId.trim().slice(0, 128) : undefined;
    out.push({ name, initiative, ...(botId ? { botId } : {}) });
  }

  out.sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
  return out;
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  const log = createLogger({ requestId, roomId });

  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);

    // DM-only: must match the room's DM bot id.
    const room = await sql`SELECT dm_bot_id, status FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) throw Errors.notFound('Room not found');

    const { dm_bot_id: dmBotId, status } = room.rows[0] as { dm_bot_id: string; status: string };
    if (String(status || '').toUpperCase() !== 'OPEN') throw Errors.conflict('Room is closed');
    if (bot.id !== dmBotId) throw Errors.forbidden('Only the DM bot can set combat state');

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

    const statusNorm = normalizeStatus(input.status);
    const round = clampInt(input.round, statusNorm === 'ACTIVE' ? 1 : 0, 0, 999);
    const phase = normalizePhase(input.phase);
    const order = normalizeCombatants(input.order ?? input.initiative ?? input.combatants);
    const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : undefined;

    const state: CombatState = {
      status: statusNorm,
      round,
      phase,
      order,
      ...(note ? { note } : {}),
      updatedAt: new Date().toISOString(),
    };

    const content = JSON.stringify(state);
    if (content.length > 3900) throw Errors.badRequest('Combat state too large');

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${id}, ${roomId}, ${bot.id}, 'combat_state', ${content})
    `;

    await touchRoomPresence(roomId, bot.id);

    log.info('Combat state updated', { eventId: id, status: state.status, round: state.round, phase: state.phase, orderCount: state.order.length });

    return NextResponse.json({ ok: true, eventId: id, combat: state }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
