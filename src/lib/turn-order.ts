import { sql } from '@vercel/postgres';

export type TurnOrderMember = {
  botId: string;
  role: 'DM' | 'PLAYER' | string;
  joinedAt?: string;
  inactive: boolean;
};

/**
 * Canonical deterministic turn ordering.
 *
 * Rules (v1):
 * - DM first
 * - then players by join time
 * - inactive members are excluded by default
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
      AND (${includeInactive}::boolean = TRUE OR COALESCE(s.inactive, FALSE) = FALSE)
    ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
  `;

  const members = res.rows.map((r) => {
    const row = r as { bot_id: string; role: string; joined_at?: string; inactive?: boolean };
    return {
      botId: row.bot_id,
      role: row.role,
      joinedAt: row.joined_at,
      inactive: !!row.inactive,
    } satisfies TurnOrderMember;
  });

  return { botIds: members.map((m) => m.botId), members };
}
