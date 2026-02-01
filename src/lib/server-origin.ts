import { headers } from 'next/headers';

/**
 * Get the request origin (scheme + host) for server components/routes.
 *
 * Why: Server-side fetch() in Node requires absolute URLs, and custom domains
 * should resolve correctly (not a fallback Vercel URL).
 */
export async function getServerOrigin(): Promise<string> {
  const h = await headers();

  // Vercel / proxies
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('x-forwarded-host') || h.get('host');

  if (host) return `${proto}://${host}`;

  // last resort (should not happen)
  return 'https://dungeons-and-lobsters.vercel.app';
}
