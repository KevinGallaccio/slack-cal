/**
 * After running `npm run auth` and completing the OAuth flow,
 * this script:
 *   1. Discovers calendars for the authenticated account(s)
 *   2. Maps WORK_CALENDAR_ID and PERSONAL_CALENDAR_ID env vars to rows
 *   3. Creates Google Calendar watch channels for each
 *
 * Idempotent — safe to re-run.
 */
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as accountsRepo from '../db/repos/google-accounts.js';
import * as calendarsRepo from '../db/repos/calendars.js';
import * as channelsRepo from '../db/repos/watch-channels.js';
import { createWatchChannel } from '../google/watch.js';
import { pool } from '../db/client.js';

async function main(): Promise<void> {
  const accounts = await accountsRepo.listAccounts();
  if (accounts.length === 0) {
    console.error('No Google accounts found. Run `npm run auth` first.');
    process.exit(1);
  }

  // Single-tenant: assume the most recent account owns both calendars.
  const account = accounts[accounts.length - 1]!;
  logger.info({ email: account.email }, 'using account');

  const work = await calendarsRepo.upsertCalendar(
    account.id,
    config.WORK_CALENDAR_ID,
    'work'
  );
  logger.info({ id: work.calendar_id }, 'registered work calendar');

  if (config.PERSONAL_CALENDAR_ID) {
    const personal = await calendarsRepo.upsertCalendar(
      account.id,
      config.PERSONAL_CALENDAR_ID,
      'personal'
    );
    logger.info({ id: personal.calendar_id }, 'registered personal calendar');
  }

  const calendars = await calendarsRepo.listCalendars();
  for (const cal of calendars) {
    const existing = await channelsRepo.listAll();
    const has = existing.find((c) => c.calendar_id === cal.id);
    if (has) {
      logger.info({ calendarId: cal.calendar_id }, 'watch channel already exists; skipping');
      continue;
    }
    await createWatchChannel(cal.id);
  }

  await pool.end();
  console.log('\nBootstrap complete.');
}

main().catch((err) => {
  logger.error({ err }, 'bootstrap failed');
  process.exit(1);
});
