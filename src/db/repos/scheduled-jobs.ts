import { query } from '../client.js';

export type JobType = 'set' | 'ask' | 'clear';

export interface ScheduledJob {
  id: number;
  event_id: string;
  job_type: JobType;
  trigger_at: Date;
  payload: Record<string, unknown>;
  fired: boolean;
}

export async function upsertJob(
  eventId: string,
  jobType: JobType,
  triggerAt: Date,
  payload: Record<string, unknown>
): Promise<ScheduledJob> {
  const { rows } = await query<ScheduledJob>(
    `INSERT INTO scheduled_jobs (event_id, job_type, trigger_at, payload, fired)
     VALUES ($1, $2, $3, $4, FALSE)
     ON CONFLICT (event_id, job_type) DO UPDATE SET
       trigger_at = EXCLUDED.trigger_at,
       payload = EXCLUDED.payload,
       fired = FALSE
     RETURNING *`,
    [eventId, jobType, triggerAt, JSON.stringify(payload)]
  );
  return rows[0]!;
}

export async function listPending(within: { hours: number }): Promise<ScheduledJob[]> {
  const { rows } = await query<ScheduledJob>(
    `SELECT * FROM scheduled_jobs
     WHERE fired = FALSE
       AND trigger_at < NOW() + ($1 || ' hours')::interval
     ORDER BY trigger_at`,
    [within.hours]
  );
  return rows;
}

export async function listAllPending(): Promise<ScheduledJob[]> {
  const { rows } = await query<ScheduledJob>(
    `SELECT * FROM scheduled_jobs WHERE fired = FALSE ORDER BY trigger_at`
  );
  return rows;
}

export async function markFired(id: number): Promise<void> {
  await query(`UPDATE scheduled_jobs SET fired = TRUE WHERE id = $1`, [id]);
}

export async function deleteByEventId(eventId: string): Promise<void> {
  await query(`DELETE FROM scheduled_jobs WHERE event_id = $1`, [eventId]);
}

export async function getActiveByEventId(eventId: string): Promise<ScheduledJob[]> {
  const { rows } = await query<ScheduledJob>(
    `SELECT * FROM scheduled_jobs WHERE event_id = $1 AND fired = FALSE`,
    [eventId]
  );
  return rows;
}
