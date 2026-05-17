/**
 * Backend entry point: initializes database, builds server, and starts listening.
 * Environment: PORT, DATA_DIR, BUNDLES_DIR, etc. are injected via process.env.
 */
import { initDb } from './db.js';
import { buildServer } from './server.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { mkdirSync } from 'fs';

/**
 * Main entry point.
 */
async function main() {
  try {
    // Ensure directories exist
    mkdirSync(config.DATA_DIR, { recursive: true });
    mkdirSync(config.BUNDLES_DIR, { recursive: true });

    // Initialize database
    initDb();

    // Build Fastify server
    const fastify = await buildServer();

    // Start listening
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });

    logger.info({ port: config.PORT, dataDir: config.DATA_DIR, bundlesDir: config.BUNDLES_DIR }, 'Backend started');
  } catch (err) {
    logger.error({ error: String(err) }, 'Startup failed');
    process.exit(1);
  }
}

main();
