import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { logger } from './logger.js';
import { query } from './db/client.js';
import * as accountsRepo from './db/repos/google-accounts.js';
import * as calendarsRepo from './db/repos/calendars.js';
import * as channelsRepo from './db/repos/watch-channels.js';
import * as jobsRepo from './db/repos/scheduled-jobs.js';
import * as classRepo from './db/repos/classifications.js';
import * as approvalsRepo from './db/repos/approvals.js';
import * as currentStatus from './db/repos/current-status.js';
import { ensureCalendarsAndWatchesBestEffort } from './google/setup.js';

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/admin', async (req, reply) => {
    if (!authorized(req, reply)) return;
    const { reset } = req.query as { reset?: string };
    const html = await renderAdminPage({ resetBanner: reset === '1' });
    reply.type('text/html; charset=utf-8');
    return html;
  });

  app.post('/admin/reset', async (req, reply) => {
    if (!authorized(req, reply)) return;
    // Wipe classifications + sync tokens so the next sync re-baselines and
    // re-classifies every event with the current prompt. Also wipe pending
    // future jobs so they get re-issued with new payloads.
    await query(`DELETE FROM event_classifications`);
    await query(`DELETE FROM scheduled_jobs WHERE fired = FALSE`);
    await query(`UPDATE calendars SET sync_token = NULL`);
    logger.info('admin reset: classifications + sync tokens cleared');
    // Kick off resync async so the redirect returns immediately.
    setImmediate(() => {
      ensureCalendarsAndWatchesBestEffort().catch((err) =>
        logger.error({ err }, 'admin reset resync failed')
      );
    });
    reply.redirect('/admin?reset=1');
  });
}

function authorized(req: FastifyRequest, reply: FastifyReply): boolean {
  const header = req.headers.authorization;
  if (header && header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon !== -1) {
      const user = decoded.slice(0, colon);
      const pass = decoded.slice(colon + 1);
      if (user === 'admin' && safeEqual(pass, config.ADMIN_PASSWORD)) return true;
    }
  }
  reply
    .code(401)
    .header('WWW-Authenticate', 'Basic realm="slack-cal"')
    .type('text/plain')
    .send('Authentication required');
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function renderAdminPage(opts: { resetBanner: boolean }): Promise<string> {
  const [accounts, calendars, channels, current, pending, recent, approvals] =
    await Promise.all([
      accountsRepo.listAccounts(),
      calendarsRepo.listCalendars(),
      channelsRepo.listAll(),
      currentStatus.getCurrent(),
      jobsRepo.listAllPending(),
      classRepo.listRecent(10),
      approvalsRepo.listAll(),
    ]);

  const accountsHtml = accounts.length
    ? table(
        ['Email', 'Has refresh token', 'Access token expires'],
        accounts.map((a) => [
          esc(a.email),
          a.refresh_token ? 'yes' : 'NO',
          a.access_token_expires_at ? relative(a.access_token_expires_at) : '—',
        ])
      )
    : empty('No Google accounts authenticated. Visit /auth/google to connect one.');

  const calendarsHtml = calendars.length
    ? table(
        ['Calendar ID', 'Source', 'Account', 'Sync token'],
        calendars.map((c) => {
          const account = accounts.find((a) => a.id === c.google_account_id);
          return [
            esc(c.calendar_id),
            esc(c.source),
            esc(account?.email ?? `#${c.google_account_id}`),
            c.sync_token ? 'yes' : 'no',
          ];
        })
      )
    : empty('No calendars registered yet.');

  const channelsHtml = channels.length
    ? table(
        ['Calendar ID', 'Channel ID', 'Expires'],
        channels.map((ch) => {
          const cal = calendars.find((c) => c.id === ch.calendar_id);
          return [
            esc(cal?.calendar_id ?? `#${ch.calendar_id}`),
            esc(ch.channel_id.slice(0, 8) + '…'),
            relative(ch.expires_at),
          ];
        })
      )
    : empty('No watch channels.');

  const statusHtml = current.event_id
    ? `<div class="status">
        <div class="emoji">${esc(current.emoji ?? '')}</div>
        <div>
          <div class="status-text">${esc(current.status_text ?? '')}</div>
          <div class="muted">
            set ${current.set_at ? relative(current.set_at) : '—'}
            ${current.expires_at ? `· clears ${relative(current.expires_at)}` : ''}
            · event <code>${esc(current.event_id.slice(0, 12))}</code>
          </div>
        </div>
      </div>`
    : empty('No status currently set by slack-cal.');

  const pendingHtml = pending.length
    ? table(
        ['Trigger', 'Type', 'Event ID'],
        pending
          .slice(0, 10)
          .map((j) => [relative(j.trigger_at), esc(j.job_type), esc(j.event_id.slice(0, 16))])
      )
    : empty('No pending jobs.');

  const recentHtml = recent.length
    ? table(
        ['When', 'Action', 'Status', 'Event ID', 'Reason'],
        recent.map((r) => [
          relative(r.classified_at),
          esc(r.action),
          r.status_text ? `${esc(r.emoji ?? '')} ${esc(r.status_text)}` : '—',
          esc(r.event_id.slice(0, 16)),
          esc((r.reason ?? '').slice(0, 80)),
        ])
      )
    : empty('No classifications yet.');

  const approvalsHtml = approvals.length
    ? table(
        ['Event ID', 'DM sent', 'Channel', 'Expires'],
        approvals.map((a) => [
          esc(a.event_id.slice(0, 16)),
          a.slack_message_ts ? 'yes' : 'NO',
          esc(a.slack_channel_id ?? '—'),
          relative(a.expires_at),
        ])
      )
    : empty('No personal-event approval DMs awaiting your response.');

  const summary = `
    <div class="summary">
      <span><strong>${accounts.length}</strong> account${accounts.length === 1 ? '' : 's'}</span>
      <span><strong>${calendars.length}</strong> calendar${calendars.length === 1 ? '' : 's'}</span>
      <span><strong>${channels.length}</strong> watch channel${channels.length === 1 ? '' : 's'}</span>
      <span><strong>${pending.length}</strong> pending job${pending.length === 1 ? '' : 's'}</span>
    </div>`;

  const connectedEmails = new Set(accounts.map((a) => a.email));
  const hintCandidates: { label: string; hint: string }[] = [];
  if (isEmail(config.WORK_CALENDAR_ID) && !connectedEmails.has(config.WORK_CALENDAR_ID)) {
    hintCandidates.push({ label: 'Connect work account', hint: config.WORK_CALENDAR_ID });
  }
  if (
    config.PERSONAL_CALENDAR_ID &&
    isEmail(config.PERSONAL_CALENDAR_ID) &&
    !connectedEmails.has(config.PERSONAL_CALENDAR_ID)
  ) {
    hintCandidates.push({
      label: 'Connect personal account',
      hint: config.PERSONAL_CALENDAR_ID,
    });
  }

  const connectHtml = `
    <div class="connect">
      ${hintCandidates
        .map(
          (b) =>
            `<a class="btn primary" href="/auth/google?hint=${encodeURIComponent(b.hint)}">${esc(b.label)} <span class="hint">${esc(b.hint)}</span></a>`
        )
        .join('')}
      <a class="btn" href="/auth/google">Connect a Google account</a>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>slack-cal admin</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    margin: 0; padding: 2rem 1.5rem 4rem; max-width: 880px; margin-inline: auto;
    line-height: 1.5; color: #1a1a1a; background: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; background: #0e0e0e; }
    a { color: #80b8ff; }
    table, th, td { border-color: #2a2a2a !important; }
    .muted { color: #888 !important; }
    .empty { background: #161616 !important; color: #999 !important; }
  }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 2rem 0 .5rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
  .muted { color: #666; font-size: .85rem; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .85em; }
  .summary { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 1rem 0 .5rem; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th, td { padding: .4rem .6rem; text-align: left; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { font-weight: 600; opacity: .7; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; }
  .empty { padding: .75rem 1rem; background: #f0f0f0; border-radius: 6px; color: #666; font-size: .9rem; }
  .status { display: flex; gap: 1rem; align-items: center; padding: 1rem; border: 1px solid #e0e0e0; border-radius: 8px; }
  .status .emoji { font-size: 1.5rem; }
  .status-text { font-weight: 600; }
  .connect { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
  .btn {
    display: inline-flex; align-items: center; gap: .5rem; padding: .5rem .9rem;
    border: 1px solid #d0d0d0; border-radius: 6px; text-decoration: none;
    color: inherit; font-size: .9rem; background: #fff;
  }
  .btn:hover { background: #f5f5f5; }
  .btn.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
  .btn.primary:hover { background: #1557b0; }
  .btn .hint { opacity: .7; font-size: .8rem; font-weight: normal; }
  button.btn { font: inherit; cursor: pointer; }
  .banner {
    margin: 1rem 0; padding: .75rem 1rem; border-radius: 6px;
    background: #e8f4fd; border: 1px solid #b8dcf6; color: #0c4a6e; font-size: .9rem;
  }
  @media (prefers-color-scheme: dark) {
    .btn { background: #181818; border-color: #2a2a2a; }
    .btn:hover { background: #222; }
    .banner { background: #0a2540; border-color: #1c3d63; color: #b8dcf6; }
  }
</style>
</head>
<body>
<h1>slack-cal admin</h1>
<div class="muted">${esc(config.PUBLIC_URL)} · auto-refresh every 30s</div>
${opts.resetBanner ? '<div class="banner">Reset triggered. Reclassification is running in the background — refresh in a minute to see results.</div>' : ''}
${summary}
${connectHtml}

<h2>Connected Google accounts</h2>
${accountsHtml}

<h2>Configured calendars</h2>
${calendarsHtml}

<h2>Watch channels</h2>
${channelsHtml}

<h2>Current Slack status</h2>
${statusHtml}

<h2>Upcoming jobs (next 10)</h2>
${pendingHtml}

<h2>Recent classifications (last 10)</h2>
${recentHtml}

<h2>Pending personal approvals</h2>
${approvalsHtml}

<h2>Maintenance</h2>
<form method="post" action="/admin/reset" onsubmit="return confirm('Re-classify ALL events under the current prompt? This wipes existing classifications + future jobs and runs Haiku on every event in the next 180 days. Costs ~$0.30 in API fees and takes a few minutes.')">
  <button type="submit" class="btn">Reset & re-classify all events</button>
</form>
</body>
</html>`;
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function relative(d: Date): string {
  const ms = d.getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (m < 1) return 'just now';
  if (m < 60) label = `${m}m`;
  else if (h < 24) label = `${h}h`;
  else label = `${days}d`;
  return past ? `${label} ago` : `in ${label}`;
}

function table(headers: string[], rows: string[][]): string {
  return `<table>
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table>`;
}

function empty(msg: string): string {
  return `<div class="empty">${esc(msg)}</div>`;
}

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}
