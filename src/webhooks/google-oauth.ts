import type { FastifyInstance } from 'fastify';
import { exchangeCodeForTokens, getAuthUrl } from '../google/auth.js';
import * as accounts from '../db/repos/google-accounts.js';
import { ensureCalendarsAndWatchesBestEffort } from '../google/setup.js';
import { logger } from '../logger.js';

export function registerGoogleOAuthRoutes(app: FastifyInstance): void {
  app.get('/auth/google', async (req, reply) => {
    const { hint } = req.query as { hint?: string };
    reply.redirect(getAuthUrl(undefined, hint));
  });

  app.get('/auth/google/callback', async (req, reply) => {
    const query = req.query as { code?: string; error?: string };
    if (query.error) {
      reply.code(400);
      return { error: query.error };
    }
    if (!query.code) {
      reply.code(400);
      return { error: 'missing code' };
    }
    const tokens = await exchangeCodeForTokens(query.code);
    const account = await accounts.upsertAccount(tokens.email, tokens.refresh_token);
    await accounts.updateAccessToken(
      account.id,
      tokens.access_token,
      new Date(tokens.expiry_date)
    );
    logger.info({ email: tokens.email }, 'stored Google refresh token');

    // Run bootstrap immediately so this account's calendars + watch channels
    // are registered without a redeploy. Best-effort: failures here log but
    // do not block the success page.
    await ensureCalendarsAndWatchesBestEffort();

    reply.type('text/html');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  .ok { font-size: 2rem; }
  a { color: #0066cc; }
  code { background: #f0f0f0; padding: .15rem .4rem; border-radius: 4px; }
</style>
</head>
<body>
<div class="ok">✓ Connected</div>
<p><strong>${escape(tokens.email)}</strong> is now linked. Calendar registration ran automatically — check the admin page to verify watch channels were created.</p>
<p><a href="/admin">Open admin →</a></p>
<p>To connect another account, click "Connect Google account" on the admin page. Google will show its account picker so you can pick the other one.</p>
</body></html>`;
  });
}

function escape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
