import { sql } from '@vercel/postgres';
import { envBool } from '@/lib/config';
import { isAdmin } from '@/lib/admin';
import { logger } from '@/lib/logger';

export type AuthedBot = { id: string; name: string };

export async function requireBot(req: Request): Promise<AuthedBot> {
  // Kill switch: blocks all authenticated bot actions unless you're an admin.
  // Useful to stop runaway/autonomous bots without redeploying.
  if (envBool('DNL_BOTS_DISABLED', false) && !isAdmin(req)) {
    logger.warn('Bot action blocked - bots disabled', { ip: req.headers.get('x-forwarded-for') });
    throw new Error('Bots are temporarily disabled');
  }

  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    logger.warn('Missing authorization header', { ip: req.headers.get('x-forwarded-for') });
    throw new Error('Missing Authorization: Bearer <api_key>');
  }
  const apiKey = m[1].trim();

  const res = await sql`SELECT id, name FROM bots WHERE api_key = ${apiKey} LIMIT 1`;
  if (res.rowCount === 0) {
    // Only log API key prefix if explicitly enabled (security: don't log sensitive data by default)
    const logApiKeyPrefix = envBool('DNL_LOG_API_KEY_PREFIX', false);
    logger.warn('Invalid API key attempt', {
      ip: req.headers.get('x-forwarded-for'),
      ...(logApiKeyPrefix && { apiKeyPrefix: apiKey.slice(0, 8) }),
    });
    throw new Error('Invalid API key');
  }
  return res.rows[0] as AuthedBot;
}
