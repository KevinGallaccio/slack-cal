import { config } from '../config.js';
import { logger } from '../logger.js';
import * as accountsRepo from '../db/repos/google-accounts.js';
import * as calendarsRepo from '../db/repos/calendars.js';
import type { CalendarSource } from '../db/repos/calendars.js';
import * as channelsRepo from '../db/repos/watch-channels.js';
import { createWatchChannel } from './watch.js';
import { syncAndProcessCalendar } from '../scheduler/process-event.js';

type Account = Awaited<ReturnType<typeof accountsRepo.listAccounts>>[number];

export class CalendarMappingError extends Error {}

function findAccountForCalendar(calendarId: string, accounts: Account[]): Account {
  const exact = accounts.find((a) => a.email === calendarId);
  if (exact) return exact;

  if (calendarId === 'primary') {
    if (accounts.length === 1) return accounts[0]!;
    throw new CalendarMappingError(
      `calendar id "primary" is ambiguous with ${accounts.length} accounts authenticated. ` +
        `Use the explicit calendar id (your email) instead. ` +
        `Authenticated: ${accounts.map((a) => a.email).join(', ')}`
    );
  }

  throw new CalendarMappingError(
    `Could not map calendar "${calendarId}" to any authenticated Google account. ` +
      `Authenticated: ${accounts.map((a) => a.email).join(', ') || '(none)'}. ` +
      `Run \`npm run auth\` while signed in to the owning account.`
  );
}

/**
 * Idempotent: ensures every configured calendar has a row + a watch channel.
 * Throws if no Google accounts are authenticated yet, or if a calendar can't
 * be mapped to an account.
 */
export async function ensureCalendarsAndWatches(): Promise<void> {
  const accounts = await accountsRepo.listAccounts();
  if (accounts.length === 0) {
    throw new CalendarMappingError(
      'No Google accounts authenticated. Visit /auth/google in the browser first.'
    );
  }

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
    const hasChannel = allChannels.find((c) => c.calendar_id === cal.id);
    if (!hasChannel) {
      await createWatchChannel(cal.id);
    }

    // First-time setup: pull existing future events so we don't sit idle
    // waiting for a user-triggered change. Also catches calendars whose
    // sync token was lost (e.g., DB reset) -- they re-baseline cheaply.
    if (!cal.sync_token) {
      try {
        const count = await syncAndProcessCalendar(cal.id);
        logger.info({ calendarId: cal.calendar_id, count }, 'baseline sync complete');
      } catch (err) {
        logger.error({ err, calendarId: cal.calendar_id }, 'baseline sync failed');
      }
    }
  }
}

/**
 * Startup-safe wrapper: logs and swallows errors so a missing OAuth or
 * Google-API blip does not crash the container. Real fixes should be
 * surfaced via logs, not via crash-loops.
 */
export async function ensureCalendarsAndWatchesBestEffort(): Promise<void> {
  try {
    await ensureCalendarsAndWatches();
  } catch (err) {
    if (err instanceof CalendarMappingError) {
      logger.warn({ msg: err.message }, 'skipping calendar bootstrap');
    } else {
      logger.error({ err }, 'calendar bootstrap failed; continuing');
    }
  }
}
