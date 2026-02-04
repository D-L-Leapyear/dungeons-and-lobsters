import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { envInt } from '@/lib/config';
import { computePresence } from '@/lib/presence';
import { getRoomTurnOrder } from '@/lib/turn-order';
import { requireBot } from '@/lib/auth';

type BotContext = {
  botId: string;
  isYourTurn: boolean;
  /** ISO timestamp of the bot's last posted event in this room, if any. */
  lastActionAt: string | null;
  /** Events posted since lastActionAt (useful after reconnect). */
  changes: {
    sinceAt: string | null;
    limit: number;
    events: Array<{
      id: string;
      kind: string;
      content: string;
      created_at: string;
      bot_name: string | null;
    }>;
  };
};

export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    const url = new URL(req.url);
    const includeBotContext = url.searchParams.get('bot') === 'me' || url.searchParams.get('botView') === '1';
    const bot = includeBotContext ? await requireBot(req) : null;

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

    const botContextLimit = 20;

    // Run all independent queries in parallel for better performance
    const [members, chars, summary, turn, events, turnOrder, botDelta] = await Promise.all([
      sql`
        SELECT m.bot_id, m.role, m.joined_at, b.name as bot_name, p.last_seen_at,
               COALESCE(s.inactive, FALSE) as inactive,
               COALESCE(s.timeout_streak, 0) as timeout_streak
        FROM room_members m
        JOIN bots b ON b.id = m.bot_id
        LEFT JOIN room_member_presence p ON p.room_id = m.room_id AND p.bot_id = m.bot_id
        LEFT JOIN room_member_status s ON s.room_id = m.room_id AND s.bot_id = m.bot_id
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
      getRoomTurnOrder(roomId, { includeInactive: true }),
      bot
        ? sql`
            WITH last_action AS (
              SELECT created_at AS at
              FROM room_events
              WHERE room_id = ${roomId} AND bot_id = ${bot.id}
              ORDER BY created_at DESC
              LIMIT 1
            )
            SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name,
                   (SELECT at FROM last_action) AS since_at
            FROM room_events e
            LEFT JOIN bots b ON b.id = e.bot_id
            WHERE e.room_id = ${roomId}
              AND e.created_at > COALESCE((SELECT at FROM last_action), '1970-01-01'::timestamptz)
            ORDER BY e.created_at ASC
            LIMIT ${botContextLimit}
          `
        : Promise.resolve(null),
    ]);

    const memberCount = members.rowCount ?? members.rows.length;
    const playerCount = members.rows.filter((m) => (m as { role?: string }).role === 'PLAYER').length;

    // Party ready rule (configurable)
    // Default: allow start with DM + 1 player; scale up to 5.
    const targetPlayersMin = envInt('DNL_PARTY_MIN_PLAYERS', 1);
    const targetPlayersMax = envInt('DNL_PARTY_MAX_PLAYERS', 5);

    const dmCount = members.rows.filter((m) => (m as { role?: string }).role === 'DM').length;

    const party = {
      memberCount,
      dmCount,
      playerCount,
      targetPlayersMin,
      targetPlayersMax,
      ready: dmCount === 1 && playerCount >= targetPlayersMin && playerCount <= targetPlayersMax,
    };

    const membersWithPresence = members.rows.map((m) => {
      const row = m as {
        bot_id: string;
        role: string;
        joined_at: string;
        bot_name: string;
        last_seen_at?: string | null;
        inactive?: boolean;
        timeout_streak?: number;
      };
      const presence = computePresence(row.last_seen_at ?? null);
      return {
        bot_id: row.bot_id,
        role: row.role,
        joined_at: row.joined_at,
        bot_name: row.bot_name,
        inactive: !!row.inactive,
        timeout_streak: typeof row.timeout_streak === 'number' ? row.timeout_streak : 0,
        presence,
      };
    });

    const allTurnOrderBotIds = turnOrder.botIds;
    const activeTurnOrderBotIds = turnOrder.members.filter((m) => !m.inactive).map((m) => m.botId);

    let botContext: BotContext | null = null;
    if (bot && turn.rows[0]) {
      const currentBotId = (turn.rows[0] as { current_bot_id: string | null }).current_bot_id;

      const rows = (botDelta as typeof botDelta & { rows: unknown[] })?.rows ?? [];
      const sinceAt = (rows[0] as { since_at?: string | null } | undefined)?.since_at ?? null;
      const deltaEvents = rows.map((r) => {
        const row = r as {
          id: string;
          kind: string;
          content: string;
          created_at: string;
          bot_name: string | null;
        };
        return {
          id: row.id,
          kind: row.kind,
          content: row.content,
          created_at: row.created_at,
          bot_name: row.bot_name ?? null,
        };
      });

      botContext = {
        botId: bot.id,
        isYourTurn: currentBotId === bot.id,
        lastActionAt: sinceAt,
        changes: {
          sinceAt,
          limit: botContextLimit,
          events: deltaEvents,
        },
      };
    }

    return NextResponse.json(
      {
        room: roomRes.rows[0],
        party,
        members: membersWithPresence,
        turnOrder: {
          rules: 'DM first, then players by join time; inactive members excluded from activeTurnOrder',
          activeBotIds: activeTurnOrderBotIds,
          allBotIds: allTurnOrderBotIds,
        },
        characters: chars.rows,
        summary: summary.rows[0] ?? null,
        turn: turn.rows[0] ?? null,
        events: events.rows.reverse(),
        ...(botContext ? { botContext } : {}),
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}
