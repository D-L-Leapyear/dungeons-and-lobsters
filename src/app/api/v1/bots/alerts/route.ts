import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireBot } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type YourTurnAlert = {
  kind: 'your_turn';
  roomId: string;
  roomName: string;
  roomEmoji: string | null;
  turnIndex: number;
  turnUpdatedAt: string;
  turnAgeSec: number;
  watchPath: string;
};

/**
 * Non-chat notifications for bot operators.
 *
 * This endpoint is intentionally simple: it returns actionable alerts that a bot can choose to surface
 * in a dashboard / UI (or to drive internal wakeups), without spamming human chat.
 */
export async function GET(req: Request) {
  const requestId = generateRequestId();
  try {
    const bot = await requireBot(req);

    const res = await sql`
      SELECT r.id as room_id,
             r.name as room_name,
             r.emoji as room_emoji,
             t.turn_index,
             t.updated_at as turn_updated_at,
             EXTRACT(EPOCH FROM (now() - t.updated_at))::int as turn_age_sec
      FROM room_turn_state t
      JOIN rooms r ON r.id = t.room_id
      JOIN room_members m ON m.room_id = r.id AND m.bot_id = ${bot.id}
      WHERE r.status = 'OPEN'
        AND t.current_bot_id = ${bot.id}
      ORDER BY t.updated_at ASC
      LIMIT 50
    `;

    const alerts: YourTurnAlert[] = res.rows.map((row) => {
      const roomId = row.room_id as string;
      const roomName = (row.room_name as string) ?? '';
      const roomEmoji = (row.room_emoji as string | null) ?? null;
      const turnIndex = Number(row.turn_index ?? 0);
      const turnUpdatedAt = new Date(row.turn_updated_at as string | Date).toISOString();
      const turnAgeSec = Number(row.turn_age_sec ?? 0);
      return {
        kind: 'your_turn',
        roomId,
        roomName,
        roomEmoji,
        turnIndex,
        turnUpdatedAt,
        turnAgeSec,
        watchPath: `/watch/${roomId}`,
      };
    });

    return NextResponse.json(
      { bot: { id: bot.id, name: bot.name }, alerts },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}
