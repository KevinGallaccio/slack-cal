# slack-cal

Auto-update your Slack status from Google Calendar events, classified by Claude Haiku 4.5.

- **Work calendar** → status is set automatically with a contextual label (1:1s, conferences, focus time, etc.).
- **Personal calendar** → discreet by default. The service DMs you ~1 minute before the event with options to confirm what to post, or to post nothing.

Built as a small, opinionated, single-tenant service. Deploys to [Railway](https://railway.app).

## How it works

1. Google Calendar sends a webhook on every event change.
2. We do an incremental sync (via `syncToken`) and ask Claude Haiku 4.5 to classify each upcoming event.
3. Per-event timers are scheduled in-process (and persisted to Postgres for crash recovery).
4. At the event's start time, we set the Slack status — or DM the user for personal events.

This is **event-driven**, not cron. The only periodic job is a 6-day Google Calendar watch-channel renewal.

See [`specs.md`](./specs.md) for the full design.

## Stack

- **Runtime:** Node.js 20+, TypeScript
- **Web:** Fastify
- **DB:** Postgres
- **LLM:** Claude Haiku 4.5 via the Anthropic SDK (with prompt caching)
- **Hosting:** Railway

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# fill in ANTHROPIC_API_KEY, Google OAuth creds, Slack tokens, DATABASE_URL

# 3. Run migrations
npm run migrate

# 4. One-time Google OAuth flow (opens a browser)
npm run auth

# 5. Discover calendars and create watch channels
npm run bootstrap

# 6. Run the server
npm run dev
```

The webhook URLs (`/webhooks/google`, `/webhooks/slack/interactive`) need to be reachable on the public internet. For local development, use a tunnel like [ngrok](https://ngrok.com/) or [cloudflared](https://github.com/cloudflare/cloudflared) and set `PUBLIC_URL` and `GOOGLE_REDIRECT_URI` accordingly.

## Deploy to Railway

```bash
railway up
```

The repo includes a `railway.toml`. Make sure to set every variable from `.env.example` in the Railway service. The Postgres add-on injects `DATABASE_URL` automatically.

## Project layout

```
src/
  index.ts              # Fastify app + startup
  config.ts             # zod-validated env vars
  db/                   # Postgres client + schema + repos
  google/               # OAuth, watch channels, incremental sync
  slack/                # client, interactive, Block Kit
  classifier/           # Anthropic Haiku prompt + classify
  scheduler/            # in-process timer registry
  webhooks/             # /webhooks/google and /webhooks/slack/interactive
  scripts/              # one-off: auth, bootstrap, migrate
tests/                  # vitest
```

## Status

Single-tenant, personal tool. `v1` covers the spec end to end. Multi-user, web UI, and Outlook are explicitly out of scope.

## Contributing

PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports and feature ideas via GitHub Issues.

## License

[MIT](./LICENSE)
