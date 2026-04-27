/**
 * After running `npm run auth` and completing the OAuth flow (once per
 * Google account you want to monitor), this script:
 *   1. Maps WORK_CALENDAR_ID / PERSONAL_CALENDAR_ID -> the right google_account
 *      by matching the calendar ID against authenticated account emails
 *   2. Creates Google Calendar watch channels for each
 *
 * Idempotent -- safe to re-run.
 */
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as accountsRepo from '../db/repos/google-accounts.js';
import * as calendarsRepo from '../db/repos/calendars.js';
import type { CalendarSource } from '../db/repos/calendars.js';
import * as channelsRepo from '../db/repos/watch-channels.js';
import { createWatchChannel } from '../google/watch.js';
import { pool } from '../db/client.js';

type Account = Awaited<ReturnType<typeof accountsRepo.listAccounts>>[number];

function findAccountForCalendar(calendarId: string, accounts: Account[]): Account {
  // 1. Primary calendars: ID is the owner's email -> exact match wins.
  const exact = accounts.find((a) => a.email === calendarId);
  if (exact) return exact;

  // 2. Literal "primary" only works when there's exactly one OAuth'd account.
  if (calendarId === 'primary') {
    if (accounts.length === 1) return accounts[0]!;
    throw new Error(
      `calendar id "primary" is ambiguous with ${accounts.length} accounts authenticated. ` +
        `Use the explicit calendar id (your email) instead. ` +
        `Authenticated: ${accounts.map((a) => a.email).join(', ')}`
    );
  }

  // 3. Sub-calendars (opaque IDs ending in @group.calendar.google.com) can't
  //    be auto-mapped. Either OAuth the owning account, or share to one we have.
  throw new Error(
    `Could not map calendar "${calendarId}" to any authenticated Google account. ` +
      `Authenticated: ${accounts.map((a) => a.email).join(', ') || '(none)'}. ` +
      `Run \`npm run auth\` while signed in to the owning account.`
  );
}

async function main(): Promise<void> {
  const accounts = await accountsRepo.listAccounts();
  if (accounts.length === 0) {
    console.error('No Google accounts found. Run `npm run auth` first.');
    process.exit(1);
  }
  logger.info({ accounts: accounts.map((a) => a.email) }, 'authenticated accounts');

  const wanted: { calendarId: string; source: CalendarSource }[] = [
    { calendarId: config.WORK_CALENDAR_ID, source: 'work' },
  ];
  if (config.PERSONAL_CALENDAR_ID) {
    wanted.push({ calendarId: config.PERSONAL_CALENDAR_ID, source: 'personal' });
  }

  for (const { calendarId, source } of wanted) {
    const account = findAccountForCalendar(calendarId, accounts);
    const cal = await calendarsRepo.upsertCalendar(account.id, calendarId, source);
    logger.info(
      { calendarId: cal.calendar_id, source, account: account.email },
      'registered calendar'
    );
  }

  const calendars = await calendarsRepo.listCalendars();
  const allChannels = await channelsRepo.listAll();
  for (const cal of calendars) {
    const has = allChannels.find((c) => c.calendar_id === cal.id);
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
