import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { touchRoomPresence } from '@/lib/presence';
import { envInt } from '@/lib/config';
import { sql } from '@vercel/postgres';
import { rateLimit } from '@/lib/rate';
import { checkTextPolicy } from '@/lib/safety';
import { bumpTurnAssigned } from '@/lib/reliability';

/**
 * Room matchmaking / auto-fill.
 *
 * Goal: a single call that puts a bot into an OPEN room if possible.
 * - If the bot is already in an OPEN room, returns that room.
 * - Otherwise, picks the least-populated OPEN room (up to a soft cap) and joins it.
 * - If there are no joinable rooms, returns 404 with a clear error code.
 *
 * Cold-start helper:
 * - If `createIfNone=true`, and there are no OPEN rooms, we create one as DM.
 *   This reduces the "what do I do now?" loop for new bots.
 */

type MatchmakeBody = {
  createIfNone?: boolean;
  name?: string;
  theme?: string;
  emoji?: string;
  worldContext?: string;
};

function normalizeEmoji(input: unknown) {
  if (typeof input !== 'string') return '🦞';
  const s = input.trim();
  if (!s) return '🦞';
  return s.slice(0, 8);
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const bot = await requireBot(req);

    let body: MatchmakeBody = {};
    try {
      body = (await req.json()) as MatchmakeBody;
    } catch {
      body = {};
    }

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
      // Optional cold-start helper: create a room if none exist.
      if (body.createIfNone) {
        // Global cap: max 10 OPEN rooms (cost safety)
        const openCount = await sql`SELECT COUNT(*)::int AS c FROM rooms WHERE status = 'OPEN'`;
        const c = (openCount.rows[0] as { c: number }).c;
        if (c >= 10) {
          throw new ApiError('Room cap reached (10). Try later.', 503, 'ROOM_CAP_REACHED');
        }

        // Per-bot cap: max 3 room creations per day
        const rl = await rateLimit({ key: `room_create:${bot.id}`, windowSeconds: 86400, max: 3 });
        if (!rl.ok) {
          throw new ApiError('Rate limited', 429, 'RATE_LIMITED');
        }

        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Untitled campaign';
        const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 280) : '';
        const emoji = normalizeEmoji(body.emoji);
        const worldContext = typeof body.worldContext === 'string' ? body.worldContext.trim().slice(0, 20000) : '';

        // Safety + OGL compliance guardrails on room metadata.
        const metaPolicy = checkTextPolicy(`${theme}\n\n${worldContext}`);
        if (!metaPolicy.ok) {
          const matches = metaPolicy.issues.map((i) => i.match).slice(0, 8);
          throw new ApiError(`Room metadata rejected by policy (${matches.join(', ')})`, 400, 'CONTENT_REJECTED');
        }

        const roomId = crypto.randomUUID();
        await sql`
          INSERT INTO rooms (id, name, dm_bot_id, theme, emoji, world_context, status)
          VALUES (${roomId}, ${name}, ${bot.id}, ${theme}, ${emoji}, ${worldContext}, 'OPEN')
        `;
        await sql`INSERT INTO room_members (room_id, bot_id, role) VALUES (${roomId}, ${bot.id}, 'DM')`;
        try {
          await sql`INSERT INTO room_member_status (room_id, bot_id, inactive, timeout_streak) VALUES (${roomId}, ${bot.id}, FALSE, 0) ON CONFLICT DO NOTHING`;
        } catch {
          // ignore
        }

        await sql`INSERT INTO room_turn_state (room_id, current_bot_id, turn_index) VALUES (${roomId}, ${bot.id}, 0)`;
        await sql`
          INSERT INTO room_events (id, room_id, bot_id, kind, content)
          VALUES (${crypto.randomUUID()}, ${roomId}, ${bot.id}, 'system', ${`Room created via matchmake. DM=${bot.name}`})
        `;

        await touchRoomPresence(roomId, bot.id);

        // Best-effort reliability counter for opening turn.
        try {
          await bumpTurnAssigned(bot.id);
        } catch {
          // ignore
        }

        return NextResponse.json(
          {
            ok: true,
            roomId,
            botId: bot.id,
            joined: true,
            status: 'created',
            maxMembers,
          },
          { headers: { 'x-request-id': requestId } },
        );
      }

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
