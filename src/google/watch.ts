import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as calendars from '../db/repos/calendars.js';
import * as channels from '../db/repos/watch-channels.js';
import { getAccessToken } from './auth.js';
import type { WatchResponse } from './types.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RENEW_WITHIN_HOURS = 24;

export async function createWatchChannel(calendarRowId: number): Promise<void> {
  const cal = await calendars.getCalendarById(calendarRowId);
  if (!cal) throw new Error(`calendar ${calendarRowId} not found`);

  const accessToken = await getAccessToken(cal.google_account_id);
  const channelId = randomUUID();
  const expiration = Date.now() + SEVEN_DAYS_MS;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    cal.calendar_id
  )}/events/watch`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: `${config.PUBLIC_URL}/webhooks/google`,
      token: config.WATCH_TOKEN_SECRET,
      expiration: String(expiration),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`watch.create failed: ${res.status} ${text}`);
  }

  const body = (await res.json()) as WatchResponse;
  await channels.insertWatchChannel(
    cal.id,
    body.id,
    body.resourceId,
    config.WATCH_TOKEN_SECRET,
    new Date(Number(body.expiration))
  );
  logger.info({ calendarId: cal.calendar_id, channelId: body.id }, 'created watch channel');
}

export async function stopWatchChannel(channelId: string): Promise<void> {
  const ch = await channels.getByChannelId(channelId);
  if (!ch) return;
  const cal = await calendars.getCalendarById(ch.calendar_id);
  if (!cal) {
    await channels.deleteByChannelId(channelId);
    return;
  }
  const accessToken = await getAccessToken(cal.google_account_id);

  const res = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: ch.channel_id, resourceId: ch.resource_id }),
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    logger.warn({ status: res.status, text, channelId }, 'channels.stop returned non-OK');
  }

  await channels.deleteByChannelId(channelId);
  logger.info({ channelId }, 'stopped watch channel');
}

/** Renew any channels expiring soon. Safe to call repeatedly. */
export async function renewExpiringChannels(): Promise<void> {
  const expiring = await channels.listExpiringSoon(RENEW_WITHIN_HOURS);
  for (const ch of expiring) {
    try {
      await createWatchChannel(ch.calendar_id);
      await stopWatchChannel(ch.channel_id);
    } catch (err) {
      logger.error({ err, channelId: ch.channel_id }, 'failed to renew watch channel');
    }
  }
}

/** Run on startup; schedule a daily renewal sweep. */
export function startRenewalLoop(): NodeJS.Timeout {
  const ONE_HOUR = 60 * 60 * 1000;
  return setInterval(() => {
    renewExpiringChannels().catch((err) => logger.error({ err }, 'renewal loop error'));
  }, ONE_HOUR);
}
