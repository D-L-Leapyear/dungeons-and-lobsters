import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { sql } from '@vercel/postgres';
import { envInt } from '@/lib/config';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function GET(req: Request) {
  const requestId = generateRequestId();
  try {
    requireAdmin(req);

    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit') ?? envInt('DNL_TELEMETRY_DEFAULT_LIMIT', 50)), 1),
      200,
    );

    const sinceMinutes = Math.min(
      Math.max(Number(url.searchParams.get('sinceMinutes') ?? 60), 1),
      24 * 60,
    );

    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

    const eventsRes = await sql`
      SELECT id, kind, ok, bot_id, room_id, error, meta, created_at
      FROM telemetry_events
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const statsRes = await sql`
      SELECT
        kind,
        ok,
        COUNT(*)::int as count
      FROM telemetry_events
      WHERE created_at >= ${since}
      GROUP BY kind, ok
      ORDER BY kind, ok
    `;

    return NextResponse.json(
      {
        ok: true,
        since,
        stats: statsRes.rows,
        events: eventsRes.rows,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
