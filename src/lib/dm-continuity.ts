import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

export type DmContinuityResult =
  | { ok: true; changed: false; reason: 'room-not-found' | 'room-not-open' | 'no-change' }
  | { ok: true; changed: true; action: 'dm-marked-inactive' | 'dm-reactivated'; dmBotId: string; dmLastSeenAt: string | null }
  | { ok: false; changed: false; error: string };

/**
 * DM continuity under failure.
 *
 * Goal: if the DM bot process disappears, rooms should keep moving.
 *
 * Policy (v1):
 * - If the room is OPEN and the DM bot has no recent presence signal, mark the DM *inactive* for that room.
 *   (This removes the DM from turn ordering, so play continues among remaining members.)
 * - If the DM becomes active again (presence is fresh), reactivate them.
 * - Insert a single system event on each transition (inactive -> active or active -> inactive).
 *
 * Notes:
 * - This does NOT change rooms.dm_bot_id; it only influences turn ordering via room_member_status.inactive.
 * - This function is safe to call opportunistically (idempotent on no-op).
 */
export async function ensureDmContinuity(roomId: string, dmStaleMs: number): Promise<DmContinuityResult> {
  try {
    const dmStaleMsClamped = Math.max(60_000, Math.floor(dmStaleMs));

    const roomRes = await sql`
      SELECT status, dm_bot_id
      FROM rooms
      WHERE id = ${roomId}
      LIMIT 1
    `;

    if ((roomRes.rowCount ?? 0) === 0) return { ok: true, changed: false, reason: 'room-not-found' };

    const room = roomRes.rows[0] as { status: string; dm_bot_id: string };
    if (room.status !== 'OPEN') return { ok: true, changed: false, reason: 'room-not-open' };

    const dmBotId = room.dm_bot_id;

    const pres = await sql`
      SELECT last_seen_at
      FROM room_member_presence
      WHERE room_id = ${roomId} AND bot_id = ${dmBotId}
      LIMIT 1
    `;

    const dmLastSeenAt = (pres.rows[0] as { last_seen_at?: string } | undefined)?.last_seen_at ?? null;

    // Consider stale if missing OR older than threshold.
    const staleRes = await sql`
      SELECT 1
      WHERE ${dmLastSeenAt}::timestamptz IS NULL
         OR ${dmLastSeenAt}::timestamptz < (NOW() - (${dmStaleMsClamped}::int || ' milliseconds')::interval)
      LIMIT 1
    `;

    const dmIsStale = (staleRes.rowCount ?? 0) > 0;

    // Current inactive flag (if any)
    const statusRes = await sql`
      SELECT inactive
      FROM room_member_status
      WHERE room_id = ${roomId} AND bot_id = ${dmBotId}
      LIMIT 1
    `;
    const dmInactive = !!(statusRes.rows[0] as { inactive?: boolean } | undefined)?.inactive;

    // Transition 1: mark inactive (only if currently active)
    if (dmIsStale && !dmInactive) {
      const eventId = crypto.randomUUID();
      const changed = await sql`
        WITH marked AS (
          INSERT INTO room_member_status (room_id, bot_id, inactive, timeout_streak, inactive_at, updated_at)
          VALUES (${roomId}, ${dmBotId}, TRUE, 0, NOW(), NOW())
          ON CONFLICT (room_id, bot_id)
          DO UPDATE SET inactive = TRUE, inactive_at = NOW(), updated_at = NOW()
          WHERE room_member_status.inactive = FALSE
          RETURNING 1
        ), evt AS (
          INSERT INTO room_events (id, room_id, bot_id, kind, content)
          SELECT ${eventId}, ${roomId}, ${dmBotId}, 'system', ${'DM appears offline; continuing without DM until they return.'}
          FROM marked
          RETURNING id
        )
        SELECT 1 AS changed FROM marked
      `;

      if ((changed.rowCount ?? 0) > 0) {
        return { ok: true, changed: true, action: 'dm-marked-inactive', dmBotId, dmLastSeenAt };
      }

      return { ok: true, changed: false, reason: 'no-change' };
    }

    // Transition 2: reactivate (only if currently inactive and presence is fresh)
    if (!dmIsStale && dmInactive) {
      const eventId = crypto.randomUUID();
      const changed = await sql`
        WITH reactivated AS (
          UPDATE room_member_status
          SET inactive = FALSE, timeout_streak = 0, inactive_at = NULL, updated_at = NOW()
          WHERE room_id = ${roomId} AND bot_id = ${dmBotId} AND inactive = TRUE
          RETURNING 1
        ), evt AS (
          INSERT INTO room_events (id, room_id, bot_id, kind, content)
          SELECT ${eventId}, ${roomId}, ${dmBotId}, 'system', ${'DM is back online; rejoining turn order.'}
          FROM reactivated
          RETURNING id
        )
        SELECT 1 AS changed FROM reactivated
      `;

      if ((changed.rowCount ?? 0) > 0) {
        return { ok: true, changed: true, action: 'dm-reactivated', dmBotId, dmLastSeenAt };
      }

      return { ok: true, changed: false, reason: 'no-change' };
    }

    return { ok: true, changed: false, reason: 'no-change' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Unknown error');
    return { ok: false, changed: false, error: err.message };
  }
}
