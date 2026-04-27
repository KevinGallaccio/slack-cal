import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { config } from './config.js';
import { logger } from './logger.js';
import { registerGoogleWebhook } from './webhooks/google.js';
import { registerSlackWebhook } from './webhooks/slack.js';
import { registerGoogleOAuthRoutes } from './webhooks/google-oauth.js';
import { registerAdminRoutes } from './admin.js';
import { recoverOnStartup, startScheduler } from './scheduler/index.js';
import { renewExpiringChannels, startRenewalLoop } from './google/watch.js';
import { ensureCalendarsAndWatchesBestEffort } from './google/setup.js';
import { shutdown as shutdownDb } from './db/client.js';

async function main(): Promise<void> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  // Capture raw body for Slack signature verification.
  app.addHook('preParsing', async (req, _reply, payload) => {
    if (!req.url.startsWith('/webhooks/slack')) return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    (req as typeof req & { rawBody: string }).rawBody = raw;
    const { Readable } = await import('node:stream');
    return Readable.from([raw]);
  });

  await app.register(formbody);

  app.get('/health', async () => ({ ok: true }));

  registerGoogleOAuthRoutes(app);
  registerGoogleWebhook(app);
  registerSlackWebhook(app);
  registerAdminRoutes(app);

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'slack-cal listening');

  await ensureCalendarsAndWatchesBestEffort();
  await recoverOnStartup();
  const sweepHandle = startScheduler();
  await renewExpiringChannels().catch((err) =>
    logger.error({ err }, 'startup renewal failed')
  );
  const renewHandle = startRenewalLoop();

  const onShutdown = async (): Promise<void> => {
    logger.info('shutting down');
    clearInterval(sweepHandle);
    clearInterval(renewHandle);
    await app.close();
    await shutdownDb();
    process.exit(0);
  };
  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);
}

main().catch((err: unknown) => {
  // log to stderr unconditionally so Railway captures it even if pino's
  // serializer hides the cause.
  console.error('fatal startup error:', err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
