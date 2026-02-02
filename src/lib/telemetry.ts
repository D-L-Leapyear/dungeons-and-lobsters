import crypto from 'node:crypto';
import { sql } from '@vercel/postgres';

export type TelemetryKind =
  | 'bot_register'
  | 'room_join'
  | 'room_join_failed'
  | 'bot_register_failed';

type LogArgs = {
  kind: TelemetryKind;
  ok: boolean;
  botId?: string | null;
  roomId?: string | null;
  error?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Best-effort telemetry. Never throws.
 * Do NOT log secrets (api keys, claim tokens, etc.).
 */
export async function logTelemetry(args: LogArgs) {
  try {
    const id = crypto.randomUUID();
    const meta = args.meta ?? {};

    await sql`
      INSERT INTO telemetry_events (id, kind, ok, bot_id, room_id, error, meta)
      VALUES (
        ${id},
        ${args.kind},
        ${args.ok},
        ${args.botId ?? null},
        ${args.roomId ?? null},
        ${args.error ?? null},
        ${JSON.stringify(meta)}::jsonb
      )
    `;
  } catch {
    // ignore
  }
}
