import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import * as accounts from '../db/repos/google-accounts.js';
import { logger } from '../logger.js';

export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export function makeOAuthClient(): OAuth2Client {
  return new OAuth2Client(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state?: string, loginHint?: string): string {
  const client = makeOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    // select_account: always show the account picker, even if signed in
    // consent: always return a refresh_token (Google omits it after the first grant otherwise)
    prompt: 'select_account consent',
    scope: SCOPES,
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  email: string;
  refresh_token: string;
  access_token: string;
  expiry_date: number;
}> {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. Revoke prior consent and retry.');
  }
  if (!tokens.id_token) {
    throw new Error('Google did not return an id_token.');
  }
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new Error('id_token has no email claim.');
  }
  return {
    email: payload.email,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token!,
    expiry_date: tokens.expiry_date!,
  };
}

const FIVE_MIN_MS = 5 * 60 * 1000;

export async function getAccessToken(accountId: number): Promise<string> {
  const account = await accounts.listAccounts().then((all) => all.find((a) => a.id === accountId));
  if (!account) throw new Error(`google account ${accountId} not found`);

  const valid =
    account.access_token &&
    account.access_token_expires_at &&
    account.access_token_expires_at.getTime() - Date.now() > FIVE_MIN_MS;

  if (valid) return account.access_token!;

  const client = makeOAuthClient();
  client.setCredentials({ refresh_token: account.refresh_token });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token || !credentials.expiry_date) {
    throw new Error('Failed to refresh Google access token');
  }
  await accounts.updateAccessToken(
    account.id,
    credentials.access_token,
    new Date(credentials.expiry_date)
  );
  logger.debug({ accountId }, 'refreshed Google access token');
  return credentials.access_token;
}
