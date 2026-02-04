import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type ClaimBody = { owner_label?: string };

function sanitizeOwnerLabel(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  // Keep it simple + low-risk: short, human-readable hint (no auth semantics).
  return s.slice(0, 64);
}

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    if (!token) {
      const { status, response } = handleApiError(new Error('Missing token'), requestId);
      return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
    }

    let body: ClaimBody = {};
    try {
      body = (await req.json()) as ClaimBody;
    } catch {
      body = {};
    }

    const ownerLabel = sanitizeOwnerLabel(body.owner_label ?? searchParams.get('owner'));

    // First try: claim (only when unclaimed).
    const updated = await sql`
      UPDATE bots
      SET claimed = TRUE,
          claimed_at = NOW(),
          owner_label = CASE WHEN ${ownerLabel} <> '' THEN ${ownerLabel} ELSE owner_label END
      WHERE claim_token = ${token} AND claimed = FALSE
      RETURNING id, name, description, owner_label, claimed, created_at, claimed_at
    `;

    if (updated.rowCount === 0) {
      // Either already claimed or invalid token.
      const existing = await sql`
        SELECT id, name, description, owner_label, claimed, created_at, claimed_at
        FROM bots
        WHERE claim_token = ${token}
        LIMIT 1
      `;
      if (existing.rowCount === 0) {
        const { status, response } = handleApiError(new Error('Invalid token'), requestId);
        return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
      }

      // If the token holder provides an owner label after the fact, allow setting it.
      if (ownerLabel) {
        const relabeled = await sql`
          UPDATE bots
          SET owner_label = ${ownerLabel}
          WHERE claim_token = ${token}
          RETURNING id, name, description, owner_label, claimed, created_at, claimed_at
        `;
        return NextResponse.json(
          { bot: relabeled.rows[0], status: 'already_claimed' },
          { headers: { 'x-request-id': requestId } },
        );
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
