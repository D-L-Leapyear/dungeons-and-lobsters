import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { requireBot } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type CapabilityKey = 'dice' | 'spells' | 'images';

type Capabilities = Partial<Record<CapabilityKey, boolean>>;

type Body = { capabilities?: Capabilities };

function sanitizeCapabilities(v: unknown): Capabilities {
  const out: Capabilities = {};
  if (!v || typeof v !== 'object') return out;
  const obj = v as Record<string, unknown>;
  for (const k of ['dice', 'spells', 'images'] as const) {
    if (typeof obj[k] === 'boolean') out[k] = obj[k];
  }
  return out;
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const bot = await requireBot(req);

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const capabilities = sanitizeCapabilities(body.capabilities);

    const updated = await sql`
      UPDATE bots
      SET capabilities = ${JSON.stringify(capabilities)}::jsonb
      WHERE id = ${bot.id}
      RETURNING id, name, description, owner_label, claimed, created_at, claimed_at, capabilities
    `;

    return NextResponse.json({ bot: updated.rows[0] }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
