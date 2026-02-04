/**
 * Centralized error handling for API routes.
 * Provides standardized error responses and proper HTTP status code mapping.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string;
  code?: string;
  requestId?: string;
  /** Seconds until the caller should retry (present for 429 responses when known). */
  retryAfterSec?: number;
}

/**
 * Map various error types to appropriate HTTP status codes and error responses.
 */
export function handleApiError(error: unknown, requestId?: string): { status: number; response: ErrorResponse } {
  // ApiError instances are already properly formatted
  if (error instanceof ApiError) {
    const ra = (error as ApiError & { retryAfter?: number }).retryAfter;
    return {
      status: error.statusCode,
      response: {
        error: error.message,
        code: error.code,
        requestId,
        ...(typeof ra === 'number' ? { retryAfterSec: ra } : {}),
      },
    };
  }

  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message;

    // Authentication errors
    if (message.includes('Missing Authorization') || message.includes('Invalid API key') || message.includes('Unauthorized')) {
      return {
        status: 401,
        response: {
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
          requestId,
        },
      };
    }

    // Conflict errors (must be checked before generic forbidden)
    if (message.includes('Not your turn') || message.includes('Conflict')) {
      return {
        status: 409,
        response: {
          error: message || 'Conflict',
          code: 'CONFLICT',
          requestId,
        },
      };
    }

    // Authorization errors
    if (message.includes('Only DM') || message.includes('Forbidden')) {
      return {
        status: 403,
        response: {
          error: message || 'Forbidden',
          code: 'FORBIDDEN',
          requestId,
        },
      };
    }

    // Not found errors
    if (message.includes('not found') || message.includes('Not found')) {
      return {
        status: 404,
        response: {
          error: message || 'Resource not found',
          code: 'NOT_FOUND',
          requestId,
        },
      };
    }

    // Validation errors
    if (message.includes('Invalid') || message.includes('Missing') || message.includes('invalid')) {
      return {
        status: 400,
        response: {
          error: message || 'Invalid request',
          code: 'VALIDATION_ERROR',
          requestId,
        },
      };
    }

    // Rate limit errors
    if (message.includes('Rate limited') || message.includes('Too fast') || message.includes('rate limit')) {
      return {
        status: 429,
        response: {
          error: message || 'Too many requests',
          code: 'RATE_LIMITED',
          requestId,
        },
      };
    }

    // Service unavailable
    if (message.includes('Bots are temporarily disabled') || message.includes('temporarily disabled')) {
      return {
        status: 503,
        response: {
          error: message || 'Service temporarily unavailable',
          code: 'SERVICE_UNAVAILABLE',
          requestId,
        },
      };
    }


    // (conflict handled above)
  }

  // Database errors - don't expose details in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction && error instanceof Error) {
    // In development, show more details
    return {
      status: 500,
      response: {
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId,
      },
    };
  }

  // Generic error for production or unknown errors
  return {
    status: 500,
    response: {
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId,
    },
  };
}

/**
 * Helper to create common error types
 */
export const Errors = {
  unauthorized: (message = 'Authentication required') => new ApiError(message, 401, 'AUTH_REQUIRED'),
  forbidden: (message = 'Forbidden') => new ApiError(message, 403, 'FORBIDDEN'),
  notFound: (message = 'Resource not found') => new ApiError(message, 404, 'NOT_FOUND'),
  badRequest: (message = 'Invalid request') => new ApiError(message, 400, 'VALIDATION_ERROR'),
  rateLimited: (message = 'Too many requests', retryAfter?: number) => {
    const error = new ApiError(message, 429, 'RATE_LIMITED');
    (error as ApiError & { retryAfter?: number }).retryAfter = retryAfter;
    return error;
  },
  conflict: (message = 'Conflict') => new ApiError(message, 409, 'CONFLICT'),
  serviceUnavailable: (message = 'Service temporarily unavailable') => new ApiError(message, 503, 'SERVICE_UNAVAILABLE'),
  internal: (message = 'Internal server error') => new ApiError(message, 500, 'INTERNAL_ERROR'),
};

/**
 * Helper to create a NextResponse with standardized error handling
 * Useful for early returns in route handlers
 */
export function errorResponse(message: string, status: number, requestId?: string) {
  const { status: finalStatus, response } = handleApiError(new Error(message), requestId);
  return {
    status: status || finalStatus,
    response,
    requestId,
  };
}

