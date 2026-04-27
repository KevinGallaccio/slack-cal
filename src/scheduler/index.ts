import { logger } from '../logger.js';
import * as jobs from '../db/repos/scheduled-jobs.js';
import type { ScheduledJob } from '../db/repos/scheduled-jobs.js';
import { runJob } from './handlers.js';

const SWEEP_WINDOW_HOURS = 24;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const registered = new Map<number, NodeJS.Timeout>();

export async function scheduleJob(job: ScheduledJob): Promise<void> {
  if (registered.has(job.id)) {
    clearTimeout(registered.get(job.id)!);
    registered.delete(job.id);
  }

  const delay = job.trigger_at.getTime() - Date.now();
  if (delay > MAX_TIMEOUT_MS) {
    // out of window — sweep will pick it up later
    return;
  }

  const handle = setTimeout(() => {
    registered.delete(job.id);
    runJob(job)
      .then(() => jobs.markFired(job.id))
      .catch((err) => logger.error({ err, jobId: job.id }, 'job handler failed'));
  }, Math.max(0, delay));

  registered.set(job.id, handle);
}

export async function cancelJobsForEvent(eventId: string): Promise<void> {
  const active = await jobs.getActiveByEventId(eventId);
  for (const j of active) {
    const handle = registered.get(j.id);
    if (handle) {
      clearTimeout(handle);
      registered.delete(j.id);
    }
  }
  await jobs.deleteByEventId(eventId);
}

/** Load every pending job within the window from Postgres and register timers. */
export async function sweep(): Promise<void> {
  const pending = await jobs.listPending({ hours: SWEEP_WINDOW_HOURS });
  for (const job of pending) {
    if (!registered.has(job.id)) await scheduleJob(job);
  }
  logger.debug({ count: pending.length }, 'scheduler sweep');
}

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    sweep().catch((err) => logger.error({ err }, 'sweep failed'));
  }, SWEEP_INTERVAL_MS);
}

export async function recoverOnStartup(): Promise<void> {
  const all = await jobs.listAllPending();
  logger.info({ count: all.length }, 'recovering pending jobs');
  for (const job of all) {
    if (job.trigger_at.getTime() < Date.now()) {
      // missed during downtime — fire immediately
      runJob(job)
        .then(() => jobs.markFired(job.id))
        .catch((err) => logger.error({ err, jobId: job.id }, 'late job failed'));
    } else {
      await scheduleJob(job);
    }
  }
}
