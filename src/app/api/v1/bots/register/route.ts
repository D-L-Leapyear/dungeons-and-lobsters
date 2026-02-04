import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { envBool, envInt } from '@/lib/config';
import { getClientIp, rateLimit } from '@/lib/rate';
import { sql } from '@vercel/postgres';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';
import { logTelemetry } from '@/lib/telemetry';

type RegisterBody = { name?: string; description?: string };

export async function POST(req: Request) {
  const requestId = generateRequestId();
  try {
    let body: RegisterBody = {};
    try {
      body = (await req.json()) as RegisterBody;
    } catch {
      body = {};
    }

    const registerRateLimitDisabled = envBool('DNL_RATE_LIMIT_REGISTER_DISABLED', false);
    if (!registerRateLimitDisabled) {
      const windowSeconds = envInt('DNL_RATE_LIMIT_REGISTER_WINDOW_SECONDS', 3600);
      const max = envInt('DNL_RATE_LIMIT_REGISTER_MAX', 10);

      const ip = getClientIp(req);
      const rl = await rateLimit({ key: `register_ip:${ip}`, windowSeconds, max });
      if (!rl.ok) {
        const { status, response } = handleApiError(new Error('Rate limited'), requestId);
        return NextResponse.json(response, {
          status,
          headers: {
            'retry-after': String(rl.retryAfterSec ?? 60),
            'x-request-id': requestId,
          },
        });
      }
    }

    const name =
      typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `bot-${crypto.randomUUID().slice(0, 8)}`;
    const description = typeof body.description === 'string' ? body.description.slice(0, 280) : '';

    const id = crypto.randomUUID();
    const api_key = `dal_${crypto.randomUUID().replace(/-/g, '')}`;
    const claim_token = `claim_${crypto.randomUUID().replace(/-/g, '')}`;

    // Base URL: use the origin of *this request* (avoids Vercel preview/protection domains)
    const baseUrl = new URL(req.url).origin;
    const claim_url = `${baseUrl}/claim/${claim_token}`;

    await sql`
      INSERT INTO bots (id, name, description, api_key, claim_token, claimed)
      VALUES (${id}, ${name}, ${description}, ${api_key}, ${claim_token}, FALSE)
    `;

    await logTelemetry({
      kind: 'bot_register',
      ok: true,
      botId: id,
      meta: { ip: getClientIp(req) },
    });

    return NextResponse.json(
      {
        bot: {
          id,
          name,
          description,
          api_key,
          claim_url,
          claimed: false,
          owner_label: '',
        },
        important: 'SAVE YOUR API KEY! You need it for all bot actions.',
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    await logTelemetry({
      kind: 'bot_register_failed',
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      meta: { ip: getClientIp(req) },
    });
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
