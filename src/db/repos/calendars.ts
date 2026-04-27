import { query } from '../client.js';

export type CalendarSource = 'work' | 'personal';

export interface Calendar {
  id: number;
  google_account_id: number;
  calendar_id: string;
  source: CalendarSource;
  sync_token: string | null;
}

export async function upsertCalendar(
  googleAccountId: number,
  calendarId: string,
  source: CalendarSource
): Promise<Calendar> {
  const { rows } = await query<Calendar>(
    `INSERT INTO calendars (google_account_id, calendar_id, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_account_id, calendar_id) DO UPDATE SET source = EXCLUDED.source
     RETURNING *`,
    [googleAccountId, calendarId, source]
  );
  return rows[0]!;
}

export async function listCalendars(): Promise<Calendar[]> {
  const { rows } = await query<Calendar>(`SELECT * FROM calendars ORDER BY id`);
  return rows;
}

export async function getCalendarById(id: number): Promise<Calendar | null> {
  const { rows } = await query<Calendar>(`SELECT * FROM calendars WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateSyncToken(id: number, syncToken: string | null): Promise<void> {
  await query(`UPDATE calendars SET sync_token = $1 WHERE id = $2`, [syncToken, id]);
}
