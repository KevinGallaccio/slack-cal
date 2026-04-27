import { query } from '../client.js';

export interface WatchChannel {
  id: number;
  calendar_id: number;
  channel_id: string;
  resource_id: string;
  token: string;
  expires_at: Date;
}

export async function insertWatchChannel(
  calendarId: number,
  channelId: string,
  resourceId: string,
  token: string,
  expiresAt: Date
): Promise<WatchChannel> {
  const { rows } = await query<WatchChannel>(
    `INSERT INTO watch_channels (calendar_id, channel_id, resource_id, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [calendarId, channelId, resourceId, token, expiresAt]
  );
  return rows[0]!;
}

export async function getByChannelId(channelId: string): Promise<WatchChannel | null> {
  const { rows } = await query<WatchChannel>(
    `SELECT * FROM watch_channels WHERE channel_id = $1`,
    [channelId]
  );
  return rows[0] ?? null;
}

export async function listExpiringSoon(hours: number): Promise<WatchChannel[]> {
  const { rows } = await query<WatchChannel>(
    `SELECT * FROM watch_channels WHERE expires_at < NOW() + ($1 || ' hours')::interval`,
    [hours]
  );
  return rows;
}

export async function listAll(): Promise<WatchChannel[]> {
  const { rows } = await query<WatchChannel>(`SELECT * FROM watch_channels ORDER BY id`);
  return rows;
}

export async function deleteByChannelId(channelId: string): Promise<void> {
  await query(`DELETE FROM watch_channels WHERE channel_id = $1`, [channelId]);
}
