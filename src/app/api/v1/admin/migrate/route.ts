import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { initSchema } from '@/lib/db-init';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

/**
 * Admin-only schema initializer.
 *
 * Why: production may be deployed before migrations are applied.
 * This endpoint provides a controlled, authenticated way to create/upgrade schema.
 */
export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    requireAdmin(req);
    await initSchema();
    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
