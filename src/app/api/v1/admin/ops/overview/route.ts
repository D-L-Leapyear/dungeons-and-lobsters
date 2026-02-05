import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireAdmin } from '@/lib/admin';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { getSseStatsSnapshot } from '@/lib/sse-stats';

export async function GET(req: Request) {
  const requestId = generateRequestId();
  try {
    requireAdmin(req);

    const url = new URL(req.url);
    const stuckSec = Math.min(3600, Math.max(30, Number(url.searchParams.get('stuckSec') || 300)));
    const sinceMinutes = Math.min(24 * 60, Math.max(1, Number(url.searchParams.get('sinceMinutes') || 60)));
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

    const openRoomsRes = await sql`
      SELECT
        r.id,
        r.name,
        r.emoji,
        r.status,
        r.created_at,
        b.name as dm_name,
        ts.current_bot_id,
        ts.turn_index,
        ts.updated_at as turn_updated_at,
        EXTRACT(EPOCH FROM (NOW() - ts.updated_at))::int as turn_age_sec
      FROM rooms r
      JOIN bots b ON b.id = r.dm_bot_id
      JOIN room_turn_state ts ON ts.room_id = r.id
      WHERE r.status = 'OPEN'
      ORDER BY ts.updated_at ASC
      LIMIT 200
    `;

    const stuckRooms = (openRoomsRes.rows as Array<{ turn_age_sec: number }>).filter((r) => r.turn_age_sec >= stuckSec);

    const joinFailuresRes = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE created_at >= ${since})::int as since_count
      FROM telemetry_events
      WHERE kind = 'room_join_failed'
    `;

    const topJoinFailuresRes = await sql`
      SELECT bot_id, COUNT(*)::int as count
      FROM telemetry_events
      WHERE kind = 'room_join_failed'
        AND created_at >= ${since}
        AND bot_id IS NOT NULL
      GROUP BY bot_id
      ORDER BY count DESC
      LIMIT 20
    `;

    const topOffendersRes = await sql`
      SELECT br.bot_id, b.name, b.owner_label, br.turns_assigned, br.turns_taken, br.watchdog_timeouts, br.updated_at
      FROM bot_reliability br
      JOIN bots b ON b.id = br.bot_id
      ORDER BY br.watchdog_timeouts DESC, br.updated_at DESC
      LIMIT 20
    `;

    const sse = getSseStatsSnapshot();

    // Provide a small, stable shape to avoid ballooning payload size.
    // (Counts are best-effort and only cover the current server process.)
    const byRoomTop = Object.entries(sse.byRoom)
      .map(([roomId, count]) => ({ roomId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        params: { stuckSec, sinceMinutes, since },
        rooms: {
          open: openRoomsRes.rows,
          stuck: stuckRooms,
        },
        joins: {
          failures: joinFailuresRes.rows[0] ?? { total: 0, since_count: 0 },
          topFailuresSince: topJoinFailuresRes.rows,
        },
        reliability: {
          topOffenders: topOffendersRes.rows,
        },
        sse: {
          activeTotal: sse.activeTotal,
          byRoomTop,
        },
      },
      { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
