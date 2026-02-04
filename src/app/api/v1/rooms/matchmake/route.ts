import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { touchRoomPresence } from '@/lib/presence';
import { envInt } from '@/lib/config';
import { sql } from '@vercel/postgres';

/**
 * Room matchmaking / auto-fill.
 *
 * Goal: a single call that puts a bot into an OPEN room if possible.
 * - If the bot is already in an OPEN room, returns that room.
 * - Otherwise, picks the least-populated OPEN room (up to a soft cap) and joins it.
 * - If there are no joinable rooms, returns 404 with a clear error code.
 */
export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const bot = await requireBot(req);

    const maxMembers = envInt('DNL_ROOM_MAX_MEMBERS', 6);

    // If bot is already in an OPEN room, return that immediately.
    const existing = await sql`
      SELECT r.id
      FROM rooms r
      JOIN room_members m ON m.room_id = r.id
      WHERE r.status = 'OPEN'
        AND m.bot_id = ${bot.id}
      ORDER BY r.created_at DESC
      LIMIT 1
    `;
    if (existing.rowCount && existing.rows[0]?.id) {
      const roomId = String(existing.rows[0].id);
      await touchRoomPresence(roomId, bot.id);
      return NextResponse.json(
        {
          ok: true,
          roomId,
          botId: bot.id,
          joined: false,
          status: 'already_member',
        },
        { headers: { 'x-request-id': requestId } },
      );
    }

    // Pick a candidate OPEN room to fill.
    const candidate = await sql`
      SELECT
        r.id,
        COALESCE(COUNT(m.bot_id), 0)::int AS member_count
      FROM rooms r
      LEFT JOIN room_members m ON m.room_id = r.id
      WHERE r.status = 'OPEN'
      GROUP BY r.id
      HAVING COALESCE(COUNT(m.bot_id), 0) < ${maxMembers}
      ORDER BY member_count ASC, r.created_at ASC
      LIMIT 1
    `;

    if (candidate.rowCount === 0 || !candidate.rows[0]?.id) {
      throw new ApiError('No joinable OPEN rooms right now. Create one as DM.', 404, 'NO_OPEN_ROOMS');
    }

    const roomId = String(candidate.rows[0].id);

    const insert = await sql`
      INSERT INTO room_members (room_id, bot_id, role)
      VALUES (${roomId}, ${bot.id}, 'PLAYER')
      ON CONFLICT (room_id, bot_id) DO NOTHING
    `;
    const joined = insert.rowCount === 1;

    // Best-effort status row (and re-activate on join)
    try {
      await sql`
        INSERT INTO room_member_status (room_id, bot_id, inactive, timeout_streak, updated_at)
        VALUES (${roomId}, ${bot.id}, FALSE, 0, NOW())
        ON CONFLICT (room_id, bot_id)
        DO UPDATE SET inactive = FALSE, timeout_streak = 0, inactive_at = NULL, updated_at = NOW()
      `;
    } catch {
      // ignore
    }

    await touchRoomPresence(roomId, bot.id);

    return NextResponse.json(
      {
        ok: true,
        roomId,
        botId: bot.id,
        joined,
        status: joined ? 'joined' : 'already_member',
        maxMembers,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
