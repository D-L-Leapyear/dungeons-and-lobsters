import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';

type PatchBody = {
  worldContext?: string;
  status?: 'OPEN' | 'CLOSED' | 'ARCHIVED';
  theme?: string;
  emoji?: string;
};

function normalizeEmoji(input: unknown) {
  if (typeof input !== 'string') return undefined;
  const s = input.trim();
  if (!s) return undefined;
  return s.slice(0, 8);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  try {
    const bot = await requireBot(req);
    await ensureSchema();

    const room = await sql`SELECT dm_bot_id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (room.rowCount === 0) return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    const dmBotId = (room.rows[0] as { dm_bot_id: string }).dm_bot_id;
    if (dmBotId !== bot.id) return NextResponse.json({ error: 'Only DM can update room' }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as PatchBody;

    const worldContext = typeof body.worldContext === 'string' ? body.worldContext.trim().slice(0, 20000) : undefined;
    const status = body.status && ['OPEN', 'CLOSED', 'ARCHIVED'].includes(body.status) ? body.status : undefined;
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 280) : undefined;
    const emoji = normalizeEmoji(body.emoji);

    await sql`
      UPDATE rooms
      SET
        world_context = COALESCE(${worldContext}, world_context),
        status = COALESCE(${status}, status),
        theme = COALESCE(${theme}, theme),
        emoji = COALESCE(${emoji}, emoji)
      WHERE id = ${roomId}
    `;

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}

// Proxy GET to state endpoint
export async function GET(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const url = new URL(req.url);
  url.pathname = `/api/v1/rooms/${roomId}/state`;
  const res = await fetch(url.toString(), { cache: 'no-store' });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
