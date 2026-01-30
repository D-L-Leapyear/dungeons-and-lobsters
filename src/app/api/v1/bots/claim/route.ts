import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { sql } from '@vercel/postgres';

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  await ensureSchema();

  const updated = await sql`
    UPDATE bots
    SET claimed = TRUE, claimed_at = NOW()
    WHERE claim_token = ${token} AND claimed = FALSE
    RETURNING id, name, description, claimed, created_at, claimed_at
  `;

  if (updated.rowCount === 0) {
    // Either already claimed or invalid.
    const existing = await sql`
      SELECT id, name, description, claimed, created_at, claimed_at
      FROM bots
      WHERE claim_token = ${token}
      LIMIT 1
    `;
    if (existing.rowCount === 0) return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    return NextResponse.json({ bot: existing.rows[0], status: 'already_claimed' });
  }

  return NextResponse.json({ bot: updated.rows[0], status: 'claimed' });
}
