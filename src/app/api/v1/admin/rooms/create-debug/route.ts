import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { sql } from '@vercel/postgres';
import { rateLimit } from '@/lib/rate';
// (no handleApiError; we return raw errors for admin debugging)
import { generateRequestId, createLogger } from '@/lib/logger';

/**
 * Admin-only debug endpoint to reproduce room creation failures and return raw error.
 *
 * This exists because POST /api/v1/rooms requires bot auth, so admins can't easily
 * reproduce issues and see the underlying DB error.
 */
export async function POST(req: Request) {
  const requestId = generateRequestId();
  const log = createLogger({ requestId });

  try {
    requireAdmin(req);

    const id = crypto.randomUUID();
    const name = `Admin debug room ${id.slice(0, 8)}`;

    // Reproduce the *real* create-room pipeline as closely as possible.
    // We create a temporary bot row as the DM so we don't need a real bot API key.
    const dmBotId = crypto.randomUUID();
    const dmName = `AdminDebugDM_${id.slice(0, 6)}`;
    const dmApiKey = `dal_${crypto.randomUUID().replace(/-/g, '')}`;
    const dmClaimToken = `claim_${crypto.randomUUID().replace(/-/g, '')}`;

    log.info('Admin debug create room start', { roomId: id, dmBotId });

    await sql`INSERT INTO bots (id, name, description, api_key, claim_token, claimed) VALUES (${dmBotId}, ${dmName}, 'admin debug', ${dmApiKey}, ${dmClaimToken}, TRUE)`;

    // 1) Global open-room cap check
    const openCount = await sql`SELECT COUNT(*)::int AS c FROM rooms WHERE status = 'OPEN'`;
    const c = (openCount.rows[0] as { c: number }).c;
    if (c >= 10) {
      throw new Error('Room cap reached (10). Try later.');
    }

    // 2) Per-bot cap: max 3 room creations per day
    const rl = await rateLimit({ key: `room_create:${dmBotId}`, windowSeconds: 86400, max: 3 });
    if (!rl.ok) {
      throw new Error('Rate limited');
    }

    // 3) Writes
    await sql`
      INSERT INTO rooms (id, name, dm_bot_id, theme, emoji, world_context, status)
      VALUES (${id}, ${name}, ${dmBotId}, 'debug', '🦞', 'debug', 'OPEN')
    `;

    await sql`INSERT INTO room_members (room_id, bot_id, role) VALUES (${id}, ${dmBotId}, 'DM')`;
    await sql`INSERT INTO room_turn_state (room_id, current_bot_id, turn_index) VALUES (${id}, ${dmBotId}, 0)`;
    await sql`INSERT INTO room_events (id, room_id, bot_id, kind, content) VALUES (${crypto.randomUUID()}, ${id}, ${dmBotId}, 'system', ${`Room created. DM=${dmName}`})`;

    // Cleanup: close room + delete it (members/turn/events cascade).
    // Leave bots table row? We'll delete it too.
    await sql`DELETE FROM rooms WHERE id = ${id}`;
    await sql`DELETE FROM bots WHERE id = ${dmBotId}`;

    return NextResponse.json({ ok: true, message: 'Create room pipeline succeeded (and cleaned up).', requestId }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Unknown error');
    log.error('Admin debug create room failed', { error: err.message }, err);

    // Return raw error message for admin debugging.
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        requestId,
      },
      { status: 500, headers: { 'x-request-id': requestId } },
    );
  }
}
