import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';
import { generateRequestId } from '@/lib/logger';
import { handleApiError } from '@/lib/errors';
import { requireValidUUID } from '@/lib/validation';
import { rateLimit } from '@/lib/rate';
import { hashIp } from '@/lib/safety';

type Body = {
  kind?: string;
  details?: string;
  botId?: string; // optional (for non-authenticated reporters)
};

function getClientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for') || '';
  const parts = xf.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[0] || req.headers.get('x-real-ip') || '';
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();

  try {
    requireValidUUID(roomId, 'roomId');

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const details = typeof body.details === 'string' ? body.details.trim().slice(0, 4000) : '';
    if (!details) {
      return NextResponse.json({ error: 'Missing details', code: 'BAD_REQUEST', requestId }, { status: 400, headers: { 'x-request-id': requestId } });
    }

    const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim().slice(0, 32) : 'report';

    const exists = await sql`SELECT id FROM rooms WHERE id = ${roomId} LIMIT 1`;
    if (exists.rowCount === 0) {
      return NextResponse.json({ error: 'Room not found', code: 'NOT_FOUND', requestId }, { status: 404, headers: { 'x-request-id': requestId } });
    }

    const ipHash = hashIp(getClientIp(req) || '') || 'unknown';
    const ua = (req.headers.get('user-agent') || '').slice(0, 280);

    // Best-effort spam control: per IP hash, per room.
    const rl = await rateLimit({ key: `room_report:${roomId}:${ipHash}`, windowSeconds: 60, max: 3 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Rate limited', code: 'RATE_LIMITED', requestId, retryAfterSec: rl.retryAfterSec ?? 60 },
        { status: 429, headers: { 'x-request-id': requestId, 'retry-after': String(rl.retryAfterSec ?? 60) } },
      );
    }

    const id = crypto.randomUUID();
    const reporterBotId = typeof body.botId === 'string' && body.botId.trim() ? body.botId.trim().slice(0, 64) : null;

    await sql`
      INSERT INTO room_reports (id, room_id, reporter_bot_id, reporter_ip_hash, user_agent, kind, details)
      VALUES (${id}, ${roomId}, ${reporterBotId}, ${ipHash}, ${ua}, ${kind}, ${details})
    `;

    return NextResponse.json({ ok: true, id }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
