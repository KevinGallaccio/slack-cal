import { config } from '../config.js';
import { logger } from '../logger.js';

interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  [k: string]: unknown;
}

async function call(
  method: string,
  body: Record<string, unknown>,
  token: string
): Promise<SlackResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as SlackResponse;
  if (!json.ok) {
    logger.error({ method, error: json.error }, 'slack API error');
    throw new Error(`slack ${method} failed: ${json.error}`);
  }
  return json;
}

/** users.profile.set requires a user token (xoxp), not a bot token. */
export async function setProfileStatus(
  statusText: string,
  emoji: string,
  expirationUnix = 0
): Promise<void> {
  await call(
    'users.profile.set',
    {
      profile: {
        status_text: statusText.slice(0, 100),
        status_emoji: emoji,
        status_expiration: expirationUnix,
      },
    },
    config.SLACK_USER_TOKEN
  );
}

export async function getProfileStatus(): Promise<{ status_text: string; status_emoji: string }> {
  const res = await call('users.profile.get', {}, config.SLACK_USER_TOKEN);
  const profile = (res.profile ?? {}) as { status_text?: string; status_emoji?: string };
  return {
    status_text: profile.status_text ?? '',
    status_emoji: profile.status_emoji ?? '',
  };
}

export async function clearProfileStatus(): Promise<void> {
  await setProfileStatus('', '', 0);
}

export async function postMessage(
  channel: string,
  text: string,
  blocks?: unknown[]
): Promise<{ ts: string; channel: string }> {
  const res = await call(
    'chat.postMessage',
    { channel, text, ...(blocks ? { blocks } : {}) },
    config.SLACK_BOT_TOKEN
  );
  return { ts: res.ts!, channel: res.channel ?? channel };
}

export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  blocks?: unknown[]
): Promise<void> {
  await call(
    'chat.update',
    { channel, ts, text, ...(blocks ? { blocks } : {}) },
    config.SLACK_BOT_TOKEN
  );
}

export async function openIm(userId: string): Promise<string> {
  const res = await call('conversations.open', { users: userId }, config.SLACK_BOT_TOKEN);
  const channel = res.channel as { id: string } | undefined;
  if (!channel?.id) throw new Error('conversations.open returned no channel id');
  return channel.id;
}
