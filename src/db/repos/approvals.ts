import { query } from '../client.js';

export interface PendingApproval {
  id: string;
  event_id: string;
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  expires_at: Date;
}

export async function createApproval(
  eventId: string,
  expiresAt: Date
): Promise<PendingApproval> {
  const { rows } = await query<PendingApproval>(
    `INSERT INTO pending_approvals (event_id, expires_at) VALUES ($1, $2) RETURNING *`,
    [eventId, expiresAt]
  );
  return rows[0]!;
}

export async function attachSlackMessage(
  id: string,
  channelId: string,
  ts: string
): Promise<void> {
  await query(
    `UPDATE pending_approvals SET slack_channel_id = $1, slack_message_ts = $2 WHERE id = $3`,
    [channelId, ts, id]
  );
}

export async function getApproval(id: string): Promise<PendingApproval | null> {
  const { rows } = await query<PendingApproval>(
    `SELECT * FROM pending_approvals WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function deleteApproval(id: string): Promise<void> {
  await query(`DELETE FROM pending_approvals WHERE id = $1`, [id]);
}

export async function listAll(): Promise<PendingApproval[]> {
  const { rows } = await query<PendingApproval>(
    `SELECT * FROM pending_approvals ORDER BY expires_at DESC`
  );
  return rows;
}
