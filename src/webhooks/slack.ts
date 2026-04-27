import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { verifySlackSignature } from '../slack/interactive.js';
import { confirmationBlocks, customStatusModal } from '../slack/blocks.js';
import { setProfileStatus, updateMessage } from '../slack/client.js';
import * as approvals from '../db/repos/approvals.js';
import * as classRepo from '../db/repos/classifications.js';
import * as jobsRepo from '../db/repos/scheduled-jobs.js';
import * as currentStatus from '../db/repos/current-status.js';
import { scheduleJob } from '../scheduler/index.js';

interface InteractivePayload {
  type: string;
  user: { id: string };
  channel?: { id: string };
  message?: { ts: string };
  trigger_id?: string;
  view?: {
    state?: { values?: Record<string, Record<string, { value?: string }>> };
    private_metadata?: string;
  };
  actions?: { action_id: string; value: string }[];
}

export function registerSlackWebhook(app: FastifyInstance): void {
  app.post(
    '/webhooks/slack/interactive',
    { config: { rawBody: true } },
    async (req: FastifyRequest, reply) => {
      const rawBody = (req.body ?? '') as string | Record<string, unknown>;
      // fastify's @fastify/formbody parses body; we need raw for signature verification
      // — see registerRawBody hook in src/index.ts
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';

      const ok = verifySlackSignature(
        raw,
        req.headers['x-slack-request-timestamp'] as string | undefined,
        req.headers['x-slack-signature'] as string | undefined
      );
      if (!ok) {
        reply.code(401);
        return { error: 'invalid signature' };
      }

      const params =
        typeof rawBody === 'string'
          ? new URLSearchParams(rawBody)
          : new URLSearchParams(rawBody as Record<string, string>);
      const payloadStr = params.get('payload');
      if (!payloadStr) {
        reply.code(400);
        return { error: 'missing payload' };
      }

      const payload = JSON.parse(payloadStr) as InteractivePayload;

      if (payload.type === 'block_actions') {
        return handleBlockAction(payload, reply);
      }
      if (payload.type === 'view_submission') {
        return handleViewSubmission(payload, reply);
      }

      reply.code(200);
      return { ok: true };
    }
  );
}

async function handleBlockAction(
  payload: InteractivePayload,
  reply: import('fastify').FastifyReply
): Promise<unknown> {
  const action = payload.actions?.[0];
  if (!action) {
    reply.code(200);
    return {};
  }

  const [choice, approvalId] = action.value.split('|');
  if (!approvalId) {
    reply.code(200);
    return {};
  }

  const approval = await approvals.getApproval(approvalId);
  if (!approval) {
    logger.warn({ approvalId }, 'approval not found (expired?)');
    reply.code(200);
    return {};
  }

  if (choice === 'custom') {
    if (!payload.trigger_id) {
      reply.code(200);
      return {};
    }
    await openModal(payload.trigger_id, approvalId);
    reply.code(200);
    return {};
  }

  const channelId = payload.channel?.id ?? approval.slack_channel_id ?? '';
  const messageTs = payload.message?.ts ?? approval.slack_message_ts ?? '';

  if (choice === 'skip') {
    if (channelId && messageTs) {
      await updateMessage(channelId, messageTs, 'OK, posted nothing.', confirmationBlocks('Nothing'));
    }
    await approvals.deleteApproval(approvalId);
    reply.code(200);
    return {};
  }

  // choice is the index of the suggestion
  const idx = Number(choice);
  const cls = await classRepo.getClassification(approval.event_id);
  const suggestion = cls?.suggestions?.[idx];
  if (!suggestion) {
    logger.warn({ approvalId, choice }, 'suggestion not found');
    reply.code(200);
    return {};
  }

  await applyStatus(approval.event_id, suggestion.status_text, suggestion.emoji);
  if (channelId && messageTs) {
    await updateMessage(
      channelId,
      messageTs,
      `Set status to ${suggestion.label}`,
      confirmationBlocks(suggestion.label)
    );
  }
  await approvals.deleteApproval(approvalId);
  reply.code(200);
  return {};
}

async function handleViewSubmission(
  payload: InteractivePayload,
  reply: import('fastify').FastifyReply
): Promise<unknown> {
  const approvalId = payload.view?.private_metadata;
  if (!approvalId) {
    reply.code(200);
    return {};
  }
  const approval = await approvals.getApproval(approvalId);
  if (!approval) {
    reply.code(200);
    return {};
  }

  const values = payload.view?.state?.values ?? {};
  const statusText = values['status_block']?.['status_text']?.value ?? '';
  const emoji = values['emoji_block']?.['emoji']?.value ?? ':speech_balloon:';

  await applyStatus(approval.event_id, statusText, emoji);
  if (approval.slack_channel_id && approval.slack_message_ts) {
    await updateMessage(
      approval.slack_channel_id,
      approval.slack_message_ts,
      `Set status to ${statusText}`,
      confirmationBlocks(statusText || 'custom')
    );
  }
  await approvals.deleteApproval(approvalId);

  reply.code(200);
  return { response_action: 'clear' };
}

async function applyStatus(
  eventId: string,
  statusText: string,
  emoji: string
): Promise<void> {
  const cls = await classRepo.getClassification(eventId);
  if (!cls) {
    logger.warn({ eventId }, 'no classification when applying status');
    return;
  }

  await setProfileStatus(statusText, emoji, 0);
  await currentStatus.setCurrent(eventId, statusText, emoji, null);

  // Now schedule the clear job at event end. We don't have event end stored on
  // the approval, so we look it up from the (still-cached) classification's row,
  // which doesn't store end either — fall back to a 2h default. The scheduler
  // also re-runs on webhook updates, so this is best-effort.
  const fallbackEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const clearJob = await jobsRepo.upsertJob(eventId, 'clear', fallbackEnd, {
    event_id: eventId,
  });
  await scheduleJob(clearJob);
}

async function openModal(triggerId: string, approvalId: string): Promise<void> {
  const res = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: customStatusModal(approvalId),
    }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) logger.error({ error: json.error }, 'views.open failed');
}
