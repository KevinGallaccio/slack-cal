import { query } from '../client.js';

export interface GoogleAccount {
  id: number;
  email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: Date | null;
}

export async function upsertAccount(
  email: string,
  refreshToken: string
): Promise<GoogleAccount> {
  const { rows } = await query<GoogleAccount>(
    `INSERT INTO google_accounts (email, refresh_token)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET refresh_token = EXCLUDED.refresh_token
     RETURNING *`,
    [email, refreshToken]
  );
  return rows[0]!;
}

export async function getAccountByEmail(email: string): Promise<GoogleAccount | null> {
  const { rows } = await query<GoogleAccount>(
    `SELECT * FROM google_accounts WHERE email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function listAccounts(): Promise<GoogleAccount[]> {
  const { rows } = await query<GoogleAccount>(`SELECT * FROM google_accounts ORDER BY id`);
  return rows;
}

export async function updateAccessToken(
  id: number,
  accessToken: string,
  expiresAt: Date
): Promise<void> {
  await query(
    `UPDATE google_accounts SET access_token = $1, access_token_expires_at = $2 WHERE id = $3`,
    [accessToken, expiresAt, id]
  );
}
