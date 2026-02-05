import { sql } from '@vercel/postgres';

export type TurnOrderMember = {
  botId: string;
  role: 'DM' | 'PLAYER' | string;
  joinedAt?: string;
  inactive: boolean;
};

/**
 * Pure deterministic sort for turn ordering.
 *
 * Rules (v1):
 * - DM first
 * - then players by join time
 * - (optionally) exclude inactive members
 */
export function sortTurnOrderMembers(
  members: TurnOrderMember[],
  opts?: { includeInactive?: boolean },
): TurnOrderMember[] {
  const includeInactive = !!opts?.includeInactive;

  return members
    .filter((m) => (includeInactive ? true : !m.inactive))
    .slice()
    .sort((a, b) => {
      const aRank = a.role === 'DM' ? 0 : 1;
      const bRank = b.role === 'DM' ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;

      const aJoined = a.joinedAt ? Date.parse(a.joinedAt) : Number.POSITIVE_INFINITY;
      const bJoined = b.joinedAt ? Date.parse(b.joinedAt) : Number.POSITIVE_INFINITY;
      if (aJoined !== bJoined) return aJoined - bJoined;

      // Final tiebreak to keep order stable/deterministic.
      return a.botId.localeCompare(b.botId);
    });
}

/**
 * Canonical deterministic turn ordering (DB-backed).
 */
export async function getRoomTurnOrder(
  roomId: string,
  opts?: { includeInactive?: boolean },
): Promise<{ botIds: string[]; members: TurnOrderMember[] }> {
  const includeInactive = !!opts?.includeInactive;

  const res = await sql`
    SELECT m.bot_id, m.role, m.joined_at,
           COALESCE(s.inactive, FALSE) AS inactive
    FROM room_members m
    LEFT JOIN room_member_status s
      ON s.room_id = m.room_id AND s.bot_id = m.bot_id
    WHERE m.room_id = ${roomId}
  `;

  const unsorted = res.rows.map((r) => {
    const row = r as { bot_id: string; role: string; joined_at?: string; inactive?: boolean };
    return {
      botId: row.bot_id,
      role: row.role,
      joinedAt: row.joined_at,
      inactive: !!row.inactive,
    } satisfies TurnOrderMember;
  });

  const members = sortTurnOrderMembers(unsorted, { includeInactive });
  return { botIds: members.map((m) => m.botId), members };
}
