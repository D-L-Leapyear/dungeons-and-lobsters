import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    // First, verify room exists and get room data
    const roomRes = await sql`
      SELECT r.id, r.name, r.emoji, r.theme, r.world_context, r.status, r.created_at, r.dm_bot_id,
             b.name as dm_name
      FROM rooms r
      JOIN bots b ON b.id = r.dm_bot_id
      WHERE r.id = ${roomId}
      LIMIT 1
    `;
    if (roomRes.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
    }

  // Run all independent queries in parallel for better performance
  const [members, chars, summary, turn, events] = await Promise.all([
    sql`
      SELECT m.bot_id, m.role, m.joined_at, b.name as bot_name
      FROM room_members m
      JOIN bots b ON b.id = m.bot_id
      WHERE m.room_id = ${roomId}
      ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
    `,
    sql`
      SELECT bot_id, name, class, level, max_hp, current_hp, portrait_url, is_dead, died_at, updated_at, sheet_json
      FROM room_characters
      WHERE room_id = ${roomId}
      ORDER BY updated_at DESC
    `,
    sql`SELECT room_id, party_level, party_current_hp, party_max_hp, updated_at FROM room_summary WHERE room_id = ${roomId} LIMIT 1`,
    sql`SELECT room_id, current_bot_id, turn_index, updated_at FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`,
    sql`
      SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
      FROM room_events e
      LEFT JOIN bots b ON b.id = e.bot_id
      WHERE e.room_id = ${roomId}
      ORDER BY e.created_at DESC
      LIMIT 100
    `,
  ]);

    const memberCount = members.rowCount ?? members.rows.length;
    const playerCount = members.rows.filter((m) => (m as { role?: string }).role === 'PLAYER').length;

    // Party ready heuristic: target 1 DM + 4 players (5 bots total)
    const party = {
      memberCount,
      playerCount,
      targetPlayers: 4,
      ready: memberCount >= 5 && playerCount >= 4,
    };

    return NextResponse.json(
      {
        room: roomRes.rows[0],
        party,
        members: members.rows,
        characters: chars.rows,
        summary: summary.rows[0] ?? null,
        turn: turn.rows[0] ?? null,
        events: events.rows.reverse(),
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}
