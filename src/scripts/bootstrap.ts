/**
 * One-shot CLI: ensure calendars + watch channels exist for the OAuth'd
 * accounts. The same logic runs automatically on app startup; this script
 * is here for manual reruns / debugging from a local terminal.
 */
import { logger } from '../logger.js';
import { ensureCalendarsAndWatches } from '../google/setup.js';
import { pool } from '../db/client.js';

async function main(): Promise<void> {
  await ensureCalendarsAndWatches();
  await pool.end();
  console.log('\nBootstrap complete.');
}

main().catch((err) => {
  logger.error({ err }, 'bootstrap failed');
  process.exit(1);
});
