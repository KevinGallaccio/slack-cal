import type { FastifyInstance } from 'fastify';
import { logger } from '../logger.js';
import * as channels from '../db/repos/watch-channels.js';
import * as calendars from '../db/repos/calendars.js';
import { incrementalSync } from '../google/sync.js';
import { processEvent } from '../scheduler/process-event.js';

export function registerGoogleWebhook(app: FastifyInstance): void {
  app.post('/webhooks/google', async (req, reply) => {
    const channelId = req.headers['x-goog-channel-id'] as string | undefined;
    const channelToken = req.headers['x-goog-channel-token'] as string | undefined;
    const resourceState = req.headers['x-goog-resource-state'] as string | undefined;

    if (!channelId) {
      reply.code(400);
      return { error: 'missing X-Goog-Channel-ID' };
    }

    const watch = await channels.getByChannelId(channelId);
    if (!watch) {
      logger.warn({ channelId }, 'unknown channel; ignoring');
      reply.code(200);
      return { ok: true };
    }

    if (channelToken !== watch.token) {
      logger.warn({ channelId }, 'channel token mismatch');
      reply.code(401);
      return { error: 'invalid channel token' };
    }

    // 'sync' is Google's initial handshake — ignore.
    if (resourceState === 'sync') {
      reply.code(200);
      return { ok: true };
    }

    // ack quickly; do work async
    reply.code(200).send({ ok: true });

    setImmediate(() => {
      handleChange(watch.calendar_id).catch((err) =>
        logger.error({ err, channelId }, 'webhook handling failed')
      );
    });
  });
}

async function handleChange(calendarRowId: number): Promise<void> {
  const cal = await calendars.getCalendarById(calendarRowId);
  if (!cal) return;

  const { events } = await incrementalSync(calendarRowId);
  for (const event of events) {
    try {
      await processEvent(event, calendarRowId, cal.source);
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'processEvent failed');
    }
  }
}
