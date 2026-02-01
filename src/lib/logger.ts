/**
 * Structured logging utility.
 * Provides consistent logging format with request context.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  roomId?: string;
  botId?: string;
  userId?: string;
  [key: string]: unknown;
}

/**
 * Generate a request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Structured logger
 */
class Logger {
  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...context,
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
    };

    // In production, you might want to send this to a logging service
    // For now, we'll use console with structured format
    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logMethod(JSON.stringify(logEntry));
  }

  debug(message: string, context?: LogContext) {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext, error?: Error) {
    this.log('warn', message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error) {
    this.log('error', message, context, error);
  }
}

export const logger = new Logger();

/**
 * Create a logger with default context
 */
export function createLogger(defaultContext: LogContext) {
  return {
    debug: (message: string, context?: LogContext) => logger.debug(message, { ...defaultContext, ...context }),
    info: (message: string, context?: LogContext) => logger.info(message, { ...defaultContext, ...context }),
    warn: (message: string, context?: LogContext, error?: Error) => logger.warn(message, { ...defaultContext, ...context }, error),
    error: (message: string, context?: LogContext, error?: Error) => logger.error(message, { ...defaultContext, ...context }, error),
  };
}

