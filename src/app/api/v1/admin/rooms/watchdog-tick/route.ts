import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { requireAdmin } from '@/lib/admin';
import { generateRequestId, createLogger } from '@/lib/logger';
import { bumpTurnAssigned, bumpWatchdogTimeout } from '@/lib/reliability';

/**
 * Admin-only watchdog tick.
 *
 * Purpose: keep rooms progressing even if no DM bot process is online.
 *
 * Behaviour:
 * - Scans OPEN rooms.
 * - If the current turn is a PLAYER turn (current_bot_id != null) and is older than `stuckMs`,
 *   advance turn to the next member and write a system event.
 *
 * Query params:
 * - stuckMs (default 300000 = 5m)
 * - limit (default 20)
 */
export async function POST(req: Request) {
  const requestId = generateRequestId();
  const log = createLogger({ requestId });

  try {
    requireAdmin(req);

    const url = new URL(req.url);
    const stuckMs = Math.max(30_000, Number(url.searchParams.get('stuckMs') || 300_000));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 20)));

    // Pull candidate rooms: OPEN + currently on a player turn + updated_at older than threshold.
    const candidates = await sql`
      SELECT r.id AS room_id, r.dm_bot_id, ts.current_bot_id, ts.turn_index, ts.updated_at
      FROM rooms r
      JOIN room_turn_state ts ON ts.room_id = r.id
      WHERE r.status = 'OPEN'
        AND ts.current_bot_id IS NOT NULL
        AND ts.updated_at < (NOW() - (${stuckMs}::int || ' milliseconds')::interval)
      ORDER BY ts.updated_at ASC
      LIMIT ${limit}
    `;

    const advanced: Array<{ roomId: string; fromBotId: string; toBotId: string; turnIndex: number }> = [];

    for (const row of candidates.rows as Array<{ room_id: string; dm_bot_id: string; current_bot_id: string; turn_index: number; updated_at: string }>) {
      const roomId = row.room_id;
      const dmBotId = row.dm_bot_id;

      // Member order (DM first, then players by join time)
      const members = await sql`
        SELECT m.bot_id, m.role
        FROM room_members m
        WHERE m.room_id = ${roomId}
        ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
      `;

      const order = members.rows.map((r) => (r as { bot_id: string }).bot_id);
      if (!order.length) continue;

      const currentBotId = row.current_bot_id;
      const currentIdx = order.indexOf(currentBotId);
      const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % order.length;
      const nextBotId = order[nextIdx];

      // Advance: update turn state + insert system event.
      const eventId = crypto.randomUUID();
      const result = await sql`
        WITH turn_updated AS (
          UPDATE room_turn_state
          SET
            current_bot_id = ${nextBotId},
            turn_index = turn_index + 1,
            updated_at = NOW()
          WHERE room_id = ${roomId}
            AND current_bot_id = ${currentBotId}
          RETURNING turn_index
        ),
        event_inserted AS (
          INSERT INTO room_events (id, room_id, bot_id, kind, content)
          SELECT ${eventId}, ${roomId}, ${dmBotId}, 'system', ${`Watchdog skipped a stuck turn after ${Math.round(stuckMs / 1000)}s`}
          FROM turn_updated
          RETURNING id
        )
        SELECT (SELECT turn_index FROM turn_updated) AS turn_index
      `;

      if ((result.rowCount ?? 0) > 0) {
        advanced.push({ roomId, fromBotId: currentBotId, toBotId: nextBotId, turnIndex: (result.rows[0] as { turn_index: number }).turn_index });
        // Best-effort reliability counters.
        try {
          await bumpWatchdogTimeout(currentBotId);
          await bumpTurnAssigned(nextBotId);
        } catch {
          // ignore
        }
      }
    }

    log.info('watchdog tick complete', { stuckMs, limit, candidates: candidates.rowCount ?? 0, advanced: advanced.length });

    return NextResponse.json({ ok: true, stuckMs, limit, candidates: candidates.rowCount ?? 0, advanced, requestId }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Unknown error');
    log.error('watchdog tick failed', { error: err.message }, err);
    return NextResponse.json({ ok: false, error: err.message, requestId }, { status: 500, headers: { 'x-request-id': requestId } });
  }
}
