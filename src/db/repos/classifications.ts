import { query } from '../client.js';

export type ClassificationAction = 'set' | 'ask' | 'skip';

export interface EventClassification {
  event_id: string;
  calendar_id: number;
  event_updated_at: Date;
  action: ClassificationAction;
  status_text: string | null;
  emoji: string | null;
  suggestions: { label: string; status_text: string; emoji: string }[] | null;
  reason: string | null;
  classified_at: Date;
}

export async function upsertClassification(
  c: Omit<EventClassification, 'classified_at'>
): Promise<void> {
  await query(
    `INSERT INTO event_classifications (event_id, calendar_id, event_updated_at, action, status_text, emoji, suggestions, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_id) DO UPDATE SET
       calendar_id = EXCLUDED.calendar_id,
       event_updated_at = EXCLUDED.event_updated_at,
       action = EXCLUDED.action,
       status_text = EXCLUDED.status_text,
       emoji = EXCLUDED.emoji,
       suggestions = EXCLUDED.suggestions,
       reason = EXCLUDED.reason,
       classified_at = NOW()`,
    [
      c.event_id,
      c.calendar_id,
      c.event_updated_at,
      c.action,
      c.status_text,
      c.emoji,
      c.suggestions ? JSON.stringify(c.suggestions) : null,
      c.reason,
    ]
  );
}

export async function getClassification(
  eventId: string
): Promise<EventClassification | null> {
  const { rows } = await query<EventClassification>(
    `SELECT * FROM event_classifications WHERE event_id = $1`,
    [eventId]
  );
  return rows[0] ?? null;
}

export async function deleteClassification(eventId: string): Promise<void> {
  await query(`DELETE FROM event_classifications WHERE event_id = $1`, [eventId]);
}

export async function listRecent(limit: number): Promise<EventClassification[]> {
  const { rows } = await query<EventClassification>(
    `SELECT * FROM event_classifications ORDER BY classified_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
