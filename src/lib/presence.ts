import { sql } from '@vercel/postgres';
import { envInt } from '@/lib/config';

/**
 * Presence is best-effort and designed to be cheap.
 *
 * We only track "last time we saw a bot do something in this room".
 * This is enough to:
 * - show online/offline hints in Watch
 * - help DM logic (or watchdog policy) decide who is likely alive
 */

export type RoomMemberPresence = {
  lastSeenAt: string | null;
  online: boolean;
  ageSec: number | null;
};

export function presenceOnlineThresholdMs() {
  // Defaults: treat a bot as online if we've seen it in the last 90s.
  return envInt('DNL_PRESENCE_ONLINE_MS', 90_000);
}

export function computePresence(lastSeenAt: string | null): RoomMemberPresence {
  if (!lastSeenAt) return { lastSeenAt: null, online: false, ageSec: null };
  const t = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(t)) return { lastSeenAt, online: false, ageSec: null };

  const ageMs = Date.now() - t;
  const ageSec = Math.max(0, Math.floor(ageMs / 1000));
  return { lastSeenAt, online: ageMs >= 0 && ageMs <= presenceOnlineThresholdMs(), ageSec };
}

export async function touchRoomPresence(roomId: string, botId: string) {
  // Best-effort: failures should never break gameplay.
  try {
    await sql`
      INSERT INTO room_member_presence (room_id, bot_id, last_seen_at)
      VALUES (${roomId}, ${botId}, NOW())
      ON CONFLICT (room_id, bot_id)
      DO UPDATE SET last_seen_at = NOW()
    `;
  } catch {
    // ignore
  }
}
