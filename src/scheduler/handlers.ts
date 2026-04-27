import { config } from '../config.js';
import { logger } from '../logger.js';
import * as currentStatus from '../db/repos/current-status.js';
import * as approvals from '../db/repos/approvals.js';
import { setProfileStatus, clearProfileStatus, postMessage, openIm, getProfileStatus } from '../slack/client.js';
import { approvalBlocks, type ApprovalSuggestion } from '../slack/blocks.js';
import type { ScheduledJob } from '../db/repos/scheduled-jobs.js';

interface SetPayload {
  status_text: string;
  emoji: string;
  end?: string; // ISO; used for status_expiration
}

interface AskPayload {
  event_title: string;
  suggestions: ApprovalSuggestion[];
}

interface ClearPayload {
  event_id: string;
}

export async function runJob(job: ScheduledJob): Promise<void> {
  switch (job.job_type) {
    case 'set':
      return runSet(job.event_id, job.payload as unknown as SetPayload);
    case 'ask':
      return runAsk(job.event_id, job.payload as unknown as AskPayload);
    case 'clear':
      return runClear(job.payload as unknown as ClearPayload);
  }
}

async function runSet(eventId: string, payload: SetPayload): Promise<void> {
  const expirationUnix = payload.end ? Math.floor(new Date(payload.end).getTime() / 1000) : 0;
  await setProfileStatus(payload.status_text, payload.emoji, expirationUnix);
  await currentStatus.setCurrent(
    eventId,
    payload.status_text,
    payload.emoji,
    payload.end ? new Date(payload.end) : null
  );
  logger.info({ eventId, statusText: payload.status_text }, 'set Slack status');
}

async function runAsk(eventId: string, payload: AskPayload): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const approval = await approvals.createApproval(eventId, expiresAt);
  const channelId = await openIm(config.SLACK_USER_ID);
  const blocks = approvalBlocks({
    approvalId: approval.id,
    eventTitle: payload.event_title,
    suggestions: payload.suggestions ?? [],
  });
  const { ts } = await postMessage(
    channelId,
    `Personal event: ${payload.event_title}`,
    blocks
  );
  await approvals.attachSlackMessage(approval.id, channelId, ts);
  logger.info({ eventId, approvalId: approval.id }, 'sent approval DM');
}

async function runClear(payload: ClearPayload): Promise<void> {
  const current = await currentStatus.getCurrent();
  if (current.event_id !== payload.event_id) {
    logger.debug(
      { eventId: payload.event_id, currentEvent: current.event_id },
      'skip clear; status is from a different event'
    );
    return;
  }
  // Drift check: if Slack status differs from what we set, the user overrode it.
  const live = await getProfileStatus();
  if (live.status_text !== current.status_text) {
    logger.info({ eventId: payload.event_id }, 'detected manual override; not clearing');
    await currentStatus.clearCurrent();
    return;
  }
  await clearProfileStatus();
  await currentStatus.clearCurrent();
  logger.info({ eventId: payload.event_id }, 'cleared Slack status');
}
