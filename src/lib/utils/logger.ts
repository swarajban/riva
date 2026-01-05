import pino from 'pino';
import { config } from '@/lib/config';

// Create base pino instance
const pinoLogger = pino({
  level: config.isProduction ? 'info' : 'debug',
  ...(config.isProduction
    ? {} // JSON output in production
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss',
          },
        },
      }),
});

export interface LogContext {
  userId?: string;
  requestId?: string;
  schedulingRequestId?: string;
  [key: string]: unknown;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (context) {
      pinoLogger.debug(context, message);
    } else {
      pinoLogger.debug(message);
    }
  },

  info(message: string, context?: LogContext) {
    if (context) {
      pinoLogger.info(context, message);
    } else {
      pinoLogger.info(message);
    }
  },

  warn(message: string, context?: LogContext) {
    if (context) {
      pinoLogger.warn(context, message);
    } else {
      pinoLogger.warn(message);
    }
  },

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext = {
      ...context,
      ...(error instanceof Error
        ? { err: { message: error.message, stack: error.stack, name: error.name } }
        : error !== undefined
          ? { err: String(error) }
          : {}),
    };
    if (Object.keys(errorContext).length > 0) {
      pinoLogger.error(errorContext, message);
    } else {
      pinoLogger.error(message);
    }
  },

  // Create a child logger with default context
  child(defaultContext: LogContext) {
    const childPino = pinoLogger.child(defaultContext);
    return {
      debug: (message: string, context?: LogContext) => {
        if (context) {
          childPino.debug(context, message);
        } else {
          childPino.debug(message);
        }
      },
      info: (message: string, context?: LogContext) => {
        if (context) {
          childPino.info(context, message);
        } else {
          childPino.info(message);
        }
      },
      warn: (message: string, context?: LogContext) => {
        if (context) {
          childPino.warn(context, message);
        } else {
          childPino.warn(message);
        }
      },
      error: (message: string, error?: Error | unknown, context?: LogContext) => {
        const errorContext = {
          ...context,
          ...(error instanceof Error
            ? { err: { message: error.message, stack: error.stack, name: error.name } }
            : error !== undefined
              ? { err: String(error) }
              : {}),
        };
        if (Object.keys(errorContext).length > 0) {
          childPino.error(errorContext, message);
        } else {
          childPino.error(message);
        }
      },
    };
  },
};
