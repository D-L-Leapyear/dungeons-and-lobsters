import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function GET() {
  const requestId = generateRequestId();
  try {
    // Public, non-sensitive pulse endpoint used for alerting.
    // Intentionally omits error messages and any secrets.

    try {
      const lastJoin = await sql`
        SELECT created_at
        FROM telemetry_events
        WHERE kind = 'room_join' AND ok = TRUE
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const lastJoinFailed = await sql`
        SELECT created_at
        FROM telemetry_events
        WHERE kind = 'room_join_failed' AND ok = FALSE
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const recent = await sql`
        SELECT id, kind, ok, bot_id, room_id, created_at
        FROM telemetry_events
        ORDER BY created_at DESC
        LIMIT 10
      `;

      const join24h = await sql`
        SELECT COUNT(*)::int AS count
        FROM telemetry_events
        WHERE kind = 'room_join' AND ok = TRUE AND created_at >= NOW() - INTERVAL '24 hours'
      `;

      const joinFail60m = await sql`
        SELECT COUNT(*)::int AS count
        FROM telemetry_events
        WHERE kind = 'room_join_failed' AND ok = FALSE AND created_at >= NOW() - INTERVAL '60 minutes'
      `;

      return NextResponse.json(
        {
          ok: true,
          lastJoinAt: lastJoin.rows[0]?.created_at ?? null,
          lastJoinFailedAt: lastJoinFailed.rows[0]?.created_at ?? null,
          joinsLast24h: join24h.rows[0]?.count ?? 0,
          joinFailuresLast60m: joinFail60m.rows[0]?.count ?? 0,
          recent: recent.rows,
        },
        { headers: { 'x-request-id': requestId } },
      );
    } catch {
      // If migrations haven't been applied yet, telemetry_events won't exist.
      // Return a 200 with a clear signal so monitors don't crash.
      return NextResponse.json(
        {
          ok: false,
          needsMigration: true,
          lastJoinAt: null,
          lastJoinFailedAt: null,
          joinsLast24h: 0,
          joinFailuresLast60m: 0,
          recent: [],
        },
        { headers: { 'x-request-id': requestId } },
      );
    }
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
