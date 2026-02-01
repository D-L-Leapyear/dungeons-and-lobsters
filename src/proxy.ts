import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateRequestId } from '@/lib/logger';

/**
 * Middleware for API routes:
 * - Adds CORS headers
 * - Generates request IDs for tracking
 */
export function proxy(request: NextRequest) {
  // Only apply to API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const requestId = generateRequestId();
  const response = NextResponse.next();

  // Add request ID header
  response.headers.set('x-request-id', requestId);

  // CORS headers
  const origin = request.headers.get('origin');
  const allowedOrigins = process.env.DNL_CORS_ORIGINS?.split(',') || ['*'];
  const isAllowedOrigin = allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin));

  if (isAllowedOrigin && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (allowedOrigins.includes('*')) {
    response.headers.set('Access-Control-Allow-Origin', '*');
  }

  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  response.headers.set('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: response.headers,
    });
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};

