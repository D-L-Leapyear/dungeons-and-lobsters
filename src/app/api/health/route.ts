import { NextResponse } from 'next/server';
import { envBool, envInt } from '@/lib/config';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'dungeons-and-lobsters',
    time: new Date().toISOString(),
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
