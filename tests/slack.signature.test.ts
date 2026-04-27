import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';

// We can't import src/slack/interactive.ts directly because it pulls in
// src/config.ts, which validates env vars at import-time. Set them up first.
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test';
  process.env.GOOGLE_CLIENT_SECRET = 'test';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.com/cb';
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_USER_TOKEN = 'xoxp-test';
  process.env.SLACK_SIGNING_SECRET = 'shhh-this-is-secret';
  process.env.SLACK_USER_ID = 'U123';
  process.env.PUBLIC_URL = 'https://example.com';
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.WATCH_TOKEN_SECRET = 'a-string-of-at-least-16-chars';
});

describe('verifySlackSignature', () => {
  it('accepts a valid signature', async () => {
    const { verifySlackSignature } = await import('../src/slack/interactive.js');
    const secret = 'shhh-this-is-secret';
    const ts = String(Math.floor(Date.now() / 1000));
    const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
    const sig =
      'v0=' +
      createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');

    expect(verifySlackSignature(body, ts, sig)).toBe(true);
  });

  it('rejects an old timestamp', async () => {
    const { verifySlackSignature } = await import('../src/slack/interactive.js');
    const oldTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const sig =
      'v0=' +
      createHmac('sha256', 'shhh-this-is-secret')
        .update(`v0:${oldTs}:body`)
        .digest('hex');
    expect(verifySlackSignature('body', oldTs, sig)).toBe(false);
  });

  it('rejects a tampered body', async () => {
    const { verifySlackSignature } = await import('../src/slack/interactive.js');
    const ts = String(Math.floor(Date.now() / 1000));
    const sig =
      'v0=' +
      createHmac('sha256', 'shhh-this-is-secret')
        .update(`v0:${ts}:original`)
        .digest('hex');
    expect(verifySlackSignature('tampered', ts, sig)).toBe(false);
  });

  it('rejects missing headers', async () => {
    const { verifySlackSignature } = await import('../src/slack/interactive.js');
    expect(verifySlackSignature('body', undefined, undefined)).toBe(false);
  });
});
