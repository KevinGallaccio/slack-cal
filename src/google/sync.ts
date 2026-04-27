import { logger } from '../logger.js';
import * as calendars from '../db/repos/calendars.js';
import { getAccessToken } from './auth.js';
import type { CalendarEvent, EventsListResponse } from './types.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface SyncOptions {
  baselineWindowDays?: number;
}

// 6 months covers most personal scheduling horizons. After the first
// baseline, this matters far less -- incremental syncs (via syncToken)
// catch every change, regardless of how far out the event is.
const DEFAULT_BASELINE_WINDOW_DAYS = 180;

/**
 * Performs an incremental sync for one calendar.
 * Returns the events that changed since the last sync, plus the new sync token.
 */
export async function incrementalSync(
  calendarRowId: number,
  opts: SyncOptions = {}
): Promise<{ events: CalendarEvent[]; nextSyncToken: string | null }> {
  const cal = await calendars.getCalendarById(calendarRowId);
  if (!cal) throw new Error(`calendar ${calendarRowId} not found`);

  const accessToken = await getAccessToken(cal.google_account_id);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | null = cal.sync_token;
  let nextSyncToken: string | null = null;
  let usedBaseline = false;

  do {
    const params = new URLSearchParams();
    params.set('singleEvents', 'true');
    if (syncToken) {
      params.set('syncToken', syncToken);
    } else {
      // Initial baseline window: now → +N days.
      usedBaseline = true;
      const days = opts.baselineWindowDays ?? DEFAULT_BASELINE_WINDOW_DAYS;
      params.set('timeMin', new Date().toISOString());
      params.set('timeMax', new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString());
      params.set('orderBy', 'startTime');
    }
    if (pageToken) params.set('pageToken', pageToken);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      cal.calendar_id
    )}/events?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 410) {
      logger.warn({ calendarId: cal.calendar_id }, 'sync token expired; re-baselining');
      await calendars.updateSyncToken(calendarRowId, null);
      return incrementalSync(calendarRowId, opts);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`events.list failed: ${res.status} ${text}`);
    }

    const body = (await res.json()) as EventsListResponse;
    if (body.items) events.push(...body.items);
    pageToken = body.nextPageToken;
    if (!pageToken && body.nextSyncToken) nextSyncToken = body.nextSyncToken;
  } while (pageToken);

  if (nextSyncToken) {
    await calendars.updateSyncToken(calendarRowId, nextSyncToken);
  }

  logger.info(
    { calendarId: cal.calendar_id, count: events.length, baseline: usedBaseline },
    'sync complete'
  );

  return { events, nextSyncToken };
}

/** Returns events whose start is within the next N days (and not cancelled). */
export function filterUpcoming(events: CalendarEvent[], windowMs = SEVEN_DAYS_MS): CalendarEvent[] {
  const now = Date.now();
  return events.filter((e) => {
    if (e.status === 'cancelled') return false;
    const startStr = e.start.dateTime ?? e.start.date;
    if (!startStr) return false;
    const start = new Date(startStr).getTime();
    return start >= now && start <= now + windowMs;
  });
}
