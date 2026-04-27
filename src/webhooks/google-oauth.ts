import type { FastifyInstance } from 'fastify';
import { exchangeCodeForTokens, getAuthUrl } from '../google/auth.js';
import * as accounts from '../db/repos/google-accounts.js';
import { logger } from '../logger.js';

export function registerGoogleOAuthRoutes(app: FastifyInstance): void {
  app.get('/auth/google', async (_req, reply) => {
    reply.redirect(getAuthUrl());
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
    reply.type('text/html');
    return `<html><body><h2>Connected ${tokens.email}</h2><p>You can close this window.</p></body></html>`;
  });
}
