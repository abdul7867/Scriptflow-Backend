/**
 * Production-ready Logger
 * 
 * Outputs structured JSON logs in production for log aggregation (CloudWatch, Datadog, etc.)
 * Human-readable format in development
 */

const isProduction = process.env.NODE_ENV === 'production';

interface LogEntry {
  level: string;
  timestamp: string;
  message: string;
  meta?: any;
}

function formatLog(level: string, msg: string, meta?: any): string {
  const timestamp = new Date().toISOString();
  
  if (isProduction) {
    // Structured JSON for log aggregation in production
    const logEntry: LogEntry = {
      level,
      timestamp,
      message: msg,
      ...(meta && { meta: typeof meta === 'object' ? meta : { data: meta } })
    };
    return JSON.stringify(logEntry);
  }
  
  // Human-readable format for development
  const metaStr = meta ? ` ${typeof meta === 'object' ? JSON.stringify(meta) : meta}` : '';
  return `[${level.toUpperCase()}] ${timestamp} - ${msg}${metaStr}`;
}

export const logger = {
  info: (msg: string, meta?: any) => {
    console.log(formatLog('info', msg, meta));
  },
  error: (msg: string, error?: any) => {
    // For errors, capture stack trace if available
    const errorMeta = error instanceof Error 
      ? { 
          message: error.message, 
          stack: isProduction ? undefined : error.stack,
          name: error.name 
        }
      : error;
    console.error(formatLog('error', msg, errorMeta));
  },
  warn: (msg: string, meta?: any) => {
    console.warn(formatLog('warn', msg, meta));
  },
  debug: (msg: string, meta?: any) => {
    if (!isProduction) {
      console.log(formatLog('debug', msg, meta));
    }
  }
};
