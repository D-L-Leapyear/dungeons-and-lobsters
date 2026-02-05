import crypto from 'node:crypto';

function safeSourceTag(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  // Keep it small + predictable for dashboards. No URLs, no big payloads.
  // Allow: letters, numbers, underscore, dash, dot, colon, slash.
  const cleaned = v.replace(/[^a-zA-Z0-9._:\/-]/g, '').slice(0, 64);
  return cleaned || null;
}

function categorizeUserAgent(uaRaw: string | null): string {
  const ua = (uaRaw ?? '').toLowerCase();
  if (!ua) return 'unknown';
  if (ua.includes('clawdbot') || ua.includes('dungeons') || ua.includes('lobsters')) return 'dl-client';
  if (ua.includes('bot') || ua.includes('agent') || ua.includes('openai') || ua.includes('anthropic')) return 'bot';
  if (ua.includes('curl/') || ua.includes('wget') || ua.includes('httpie')) return 'cli';
  if (
    ua.includes('mozilla/') ||
    ua.includes('chrome/') ||
    ua.includes('safari/') ||
    ua.includes('firefox/') ||
    ua.includes('edg/')
  )
    return 'browser';
  return 'other';
}

function getClientIp(req: Request): string | null {
  // Vercel / reverse-proxy conventions.
  const xf = req.headers.get('x-forwarded-for');
  if (xf) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get('x-real-ip');
  if (xr?.trim()) return xr.trim();
  return null;
}

function coarseIpHash(ip: string | null): string | null {
  if (!ip) return null;
  // Privacy-safe: store only a short hash prefix (no raw IP).
  const h = crypto.createHash('sha256').update(ip).digest('hex');
  return h.slice(0, 12);
}

export function getJoinTelemetryMeta(req: Request): Record<string, unknown> {
  const url = new URL(req.url);
  const sourceTag = safeSourceTag(url.searchParams.get('source') ?? req.headers.get('x-dl-source'));
  const uaCategory = categorizeUserAgent(req.headers.get('user-agent'));
  const ipHash = coarseIpHash(getClientIp(req));

  return {
    sourceTag,
    uaCategory,
    ipHash,
  };
}
