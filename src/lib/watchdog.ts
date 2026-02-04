import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { maybeInsertRecapForTurn } from '@/lib/recap';
import { getRoomTurnOrder } from '@/lib/turn-order';
import { bumpTurnAssigned, bumpWatchdogTimeout } from '@/lib/reliability';

export type WatchdogAdvanceResult =
  | { ok: true; advanced: false; reason: 'not-stuck' | 'room-not-open' | 'no-turn' | 'no-members' }
  | { ok: true; advanced: true; fromBotId: string; toBotId: string; turnIndex: number; stuckMs: number }
  | { ok: false; advanced: false; error: string };

/**
 * Best-effort server-side turn watchdog.
 *
 * Goal: keep rooms progressing even if a bot goes silent.
 *
 * Policy (v1):
 * - Only applies to OPEN rooms.
 * - Only applies when a PLAYER is currently up (current_bot_id != null).
 * - If the current turn has not updated for `stuckMs`, advance to the next member (DM first, then join order).
 * - Writes a system event (audit trail).
 */
export async function maybeAdvanceStuckTurn(roomId: string, stuckMs: number): Promise<WatchdogAdvanceResult> {
  try {
    const stuckMsClamped = Math.max(30_000, Math.floor(stuckMs));

    const candidate = await sql`
      SELECT r.status, r.dm_bot_id, ts.current_bot_id, ts.turn_index, ts.updated_at
      FROM rooms r
      JOIN room_turn_state ts ON ts.room_id = r.id
      WHERE r.id = ${roomId}
      LIMIT 1
    `;

    if ((candidate.rowCount ?? 0) === 0) return { ok: true, advanced: false, reason: 'no-turn' };

    const row = candidate.rows[0] as {
      status: string;
      dm_bot_id: string;
      current_bot_id: string | null;
      turn_index: number;
      updated_at: string;
    };

    if (row.status !== 'OPEN') return { ok: true, advanced: false, reason: 'room-not-open' };
    if (!row.current_bot_id) return { ok: true, advanced: false, reason: 'not-stuck' };

    const isStuck = await sql`
      SELECT 1
      FROM room_turn_state
      WHERE room_id = ${roomId}
        AND current_bot_id IS NOT NULL
        AND updated_at < (NOW() - (${stuckMsClamped}::int || ' milliseconds')::interval)
      LIMIT 1
    `;

    if ((isStuck.rowCount ?? 0) === 0) return { ok: true, advanced: false, reason: 'not-stuck' };

    const fromBotId = row.current_bot_id;

    // Track consecutive watchdog timeouts, and (optionally) mark bots inactive for this room.
    // Policy (v1): if a PLAYER times out 2 times in a row, mark them inactive and continue.
    // Never marks the DM inactive.
    let becameInactive = false;
    let timeoutStreak: number | null = null;
    try {
      const roleRes = await sql`
        SELECT role
        FROM room_members
        WHERE room_id = ${roomId} AND bot_id = ${fromBotId}
        LIMIT 1
      `;
      const role = (roleRes.rows[0] as { role?: string } | undefined)?.role;

      const upsert = await sql`
        INSERT INTO room_member_status (room_id, bot_id, inactive, timeout_streak, updated_at)
        VALUES (${roomId}, ${fromBotId}, FALSE, 1, NOW())
        ON CONFLICT (room_id, bot_id)
        DO UPDATE SET timeout_streak = room_member_status.timeout_streak + 1, updated_at = NOW()
        RETURNING timeout_streak, inactive
      `;

      const s = upsert.rows[0] as { timeout_streak: number; inactive: boolean };
      timeoutStreak = s.timeout_streak;

      if (role === 'PLAYER' && !s.inactive && timeoutStreak >= 2) {
        const marked = await sql`
          UPDATE room_member_status
          SET inactive = TRUE, inactive_at = NOW(), updated_at = NOW()
          WHERE room_id = ${roomId} AND bot_id = ${fromBotId} AND inactive = FALSE
          RETURNING inactive
        `;
        becameInactive = (marked.rowCount ?? 0) > 0;
      }
    } catch {
      // best-effort; watchdog should never fail due to this logic
    }

    const { botIds: order } = await getRoomTurnOrder(roomId);
    if (!order.length) return { ok: true, advanced: false, reason: 'no-members' };

    const currentIdx = order.indexOf(fromBotId);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % order.length;
    const toBotId = order[nextIdx];

    const eventId = crypto.randomUUID();
    const result = await sql`
      WITH turn_updated AS (
        UPDATE room_turn_state
        SET
          current_bot_id = ${toBotId},
          turn_index = turn_index + 1,
          updated_at = NOW()
        WHERE room_id = ${roomId}
          AND current_bot_id = ${fromBotId}
          AND updated_at < (NOW() - (${stuckMsClamped}::int || ' milliseconds')::interval)
        RETURNING turn_index
      ),
      event_inserted AS (
        INSERT INTO room_events (id, room_id, bot_id, kind, content)
        SELECT ${eventId}, ${roomId}, ${row.dm_bot_id}, 'system', ${
          becameInactive
            ? `Watchdog auto-skipped a stuck turn after ${Math.round(stuckMsClamped / 1000)}s (bot marked inactive after ${timeoutStreak ?? 2} consecutive timeouts)`
            : `Watchdog auto-skipped a stuck turn after ${Math.round(stuckMsClamped / 1000)}s`
        }
        FROM turn_updated
        RETURNING id
      )
      SELECT (SELECT turn_index FROM turn_updated) AS turn_index
    `;

    if ((result.rowCount ?? 0) === 0) return { ok: true, advanced: false, reason: 'not-stuck' };

    const turnIndex = (result.rows[0] as { turn_index: number }).turn_index;

    // Best-effort recap insertion on turn boundaries.
    await maybeInsertRecapForTurn(roomId, turnIndex);

    // Best-effort reliability counters.
    try {
      await bumpWatchdogTimeout(fromBotId);
      await bumpTurnAssigned(toBotId);
    } catch {
      // ignore
    }

    return {
      ok: true,
      advanced: true,
      fromBotId,
      toBotId,
      turnIndex,
      stuckMs: stuckMsClamped,
    };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Unknown error');
    return { ok: false, advanced: false, error: err.message };
  }
}
