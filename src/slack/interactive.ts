import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const FIVE_MIN_SECONDS = 5 * 60;

/** Verifies a Slack request signature per https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlackSignature(
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > FIVE_MIN_SECONDS) return false;

  const baseString = `v0:${timestampHeader}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', config.SLACK_SIGNING_SECRET)
    .update(baseString)
    .digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
