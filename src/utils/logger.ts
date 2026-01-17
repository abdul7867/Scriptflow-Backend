/**
 * Production-ready Logger
 * 
 * Outputs structured JSON logs in production for log aggregation (CloudWatch, Datadog, etc.)
 * Human-readable format in development
 * 
 * SECURITY: Automatically redacts sensitive data patterns to prevent credential leaks
 */

const isProduction = process.env.NODE_ENV === 'production';

interface LogEntry {
  level: string;
  timestamp: string;
  message: string;
  meta?: any;
}

/**
 * SECURITY: Patterns to redact from logs
 * These patterns catch common credential formats to prevent accidental exposure
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Cloudinary URL format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  { pattern: /cloudinary:\/\/[^@]+@/gi, replacement: 'cloudinary://[REDACTED]@' },
  // Generic API keys, tokens, secrets in URLs or strings
  { pattern: /(api[_-]?key|apikey|token|secret|password|pwd|auth|credential|bearer)[=:]["']?[a-zA-Z0-9_\-./]{8,}["']?/gi, replacement: '$1=[REDACTED]' },
  // MongoDB connection strings with credentials
  { pattern: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/gi, replacement: 'mongodb$1://[REDACTED]:[REDACTED]@' },
  // Redis URLs with passwords
  { pattern: /redis(s)?:\/\/:[^@]+@/gi, replacement: 'redis$1://:[REDACTED]@' },
  // AWS access keys
  { pattern: /AKIA[A-Z0-9]{16}/gi, replacement: '[AWS_KEY_REDACTED]' },
  // Bearer tokens in headers
  { pattern: /Bearer\s+[a-zA-Z0-9_\-.]+/gi, replacement: 'Bearer [REDACTED]' },
  // GCP service account key patterns
  { pattern: /"private_key":\s*"[^"]+"/gi, replacement: '"private_key": "[REDACTED]"' },
  { pattern: /"client_email":\s*"[^"]+"/gi, replacement: '"client_email": "[REDACTED]"' },
];

/**
 * Redact sensitive data from a string
 */
function redactSensitiveData(str: string): string {
  let result = str;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep redact sensitive data from objects
 */
function redactObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactSensitiveData(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item));
  }

  if (typeof obj === 'object') {
    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Completely redact known sensitive field names
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('token') ||
        lowerKey.includes('credential') ||
        lowerKey.includes('private_key')) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        redacted[key] = redactSensitiveData(value);
      } else if (typeof value === 'object') {
        redacted[key] = redactObject(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  return obj;
}

function formatLog(level: string, msg: string, meta?: any): string {
  const timestamp = new Date().toISOString();

  // SECURITY: Always redact sensitive data
  const safeMsg = redactSensitiveData(msg);
  const safeMeta = meta ? redactObject(meta) : undefined;

  if (isProduction) {
    // Structured JSON for log aggregation in production
    const logEntry: LogEntry = {
      level,
      timestamp,
      message: safeMsg,
      ...(safeMeta && { meta: typeof safeMeta === 'object' ? safeMeta : { data: safeMeta } })
    };
    return JSON.stringify(logEntry);
  }

  // Human-readable format for development
  const metaStr = safeMeta ? ` ${typeof safeMeta === 'object' ? JSON.stringify(safeMeta) : safeMeta}` : '';
  return `[${level.toUpperCase()}] ${timestamp} - ${safeMsg}${metaStr}`;
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
