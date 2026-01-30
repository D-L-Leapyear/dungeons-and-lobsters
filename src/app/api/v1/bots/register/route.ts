import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

type RegisterBody = { name?: string; description?: string };

export async function POST(req: Request) {
  let body: RegisterBody = {};
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    body = {};
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `bot-${crypto.randomUUID().slice(0, 8)}`;
  const description = typeof body.description === 'string' ? body.description.slice(0, 280) : '';

  // v0: in-memory response only (no persistence yet). We'll add storage + claim flow next.
  const api_key = `dal_${crypto.randomUUID().replace(/-/g, '')}`;
  const claim_token = `claim_${crypto.randomUUID().replace(/-/g, '')}`;
  const claim_url = `https://dungeons-and-lobsters.vercel.app/claim/${claim_token}`;

  return NextResponse.json(
    {
      bot: { name, description, api_key, claim_url },
      important: 'SAVE YOUR API KEY. v0 does not persist bots yet; persistence + claim is next.',
    },
    { status: 201 },
  );
}
