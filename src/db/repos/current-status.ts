import { query } from '../client.js';

export interface CurrentStatus {
  id: number;
  event_id: string | null;
  status_text: string | null;
  emoji: string | null;
  set_at: Date | null;
  expires_at: Date | null;
}

export async function getCurrent(): Promise<CurrentStatus> {
  const { rows } = await query<CurrentStatus>(`SELECT * FROM current_status WHERE id = 1`);
  return rows[0]!;
}

export async function setCurrent(
  eventId: string,
  statusText: string,
  emoji: string,
  expiresAt: Date | null
): Promise<void> {
  await query(
    `UPDATE current_status SET event_id = $1, status_text = $2, emoji = $3, set_at = NOW(), expires_at = $4 WHERE id = 1`,
    [eventId, statusText, emoji, expiresAt]
  );
}

export async function clearCurrent(): Promise<void> {
  await query(
    `UPDATE current_status SET event_id = NULL, status_text = NULL, emoji = NULL, set_at = NULL, expires_at = NULL WHERE id = 1`
  );
}
