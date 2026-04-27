import { logger } from '../logger.js';
import * as jobsRepo from '../db/repos/scheduled-jobs.js';
import * as classRepo from '../db/repos/classifications.js';
import * as currentStatus from '../db/repos/current-status.js';
import { classify } from '../classifier/haiku.js';
import { scheduleJob, cancelJobsForEvent } from './index.js';
import { clearProfileStatus } from '../slack/client.js';
import type { CalendarEvent } from '../google/types.js';
import type { CalendarSource } from '../db/repos/calendars.js';

const ASK_LEAD_MS = 60 * 1000;

/**
 * Decide what to do with a single event change. Called from the Google webhook
 * handler for each item returned by an incremental sync.
 */
export async function processEvent(
  event: CalendarEvent,
  calendarRowId: number,
  source: CalendarSource
): Promise<void> {
  if (event.status === 'cancelled') {
    await handleDeleted(event.id);
    return;
  }

  const startStr = event.start.dateTime ?? event.start.date;
  const endStr = event.end.dateTime ?? event.end.date;
  if (!startStr || !endStr) {
    logger.warn({ eventId: event.id }, 'event has no start/end; skipping');
    return;
  }

  const existing = await classRepo.getClassification(event.id);
  const eventUpdated = new Date(event.updated);
  const unchanged =
    existing && existing.event_updated_at.getTime() === eventUpdated.getTime();

  if (!unchanged) {
    const result = await classify({
      calendar_source: source,
      event_title: event.summary ?? '(no title)',
      event_description: event.description ?? '',
      event_location: event.location ?? '',
      attendees: (event.attendees ?? [])
        .map((a) => a.displayName ?? a.email)
        .filter((s): s is string => Boolean(s)),
      start: startStr,
      end: endStr,
    });
    await classRepo.upsertClassification({
      event_id: event.id,
      calendar_id: calendarRowId,
      event_updated_at: eventUpdated,
      action: result.action,
      status_text: result.status_text,
      emoji: result.emoji,
      suggestions: result.suggestions ?? null,
      reason: result.reason,
    });
  }

  const classification = await classRepo.getClassification(event.id);
  if (!classification) return;

  await cancelJobsForEvent(event.id);

  if (classification.action === 'skip') {
    logger.debug({ eventId: event.id, reason: classification.reason }, 'skip event');
    return;
  }

  const start = new Date(startStr);
  const end = new Date(endStr);

  if (classification.action === 'set') {
    const setJob = await jobsRepo.upsertJob(event.id, 'set', start, {
      status_text: classification.status_text ?? '',
      emoji: classification.emoji ?? ':calendar:',
      end: endStr,
    });
    await scheduleJob(setJob);

    const clearJob = await jobsRepo.upsertJob(event.id, 'clear', end, {
      event_id: event.id,
    });
    await scheduleJob(clearJob);
    return;
  }

  if (classification.action === 'ask') {
    const triggerAt = new Date(start.getTime() - ASK_LEAD_MS);
    const askJob = await jobsRepo.upsertJob(event.id, 'ask', triggerAt, {
      event_title: event.summary ?? '(no title)',
      suggestions: classification.suggestions ?? [],
    });
    await scheduleJob(askJob);
    // clear job is scheduled later, after the user confirms in the DM
  }
}

async function handleDeleted(eventId: string): Promise<void> {
  await cancelJobsForEvent(eventId);
  const current = await currentStatus.getCurrent();
  if (current.event_id === eventId) {
    await clearProfileStatus();
    await currentStatus.clearCurrent();
    logger.info({ eventId }, 'cleared status for deleted event');
  }
  await classRepo.deleteClassification(eventId);
}
