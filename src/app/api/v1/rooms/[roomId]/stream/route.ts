import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events (SSE) endpoint for real-time room updates.
 * Clients can subscribe to this stream to receive updates when room state changes.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;

  // Verify room exists
  const roomCheck = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
  if (roomCheck.rowCount === 0) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastEventId: string | null = null;
      let isClosed = false;

      // Send initial connection message
      const send = (data: string) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(data));
        }
      };

      // Send SSE formatted message
      const sendEvent = (event: string, data: unknown, id?: string) => {
        const lines = [
          `event: ${event}`,
          `data: ${JSON.stringify(data)}`,
          ...(id ? [`id: ${id}`] : []),
          '', // Empty line to end the event
        ];
        send(lines.join('\n'));
      };

      // Send initial ping
      sendEvent('ping', { timestamp: Date.now() });

      // Polling interval (every 2 seconds)
      const pollInterval = 2000;
      let pollTimer: NodeJS.Timeout | null = null;

      const poll = async () => {
        if (isClosed) return;

        try {
          // Get latest events since last check
          const eventsQuery = lastEventId
            ? sql`
                SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
                FROM room_events e
                LEFT JOIN bots b ON b.id = e.bot_id
                WHERE e.room_id = ${roomId} AND e.id > ${lastEventId}
                ORDER BY e.created_at ASC
                LIMIT 50
              `
            : sql`
                SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
                FROM room_events e
                LEFT JOIN bots b ON b.id = e.bot_id
                WHERE e.room_id = ${roomId}
                ORDER BY e.created_at DESC
                LIMIT 10
              `;

          const events = await eventsQuery;

          // Get current turn state
          const turn = await sql`SELECT room_id, current_bot_id, turn_index, updated_at FROM room_turn_state WHERE room_id = ${roomId} LIMIT 1`;

          // Get characters (for HP updates)
          const chars = await sql`
            SELECT bot_id, name, class, level, max_hp, current_hp, is_dead, updated_at
            FROM room_characters
            WHERE room_id = ${roomId}
            ORDER BY updated_at DESC
          `;

          // Get summary
          const summary = await sql`SELECT room_id, party_level, party_current_hp, party_max_hp, updated_at FROM room_summary WHERE room_id = ${roomId} LIMIT 1`;

          // Send updates
          if (events.rows.length > 0) {
            // Send new events
            for (const event of events.rows) {
              sendEvent('event', event, event.id as string);
              lastEventId = event.id as string;
            }
          }

          // Send turn update
          sendEvent('turn', turn.rows[0] ?? null);

          // Send characters update
          sendEvent('characters', chars.rows);

          // Send summary update
          sendEvent('summary', summary.rows[0] ?? null);

          // Schedule next poll
          pollTimer = setTimeout(poll, pollInterval);
        } catch (error) {
          console.error('[SSE] Poll error:', error);
          sendEvent('error', { message: 'Poll failed' });
          // Continue polling even on error
          pollTimer = setTimeout(poll, pollInterval);
        }
      };

      // Start polling
      poll();

      // Handle client disconnect
      if (_req.signal) {
        _req.signal.addEventListener('abort', () => {
          isClosed = true;
          if (pollTimer) {
            clearTimeout(pollTimer);
          }
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

