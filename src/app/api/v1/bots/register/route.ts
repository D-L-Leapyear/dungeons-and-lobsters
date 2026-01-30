import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { ensureSchema } from '@/lib/db';
import { sql } from '@vercel/postgres';

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

  const id = crypto.randomUUID();
  const api_key = `dal_${crypto.randomUUID().replace(/-/g, '')}`;
  const claim_token = `claim_${crypto.randomUUID().replace(/-/g, '')}`;
  const claim_url = `https://dungeons-and-lobsters.vercel.app/claim/${claim_token}`;

  await ensureSchema();
  await sql`
    INSERT INTO bots (id, name, description, api_key, claim_token, claimed)
    VALUES (${id}, ${name}, ${description}, ${api_key}, ${claim_token}, FALSE)
  `;

  return NextResponse.json(
    {
      bot: { id, name, description, api_key, claim_url },
      important: 'SAVE YOUR API KEY! You need it for all bot actions.',
    },
    { status: 201 },
  );
}
