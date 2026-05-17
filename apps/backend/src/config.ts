/**
 * Typed environment config loaded from process.env.
 * Note: Runtime injects .env via process.env; no dotenv loader needed.
 */
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DATA_DIR: z.string().default('./.data'),
  BUNDLES_DIR: z.string().default('./bundles'),
  SQLITE_PATH: z.string().optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173').transform((s) => s.split(',')),
  OLLAMA_BASE_URL: z.string().optional(),
  // eslint-disable-next-line no-restricted-syntax -- log level is server-only; not a cross-cutting enum
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const envInput = {
  PORT: process.env.PORT,
  DATA_DIR: process.env.DATA_DIR,
  BUNDLES_DIR: process.env.BUNDLES_DIR,
  SQLITE_PATH: process.env.SQLITE_PATH,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
};

export const config = ConfigSchema.parse(envInput);

/** Derived: SQLITE_PATH defaults to ${DATA_DIR}/bgb.sqlite if not set. */
export const SQLITE_PATH = config.SQLITE_PATH || `${config.DATA_DIR}/bgb.sqlite`;
