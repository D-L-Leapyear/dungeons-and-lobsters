import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { maybeAdvanceStuckTurn } from '@/lib/watchdog';
import { ensureDmContinuity } from '@/lib/dm-continuity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events (SSE) endpoint.
 *
 * Design goal: notify watchers that *something changed* without streaming full state.
 * The client simply calls `router.refresh()` on a `refresh` event.
 *
 * Notes:
 * - We poll the DB (no LISTEN/NOTIFY yet), but we only emit when there is a change.
 * - We use (created_at, id) as a stable cursor; UUID ordering is NOT time ordering.
 */
export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    const roomCheck = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (roomCheck.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;

        // Cursor for events (created_at + id)
        let lastEventCreatedAt: string | null = null;
        let lastEventId: string | null = null;

        // Change tokens for other tables
        let lastTurnUpdatedAt: string | null = null;
        let lastSummaryUpdatedAt: string | null = null;
        let lastCharsUpdatedAt: string | null = null;

        // Cursor for member joins (joined_at + bot_id)
        let lastMemberJoinedAt: string | null = null;
        let lastMemberBotId: string | null = null;

        const send = (data: string) => {
          if (!isClosed) controller.enqueue(encoder.encode(data));
        };

        const sendEvent = (event: string, data: unknown) => {
          send(`event: ${event}\n`);
          send(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Initial hello (client can ignore)
        sendEvent('ping', { t: Date.now() });

        const pollIntervalMs = 2000;
        let pollTimer: NodeJS.Timeout | null = null;

        // Opportunistic watchdog + continuity checks: keep rooms moving without relying on any external cron.
        // We only attempt occasionally to avoid needless DB write pressure.
        const watchdogStuckMs = 5 * 60_000;
        const watchdogMinIntervalMs = 10_000;
        let lastWatchdogAttemptAt = 0;

        // DM continuity: if DM presence goes stale, remove DM from turn order (mark inactive) so play continues.
        const dmStaleMs = 5 * 60_000;
        const dmContinuityMinIntervalMs = 30_000;
        let lastDmContinuityAttemptAt = 0;

        const poll = async () => {
          if (isClosed) return;

          try {
            // 0) Opportunistic continuity checks (event-driven): if someone is watching, keep the room moving.
            const now = Date.now();

            // 0a) DM continuity: if the DM disappears, mark them inactive so turn order excludes DM.
            if (now - lastDmContinuityAttemptAt >= dmContinuityMinIntervalMs) {
              lastDmContinuityAttemptAt = now;
              const dm = await ensureDmContinuity(roomId, dmStaleMs);
              if (dm.ok && dm.changed) {
                sendEvent('refresh', { t: Date.now(), dmContinuity: dm.action });
              }
            }

            // 0b) Turn watchdog: auto-skip stuck turns.
            if (now - lastWatchdogAttemptAt >= watchdogMinIntervalMs) {
              lastWatchdogAttemptAt = now;
              const wd = await maybeAdvanceStuckTurn(roomId, watchdogStuckMs);
              if (wd.ok && wd.advanced) {
                // Immediately nudge clients so they refresh promptly.
                sendEvent('refresh', { t: Date.now(), watchdog: true });
              }
            }

            // 1) Check for new events using a stable cursor
            let newEventsCount = 0;
            if (lastEventCreatedAt && lastEventId) {
              const ev = await sql`
                SELECT id, created_at, kind, bot_id
                FROM room_events
                WHERE room_id = ${roomId}
                  AND (created_at, id) > (${lastEventCreatedAt}::timestamptz, ${lastEventId})
                ORDER BY created_at ASC, id ASC
                LIMIT 50
              `;
              newEventsCount = ev.rowCount ?? 0;
              if (newEventsCount > 0) {
                for (const row of ev.rows as Array<{ id: string; created_at: string; kind: string; bot_id: string | null }>) {
                  sendEvent('eventPosted', {
                    id: row.id,
                    roomId,
                    kind: row.kind,
                    botId: row.bot_id,
                    createdAt: row.created_at,
                  });
                }

                const last = ev.rows[ev.rows.length - 1] as { id: string; created_at: string };
                lastEventCreatedAt = last.created_at;
                lastEventId = last.id;
              }
            } else {
              // Bootstrap cursor from most recent event (if any)
              const last = await sql`
                SELECT id, created_at
                FROM room_events
                WHERE room_id = ${roomId}
                ORDER BY created_at DESC, id DESC
                LIMIT 1
              `;
              if ((last.rowCount ?? 0) > 0) {
                const row = last.rows[0] as { id: string; created_at: string };
                lastEventCreatedAt = row.created_at;
                lastEventId = row.id;
              }
            }

            // 1.5) Check for newly joined members using a stable cursor
            let newMembersCount = 0;
            if (lastMemberJoinedAt && lastMemberBotId) {
              const mem = await sql`
                SELECT bot_id, role, joined_at
                FROM room_members
                WHERE room_id = ${roomId}
                  AND (joined_at, bot_id) > (${lastMemberJoinedAt}::timestamptz, ${lastMemberBotId})
                ORDER BY joined_at ASC, bot_id ASC
                LIMIT 50
              `;
              newMembersCount = mem.rowCount ?? 0;
              if (newMembersCount > 0) {
                for (const row of mem.rows as Array<{ bot_id: string; role: string; joined_at: string }>) {
                  sendEvent('memberJoined', {
                    roomId,
                    botId: row.bot_id,
                    role: row.role,
                    joinedAt: row.joined_at,
                  });
                }

                const last = mem.rows[mem.rows.length - 1] as { bot_id: string; joined_at: string };
                lastMemberJoinedAt = last.joined_at;
                lastMemberBotId = last.bot_id;
              }
            } else {
              // Bootstrap cursor from most recent member (if any)
              const last = await sql`
                SELECT bot_id, joined_at
                FROM room_members
                WHERE room_id = ${roomId}
                ORDER BY joined_at DESC, bot_id DESC
                LIMIT 1
              `;
              if ((last.rowCount ?? 0) > 0) {
                const row = last.rows[0] as { bot_id: string; joined_at: string };
                lastMemberJoinedAt = row.joined_at;
                lastMemberBotId = row.bot_id;
              }
            }

            // 2) Check updated_at tokens
            const [turn, summary, charsLatest] = await Promise.all([
              sql`SELECT current_bot_id, turn_index, updated_at FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`,
              sql`SELECT updated_at FROM room_summary WHERE room_id = ${roomId} LIMIT 1`,
              sql`SELECT updated_at FROM room_characters WHERE room_id = ${roomId} ORDER BY updated_at DESC LIMIT 1`,
            ]);

            const turnRow = (turn.rows[0] as { updated_at?: string; current_bot_id?: string | null; turn_index?: number } | undefined) ?? undefined;
            const turnUpdatedAt = turnRow?.updated_at ?? null;
            const summaryUpdatedAt = (summary.rows[0] as { updated_at?: string } | undefined)?.updated_at ?? null;
            const charsUpdatedAt = (charsLatest.rows[0] as { updated_at?: string } | undefined)?.updated_at ?? null;

            const turnChanged = Boolean(turnUpdatedAt && turnUpdatedAt !== lastTurnUpdatedAt);
            const summaryChanged = Boolean(summaryUpdatedAt && summaryUpdatedAt !== lastSummaryUpdatedAt);
            const charsChanged = Boolean(charsUpdatedAt && charsUpdatedAt !== lastCharsUpdatedAt);

            if (turnChanged) {
              sendEvent('turnAssigned', {
                roomId,
                currentBotId: turnRow?.current_bot_id ?? null,
                turnIndex: turnRow?.turn_index ?? null,
                updatedAt: turnUpdatedAt,
              });
            }

            if (summaryChanged) {
              sendEvent('summaryUpdated', { roomId, updatedAt: summaryUpdatedAt });
            }

            if (charsChanged) {
              sendEvent('charactersUpdated', { roomId, updatedAt: charsUpdatedAt });
            }

            if (turnUpdatedAt) lastTurnUpdatedAt = turnUpdatedAt;
            if (summaryUpdatedAt) lastSummaryUpdatedAt = summaryUpdatedAt;
            if (charsUpdatedAt) lastCharsUpdatedAt = charsUpdatedAt;

            const anythingChanged = newEventsCount > 0 || newMembersCount > 0 || turnChanged || summaryChanged || charsChanged;
            if (anythingChanged) {
              // Single lightweight notification; client refreshes full SSR state.
              sendEvent('refresh', {
                t: Date.now(),
                newEvents: newEventsCount,
                newMembers: newMembersCount,
                turnChanged,
                summaryChanged,
                charsChanged,
              });
            } else {
              // Keep-alive so proxies don’t kill the connection.
              sendEvent('ping', { t: Date.now() });
            }
          } catch (error) {
            console.error('[SSE] Poll error:', error);
            sendEvent('error', { message: 'Poll failed' });
          } finally {
            pollTimer = setTimeout(poll, pollIntervalMs);
          }
        };

        poll();

        req.signal?.addEventListener('abort', () => {
          isClosed = true;
          if (pollTimer) clearTimeout(pollTimer);
          try {
            controller.close();
          } catch {
            // ignore
          }
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'x-request-id': requestId,
      },
    });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
