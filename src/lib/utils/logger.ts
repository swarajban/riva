// Simple structured logger for Riva

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  requestId?: string;
  schedulingRequestId?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: LogContext) {
    console.info(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext = {
      ...context,
      ...(error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) }),
    };
    console.error(formatLog('error', message, errorContext));
  },

  // Create a child logger with default context
  child(defaultContext: LogContext) {
    return {
      debug: (message: string, context?: LogContext) => logger.debug(message, { ...defaultContext, ...context }),
      info: (message: string, context?: LogContext) => logger.info(message, { ...defaultContext, ...context }),
      warn: (message: string, context?: LogContext) => logger.warn(message, { ...defaultContext, ...context }),
      error: (message: string, error?: Error | unknown, context?: LogContext) =>
        logger.error(message, error, { ...defaultContext, ...context }),
    };
  },
};
