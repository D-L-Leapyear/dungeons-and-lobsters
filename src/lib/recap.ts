import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

const RECAP_EVERY_TURNS = 10;
const RECAP_MAX_ITEMS = 12;
const RECAP_ITEM_MAX_CHARS = 160;

function clip(s: string, n: number) {
  const t = s.trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + '…';
}

/**
 * Periodic, spectator-first recap event.
 *
 * This is deliberately deterministic + cheap:
 * - Every N turns, we insert a `recap` event.
 * - Content is a curated excerpt of the last few non-system events (no LLM summarization).
 */
export async function maybeInsertRecapForTurn(roomId: string, turnIndex: number) {
  try {
    if (turnIndex <= 0) return { ok: true, inserted: false as const };
    if (turnIndex % RECAP_EVERY_TURNS !== 0) return { ok: true, inserted: false as const };

    // Avoid duplicate inserts in case multiple tick paths hit the same boundary.
    const existing = await sql`
      SELECT 1
      FROM room_events
      WHERE room_id = ${roomId}
        AND kind = 'recap'
        AND content LIKE ${`Recap (turn #${turnIndex}%`}
      LIMIT 1
    `;
    if ((existing.rowCount ?? 0) > 0) return { ok: true, inserted: false as const };

    const roomRes = await sql`SELECT dm_bot_id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    const dmBotId = (roomRes.rows[0] as { dm_bot_id: string } | undefined)?.dm_bot_id;
    if (!dmBotId) return { ok: true, inserted: false as const };

    const recent = await sql`
      SELECT e.kind, e.content, e.created_at, b.name AS bot_name
      FROM room_events e
      LEFT JOIN bots b ON b.id = e.bot_id
      WHERE e.room_id = ${roomId}
        AND e.kind <> 'recap'
        AND e.kind <> 'system'
      ORDER BY e.created_at DESC
      LIMIT ${RECAP_MAX_ITEMS}
    `;

    const items = [...recent.rows]
      .reverse()
      .map((r) => {
        const row = r as { kind: string; content: string; bot_name: string | null };
        const who = row.bot_name ?? 'unknown';
        const what = clip(row.content ?? '', RECAP_ITEM_MAX_CHARS);
        const kind = row.kind || 'say';
        return `- [${kind}] ${who}: ${what}`;
      })
      .filter(Boolean);

    const content = [`Recap (turn #${turnIndex})`, '', ...(items.length ? items : ['- (no recent player/DM events)'])].join('\n');

    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${crypto.randomUUID()}, ${roomId}, ${dmBotId}, 'recap', ${content})
    `;

    return { ok: true, inserted: true as const };
  } catch {
    // best-effort; recap should never break gameplay
    return { ok: false, inserted: false as const };
  }
}
