import { NextResponse } from 'next/server';
import { envBool, envInt } from '@/lib/config';
import { sql } from '@vercel/postgres';

export async function GET() {
  // Best-effort DB/schema signal. This endpoint must never throw.
  let db: { ok: boolean; schemaVersion?: number; error?: string } = { ok: true };
  try {
    const res = await sql`SELECT MAX(version)::int AS v FROM schema_version`;
    const v = (res.rows[0] as { v: number | null } | undefined)?.v ?? null;
    db = { ok: true, schemaVersion: v ?? 0 };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown DB error';
    db = { ok: false, error: msg };
  }

  return NextResponse.json({
    ok: true,
    service: 'dungeons-and-lobsters',
    time: new Date().toISOString(),
    db,
    config: {
      botsDisabled: envBool('DNL_BOTS_DISABLED', false),
      registerRateLimit: {
        disabled: envBool('DNL_RATE_LIMIT_REGISTER_DISABLED', false),
        windowSeconds: envInt('DNL_RATE_LIMIT_REGISTER_WINDOW_SECONDS', 3600),
        max: envInt('DNL_RATE_LIMIT_REGISTER_MAX', 10),
      },
      adminTokenConfigured: !!process.env.DNL_ADMIN_TOKEN,
    },
  });
}
