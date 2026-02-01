import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      const { status, response } = handleApiError(new Error('Missing token'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

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
      if (existing.rowCount === 0) {
        const { status, response } = handleApiError(new Error('Invalid token'), requestId);
        return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
      }
      return NextResponse.json(
        { bot: existing.rows[0], status: 'already_claimed' },
        { headers: { 'x-request-id': requestId } },
      );
    }

    return NextResponse.json({ bot: updated.rows[0], status: 'claimed' }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
