import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireValidUUID } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

function mdQuoteBlock(text: string) {
  const lines = String(text ?? '').split('\n');
  return lines.map((l) => `> ${l}`).join('\n');
}

function safeFilenamePart(s: string) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    const url = new URL(req.url);
    const format = (url.searchParams.get('format') || 'md').toLowerCase();
    const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') || 2000)));

    const [roomRes, membersRes, npcsRes, eventsRes] = await Promise.all([
      sql`
        SELECT r.id, r.name, r.emoji, r.theme, r.tags, r.world_context, r.status, r.created_at, r.dm_bot_id,
               b.name as dm_name
        FROM rooms r
        JOIN bots b ON b.id = r.dm_bot_id
        WHERE r.id = ${roomId}
        LIMIT 1
      `,
      sql`
        SELECT m.bot_id, m.role, m.joined_at, b.name as bot_name
        FROM room_members m
        JOIN bots b ON b.id = m.bot_id
        WHERE m.room_id = ${roomId}
        ORDER BY (CASE WHEN m.role = 'DM' THEN 0 ELSE 1 END), m.joined_at ASC
      `,
      sql`
        SELECT id, name, description, stat_block_json, created_at, updated_at
        FROM room_npcs
        WHERE room_id = ${roomId}
        ORDER BY updated_at DESC
        LIMIT 200
      `,
      sql`
        SELECT e.id, e.kind, e.content, e.created_at, b.name as bot_name
        FROM room_events e
        LEFT JOIN bots b ON b.id = e.bot_id
        WHERE e.room_id = ${roomId}
          AND (e.hidden IS NOT TRUE)
        ORDER BY e.created_at ASC
        LIMIT ${limit}
      `,
    ]);

    if (roomRes.rowCount === 0) {
      const { status, response } = handleApiError(new Error('Room not found'), requestId);
      return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
    }

    const room = roomRes.rows[0] as {
      id: string;
      name: string;
      emoji: string;
      theme: string;
      tags?: string[];
      world_context: string;
      status: string;
      created_at: string;
      dm_bot_id: string;
      dm_name: string;
    };

    if (format === 'json') {
      return NextResponse.json(
        {
          room,
          members: membersRes.rows,
          npcs: npcsRes.rows,
          events: eventsRes.rows,
          limit,
        },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
      );
    }

    const md = [
      `# Dungeons & Lobsters — Room Export`,
      ``,
      `- Room: **${room.name}** (${room.id})`,
      `- Status: **${room.status}**`,
      `- Created: ${room.created_at}`,
      `- DM: **${room.dm_name}**`,
      room.theme ? `- Theme: ${room.theme}` : null,
      room.tags && room.tags.length ? `- Tags: ${room.tags.map((t) => `#${t}`).join(' ')}` : null,
      ``,
      `## Members`,
      ...membersRes.rows.map((m) => {
        const row = m as { bot_id: string; role: string; bot_name: string; joined_at: string };
        return `- ${row.role}: **${row.bot_name}** (${row.bot_id})`; // joined_at omitted (noisy)
      }),
      ``,
      `## World context`,
      room.world_context ? mdQuoteBlock(room.world_context) : `> (none)`,
      ``,
      `## NPCs`,
      ...(npcsRes.rows.length
        ? npcsRes.rows.flatMap((n) => {
            const row = n as { id: string; name: string; description: string };
            return [`- **${row.name}** (${row.id})`, row.description ? `  - ${row.description.replace(/\n/g, '\n    ')}` : null].filter(
              (x): x is string => typeof x === 'string',
            );
          })
        : [`- (none)`]),
      ``,
      `## Events (chronological, capped at ${limit})`,
      ``,
      ...eventsRes.rows.flatMap((e) => {
        const row = e as { id: string; kind: string; content: string; created_at: string; bot_name: string | null };
        const who = row.bot_name || 'system';
        return [
          `### ${row.created_at} — ${who} (${row.kind})`,
          mdQuoteBlock(row.content || ''),
          ``,
        ];
      }),
    ]
      .filter((x): x is string => typeof x === 'string')
      .join('\n');

    const filename = safeFilenamePart(`dnl-room-${room.id}.md`);

    return new NextResponse(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'cache-control': 'no-store', 'x-request-id': requestId } });
  }
}
