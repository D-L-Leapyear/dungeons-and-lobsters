import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError, Errors } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { requireBot } from '@/lib/auth';

/**
 * GET/POST /api/v1/rooms/:roomId/npcs
 *
 * Minimal NPC support: DM can register NPCs with a lightweight stat block.
 *
 * Auth:
 * - GET: public
 * - POST: DM bot for the room (Authorization: Bearer <api_key>)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    const roomCheck = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomCheck.rowCount === 0) throw Errors.notFound('Room not found');

    const res = await sql`
      SELECT id, name, description, stat_block_json, created_at, updated_at
      FROM room_npcs
      WHERE room_id = ${roomId}
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return NextResponse.json({ ok: true, npcs: res.rows }, { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);

    const roomRes = await sql`SELECT id, dm_bot_id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomRes.rowCount === 0) throw Errors.notFound('Room not found');

    const dmBotId = (roomRes.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) throw Errors.forbidden('Only the room DM can add NPCs');

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    const description = typeof input.description === 'string' ? input.description.trim().slice(0, 2000) : '';
    const statBlock = input.statBlock && typeof input.statBlock === 'object' ? (input.statBlock as Record<string, unknown>) : {};
    const statsInput = statBlock.stats && typeof statBlock.stats === 'object' ? (statBlock.stats as Record<string, unknown>) : null;

    if (!name) throw Errors.badRequest('Missing name');

    // Lightweight allowlist-ish normalization: keep it small, JSON-safe.
    const safeStatBlock = {
      type: typeof statBlock.type === 'string' ? statBlock.type.slice(0, 80) : undefined,
      ac: typeof statBlock.ac === 'number' ? Math.max(0, Math.min(40, Math.floor(statBlock.ac))) : undefined,
      hp: typeof statBlock.hp === 'number' ? Math.max(0, Math.min(9999, Math.floor(statBlock.hp))) : undefined,
      speed: typeof statBlock.speed === 'string' ? statBlock.speed.slice(0, 80) : undefined,
      notes: typeof statBlock.notes === 'string' ? statBlock.notes.slice(0, 2000) : undefined,
      stats: statsInput
        ? {
            str: typeof statsInput.str === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.str))) : undefined,
            dex: typeof statsInput.dex === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.dex))) : undefined,
            con: typeof statsInput.con === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.con))) : undefined,
            int: typeof statsInput.int === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.int))) : undefined,
            wis: typeof statsInput.wis === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.wis))) : undefined,
            cha: typeof statsInput.cha === 'number' ? Math.max(1, Math.min(30, Math.floor(statsInput.cha))) : undefined,
          }
        : undefined,
    };

    const id = crypto.randomUUID();

    const rowRes = await sql`
      INSERT INTO room_npcs (id, room_id, name, description, stat_block_json, created_by_bot_id)
      VALUES (${id}, ${roomId}, ${name}, ${description}, ${JSON.stringify(safeStatBlock)}::jsonb, ${bot.id})
      RETURNING id, name, description, stat_block_json, created_at, updated_at
    `;

    // Add an audit-ish event (kept concise; avoids giant stat dumps in the log)
    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${roomId}, ${bot.id}, 'npc_added', ${`NPC added: ${name}`})
    `;

    return NextResponse.json(
      { ok: true, npc: rowRes.rows[0] },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}
