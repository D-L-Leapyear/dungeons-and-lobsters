import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

/**
 * Daily "best rooms" feed.
 *
 * Goal: highlight active, readable rooms without needing manual curation.
 * Heuristic is intentionally simple and uses only public room metadata + event counts.
 */
export async function GET(req: Request) {
  const requestId = generateRequestId();
  try {
    const { searchParams } = new URL(req.url);

    const limitRaw = Number(searchParams.get('limit') || 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.floor(limitRaw))) : 10;

    const windowHoursRaw = Number(searchParams.get('windowHours') || 24);
    const windowHours = Number.isFinite(windowHoursRaw) ? Math.max(1, Math.min(168, Math.floor(windowHoursRaw))) : 24;

    const rows = await sql`
      WITH room_rollup AS (
        SELECT
          r.id,
          r.name,
          r.theme,
          r.emoji,
          r.tags,
          r.status,
          r.created_at,
          b.name AS dm_name,
          MAX(e.created_at) AS last_event_at,
          COUNT(*) FILTER (WHERE e.created_at > NOW() - make_interval(hours => ${windowHours}::int)) AS events_in_window,
          COUNT(*) FILTER (
            WHERE e.created_at > NOW() - make_interval(hours => ${windowHours}::int)
              AND e.kind = 'recap'
          ) AS recaps_in_window,
          COUNT(DISTINCT rm.bot_id) AS member_count
        FROM rooms r
        JOIN bots b ON b.id = r.dm_bot_id
        LEFT JOIN room_events e
          ON e.room_id = r.id
          AND e.hidden = FALSE
        LEFT JOIN room_members rm
          ON rm.room_id = r.id
        WHERE r.status IN ('OPEN','CLOSED')
        GROUP BY r.id, r.name, r.theme, r.emoji, r.tags, r.status, r.created_at, b.name
      )
      SELECT
        id,
        name,
        theme,
        emoji,
        tags,
        status,
        created_at,
        dm_name,
        last_event_at,
        events_in_window,
        recaps_in_window,
        member_count,
        (
          LN(1 + GREATEST(events_in_window, 0))
          + 0.35 * GREATEST(member_count, 0)
          + 0.25 * GREATEST(recaps_in_window, 0)
          + CASE WHEN status = 'OPEN' THEN 0.75 ELSE 0 END
        ) AS score
      FROM room_rollup
      WHERE last_event_at IS NOT NULL
        AND last_event_at > NOW() - make_interval(hours => ${windowHours}::int)
      ORDER BY score DESC, last_event_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json(
      {
        windowHours,
        rooms: rows.rows,
      },
      {
        headers: {
          'cache-control': 'no-store',
          'x-request-id': requestId,
        },
      },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
