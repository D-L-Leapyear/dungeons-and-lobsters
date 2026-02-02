/**
 * URL utility for getting the base URL of the application.
 * Works in both server and client contexts.
 */

/**
 * Get the base URL for the application.
 * Priority:
 * 1. NEXT_PUBLIC_BASE_URL (explicit override)
 * 2. VERCEL_URL (Vercel deployment)
 * 3. Hardcoded fallback for production
 */
export function getBaseUrl(): string {
  // Client-side: use window.location
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Server-side: check environment variables
  // Prefer NEXT_PUBLIC_SITE_URL (canonical public domain) if set.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    return siteUrl.replace(/\/$/, '');
  }

  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) {
    return explicit.replace(/\/$/, ''); // Remove trailing slash
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  // Fallback for production (can be overridden via env var)
  return 'https://dungeons-and-lobsters.vercel.app';
}

/**
 * Get the full URL for a path.
 */
export function getUrl(path: string): string {
  const base = getBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

