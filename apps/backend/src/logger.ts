/**
 * Pino logger with key-scrubbing serializer to redact sensitive fields.
 * Scrubbed paths: *api_key, *token, headers.x-llm-api-key, headers.x-search-api-key.
 */
import pino from 'pino';
import { config } from './config.js';

const scrubber = (obj: unknown): unknown => {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(scrubber);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('api_key') || lowerKey.includes('token')) {
      result[key] = '[REDACTED]';
    } else if (key === 'headers' && typeof value === 'object' && value !== null) {
      result[key] = scrubber(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = scrubber(value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    serializers: {
      req: (req) => scrubber(req),
      res: (res) => scrubber(res),
      err: (err) => scrubber(err),
    },
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  }),
);
