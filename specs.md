# Slack Status Auto-Sync — Technical Specification

## Goal

Build a Railway-deployed service that automatically updates my Slack status based on two Google Calendars (work + personal), using Claude Haiku 4.5 to classify events and decide what to post.

- **Work calendar:** verbose, contextual status updates (Donut, conferences, meetings, etc.) — set automatically.
- **Personal calendar:** discreet by default — sends me a Slack DM ~1 minute before the event with options to confirm what to post (or post nothing).

## Architecture

### Stack
- **Runtime:** Node.js 20+ (TypeScript preferred)
- **Framework:** Fastify or Express (Fastify recommended for speed/types)
- **Hosting:** Railway (single service, public HTTPS endpoint)
- **Storage:** Postgres (Railway-provisioned add-on) — needed for:
  - OAuth tokens (Google refresh token)
  - Active Google Calendar watch channels (id, expiration, calendar)
  - Sync tokens per calendar (for incremental sync)
  - Scheduled jobs (event start triggers)
  - Pending approvals (for personal calendar DM flow)
  - Currently-set Slack status (so we know when to clear it)

### Why this is event-driven, not cron

I don't want polling. Updates should be near-real-time. The architecture:

1. **Google Calendar push notifications (webhooks)** notify us when an event is *created/updated/deleted*. We don't get notified at event *start* — Google's webhooks are change-based, not time-based.
2. So the flow is: webhook arrives → fetch changes → for each upcoming event, **schedule an in-process job** at its start time (or 1 minute before, for personal) → at trigger time, decide what to do with Slack.
3. A lightweight in-process scheduler (`node-schedule` or a simple `setTimeout` map persisted to Postgres for crash recovery) handles the timing. This is not a cron — it's a precise, per-event timer.

This gives us real-time reactivity *and* exact-timed status changes, with the only "scheduled" piece being the **watch channel renewal job** (channels expire after max 7 days; we renew every ~6 days). That's unavoidable — Google doesn't auto-renew.

### High-level flow

```
                                       ┌─────────────────────┐
                                       │  Google Calendar    │
                                       │  (work + personal)  │
                                       └──────────┬──────────┘
                                                  │ push notification
                                                  ▼
┌────────────────────┐    ┌────────────────────────────────┐
│  Slack             │◀───│  Railway service               │
│  - status set      │    │  - /webhooks/google            │
│  - DM with buttons │───▶│  - /webhooks/slack/interactive │
└────────────────────┘    │  - in-process scheduler        │
                          │  - Postgres                    │
                          │  - Anthropic Haiku 4.5 client  │
                          └────────────────────────────────┘
```

---

## Detailed components

### 1. Google Calendar integration

**OAuth setup (one-time, manual):**
- Create a Google Cloud project, enable Calendar API.
- Create OAuth 2.0 credentials (Web app type).
- Scopes: `https://www.googleapis.com/auth/calendar.readonly`.
- Redirect URI: `https://<your-railway-domain>/auth/google/callback`.
- Run a one-time `npm run auth` script that opens a browser, lets me sign in to **both** Google accounts (or a single account with both calendars if they're on the same account), and stores refresh tokens in Postgres.

**Watch channels:**
- After auth, call `events.watch` for each calendar:
  ```
  POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/watch
  ```
  Body:
  ```json
  {
    "id": "<uuid>",
    "type": "web_hook",
    "address": "https://<railway-domain>/webhooks/google",
    "token": "<random-secret-for-validation>",
    "expiration": <unix-ms-7-days-from-now>
  }
  ```
- Store the returned `resourceId`, `id`, `expiration`, and our `token` in the `watch_channels` table.
- A startup job + a daily check **renews any channel expiring within 24 hours** by calling `watch` again with a new `id`, then deleting the old one via `channels.stop`.

**Webhook receiver (`POST /webhooks/google`):**
- Validate the `X-Goog-Channel-Token` header against the stored token (auth).
- Read `X-Goog-Channel-ID` to identify which calendar fired.
- Ignore `X-Goog-Resource-State: sync` (initial handshake).
- For `exists`: fetch incremental changes using the stored sync token:
  ```
  GET /calendars/{id}/events?syncToken=<stored>&singleEvents=true
  ```
  - On first call, omit `syncToken` and use `timeMin = now`, `timeMax = now + 7 days` to get a baseline; save the `nextSyncToken` from the response.
  - On 410 Gone, drop the sync token and re-baseline.
- For each changed event, call the **scheduling logic** (see §3).

### 2. Event classification with Haiku 4.5

For each upcoming event, before scheduling, call Claude Haiku 4.5 to decide what to do.

**Model:** `claude-haiku-4-5`
**Pricing context:** $1 / MTok input, $5 / MTok output. With ~30 events/week and ~500 input + 100 output tokens per call, this is well under $0.50/month.

**Use prompt caching** — the system prompt is large and identical across calls. Mark it with `cache_control: { type: "ephemeral" }` to drop input cost by 90% on cache hits.

**Prompt (single shared system prompt, cached):**

```
You are a Slack status assistant. For each calendar event, you decide what
Slack status to post (or whether to ask the user first).

You will be given:
- calendar_source: "work" or "personal"
- event_title, event_description, event_location, attendees (count + names if any), start, end

Output JSON only, matching this schema:
{
  "action": "set" | "ask" | "skip",
  "status_text": string,        // <= 100 chars, what appears in Slack
  "emoji": string,              // a single Slack emoji code, e.g. ":calendar:"
  "reason": string              // short human-readable explanation, for logging
}

Rules:

WORK CALENDAR:
- Default: action = "set", with verbose, contextual status.
- Donut/coffee chats with named people → ":coffee: Donut with <name>"
- 1:1 meetings → ":speech_balloon: 1:1 with <name>"
- Conferences/external events → ":mega: At <conference name>"
- Internal team meetings → ":busts_in_silhouette: <meeting topic>"
- Focus blocks / DNDs → ":headphones: Focus time"
- Travel (flights, trains) → ":airplane: Traveling"
- If title is vague ("Meeting", "Sync") and description has detail, use the description.

PERSONAL CALENDAR:
- Default: action = "ask" — never auto-post personal events.
- EXCEPTION: clearly medical/sensitive (titles like "psy", "psychologue",
  "médecin", "doctor", "dentist", "thérapie", "RDV méd*", etc.) →
  action = "set", status = ":palm_tree: Out of office", emoji = ":palm_tree:"
  (don't reveal the nature of the appointment)
- For ambiguous events ("chez maman", "vacances", "weekend Berlin"), use
  action = "ask" so the user picks.
- For obvious noise (personal reminders, birthdays without a time block,
  all-day informational events) → action = "skip".

GENERAL:
- Keep status_text concise and human. No corporate-speak.
- Never include sensitive medical/personal details in the status.
- Pick one emoji from Slack's standard set.
```

**Per-event user message:**
```json
{
  "calendar_source": "work",
  "event_title": "Donut ☕ with Sarah",
  "event_description": "Random pairing this week — Sarah is in Berlin",
  "event_location": "",
  "attendees": ["sarah@company.com"],
  "start": "2026-04-28T14:00:00+02:00",
  "end": "2026-04-28T14:30:00+02:00"
}
```

Force JSON output with `response_format`-style prompting (Anthropic doesn't have strict JSON mode, so add "Output valid JSON only, no prose" at the end of the user message and parse with a fallback that strips ```json fences).

### 3. Scheduling logic

When an event change arrives:

1. Look up its current scheduled job (if any) by `event_id` in the `scheduled_jobs` table.
2. If event was deleted → cancel the job, and if the event was *currently active* (we'd set a status for it), clear Slack status now.
3. If event was created/updated:
   - Call Haiku to classify (cache the result by `event_id` + `event_updated_at` to avoid reclassifying unchanged events).
   - Compute `trigger_at`:
     - Work calendar, `action: set`: `trigger_at = event.start`
     - Personal calendar, `action: set` (medical exception): `trigger_at = event.start`
     - Personal calendar, `action: ask`: `trigger_at = event.start - 60 seconds`
     - `action: skip`: don't schedule.
   - Also schedule a `clear_at = event.end` job to clear/restore status.
   - Persist both jobs in Postgres and register them with the in-process scheduler.

**In-process scheduler:**
- On startup, load all future `scheduled_jobs` from Postgres and register them.
- Use `setTimeout` for jobs <24h away; use a periodic sweep (every 5 min) to register jobs that come into the 24h window.
- On job fire:
  - `set` → call Slack `users.profile.set` with the classification result. Record in `current_status` table.
  - `ask` → send Slack DM via `chat.postMessage` with Block Kit buttons (see §4).
  - `clear` → only clear if the currently-set status was set by *us* for this event (compare `current_status.event_id`). Otherwise leave it (user manually overrode).

### 4. Slack interactive flow (personal calendar approval)

When a personal `ask` job fires, post a DM to myself:

```json
{
  "channel": "<my-user-id>",
  "text": "Personal event starting in 1 minute: chez maman (Tue–Fri)",
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*chez maman* starts in ~1 minute.\nWhat should I show on Slack?" }
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "🌴 Out of office" }, "value": "ooo|<approval_id>", "action_id": "status_choice" },
        { "type": "button", "text": { "type": "plain_text", "text": "🏠 Working remotely from family" }, "value": "remote_family|<approval_id>", "action_id": "status_choice" },
        { "type": "button", "text": { "type": "plain_text", "text": "🤐 Don't post anything" }, "value": "skip|<approval_id>", "action_id": "status_choice" },
        { "type": "button", "text": { "type": "plain_text", "text": "✏️ Custom..." }, "value": "custom|<approval_id>", "action_id": "status_choice" }
      ]
    }
  ]
}
```

**Slack interactivity endpoint (`POST /webhooks/slack/interactive`):**
- Verify Slack signature using `X-Slack-Signature` and `X-Slack-Request-Timestamp` (HMAC SHA256 with signing secret).
- Parse the payload, look up `approval_id` in `pending_approvals` table.
- If `custom` → respond with a Slack modal (`views.open`) containing a text input.
- Otherwise → set the Slack status accordingly, respond with a `chat.update` to replace the buttons with a "✅ Set status to X" confirmation.
- Schedule the `clear_at` job (originally we only schedule it after confirmation, since for `ask` events we don't pre-schedule clearing).

**Pre-generating button options:** when Haiku classifies a personal event with `ask`, also have it suggest 2-3 sensible options for the buttons. Update the prompt to optionally include a `suggestions` array when `action: ask`. Falls back to defaults (OOO / Skip / Custom) if missing.

### 5. Slack integration setup

Create a Slack app at api.slack.com/apps with:
- **Bot Token Scopes:** `chat:write`, `users.profile:write`, `users:read`, `im:write`
- **User Token Scopes:** `users.profile:write` (status setting requires user token, not bot token)
- **Interactivity:** enabled, request URL = `https://<railway-domain>/webhooks/slack/interactive`
- Install to workspace, capture both bot token (`xoxb-...`) and user token (`xoxp-...`).

Note: `users.profile.set` for setting *your own* status needs a user token. The bot token is only for posting the DM to yourself.

---

## Database schema

```sql
CREATE TABLE google_accounts (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ
);

CREATE TABLE calendars (
  id SERIAL PRIMARY KEY,
  google_account_id INT REFERENCES google_accounts(id),
  calendar_id TEXT NOT NULL,           -- the Google calendar ID
  source TEXT NOT NULL,                -- 'work' | 'personal'
  sync_token TEXT,
  UNIQUE (google_account_id, calendar_id)
);

CREATE TABLE watch_channels (
  id SERIAL PRIMARY KEY,
  calendar_id INT REFERENCES calendars(id) ON DELETE CASCADE,
  channel_id TEXT UNIQUE NOT NULL,     -- our UUID
  resource_id TEXT NOT NULL,           -- Google's resource ID
  token TEXT NOT NULL,                 -- secret for validation
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE event_classifications (
  event_id TEXT PRIMARY KEY,           -- Google event ID
  calendar_id INT REFERENCES calendars(id) ON DELETE CASCADE,
  event_updated_at TIMESTAMPTZ NOT NULL, -- to detect changes
  action TEXT NOT NULL,                -- 'set' | 'ask' | 'skip'
  status_text TEXT,
  emoji TEXT,
  suggestions JSONB,                   -- for 'ask' actions
  reason TEXT,
  classified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scheduled_jobs (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  job_type TEXT NOT NULL,              -- 'set' | 'ask' | 'clear'
  trigger_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  fired BOOLEAN DEFAULT FALSE,
  UNIQUE (event_id, job_type)
);
CREATE INDEX scheduled_jobs_pending ON scheduled_jobs (trigger_at) WHERE fired = FALSE;

CREATE TABLE pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  slack_message_ts TEXT,               -- for chat.update later
  slack_channel_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE current_status (
  id INT PRIMARY KEY DEFAULT 1,        -- single row
  event_id TEXT,
  status_text TEXT,
  emoji TEXT,
  set_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
```

---

## Project structure

```
src/
  index.ts                  // fastify app, routes, startup
  config.ts                 // env vars, validation with zod
  db/
    client.ts
    schema.sql
    repos/                  // typed query helpers per table
  google/
    auth.ts                 // OAuth refresh, access token caching
    watch.ts                // create/renew/stop channels
    sync.ts                 // incremental sync via syncToken
    types.ts
  slack/
    client.ts               // chat.postMessage, users.profile.set
    interactive.ts          // signature verify, payload routing
    blocks.ts               // Block Kit builders
  classifier/
    haiku.ts                // Anthropic SDK call, prompt, parsing
    prompt.ts               // the cached system prompt
  scheduler/
    index.ts                // in-process timer registry
    handlers.ts             // set / ask / clear job handlers
  webhooks/
    google.ts               // POST /webhooks/google
    slack.ts                // POST /webhooks/slack/interactive
  scripts/
    auth.ts                 // one-time OAuth dance
    bootstrap.ts            // initial calendar discovery + watch creation
tests/
  classifier.test.ts        // golden test cases for the Haiku prompt
  scheduler.test.ts
package.json
tsconfig.json
.env.example
railway.toml
```

---

## Environment variables

```
# Anthropic
ANTHROPIC_API_KEY=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://<railway-domain>/auth/google/callback

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_USER_TOKEN=xoxp-...
SLACK_SIGNING_SECRET=
SLACK_USER_ID=U0123ABC          # my own user ID for DMs

# App
PUBLIC_URL=https://<railway-domain>
DATABASE_URL=postgres://...     # Railway provides this
WATCH_TOKEN_SECRET=<random>     # used as the token for Google watch channels

# Calendar mapping (set after auth)
WORK_CALENDAR_ID=primary
PERSONAL_CALENDAR_ID=your-personal-email@gmail.com
```

---

## Implementation order (suggested for Claude Code)

1. **Project skeleton:** TypeScript, Fastify, Postgres connection, env validation with zod.
2. **DB schema + migrations.**
3. **Google OAuth flow** (`src/scripts/auth.ts`) — runs locally once, stores refresh token. This is the gnarliest part; do it first while tokens are fresh.
4. **Google sync module** — initial baseline sync + incremental sync using sync tokens.
5. **Webhook endpoint for Google** — receive, validate, fan out to sync.
6. **Watch channel manager** — create on bootstrap, renew on a daily timer.
7. **Anthropic classifier** — prompt + caching + JSON parsing + golden tests with realistic events.
8. **Scheduler** — in-process timer registry with Postgres persistence and recovery on restart.
9. **Slack client** — `users.profile.set`, `chat.postMessage`, `chat.update`.
10. **Slack interactive endpoint** — signature verify, button → status set.
11. **End-to-end test** with a fake calendar event added to my actual work calendar.
12. **Railway deploy:** `railway.toml`, public domain, Postgres add-on, env vars set.

---

## Edge cases and gotchas

- **Overlapping events:** if event A is active and event B starts, replace status. On B's end, only restore A's status if A is still active.
- **All-day events:** by default ignore on the work calendar (status = "OOO" only if it's the *only* event of the day, or if title implies it). The classifier can decide.
- **Manual override:** if I manually set a Slack status, don't overwrite it. Detect this by reading the current status before each `set`/`clear` and comparing against `current_status.status_text` — if it's drifted, treat as overridden and clear our `current_status` row.
- **Recurring events:** the Google Events API with `singleEvents=true` expands them into individual instances. Each gets its own event ID, so the scheduler treats them as independent. Good.
- **Webhook flakiness:** Google sometimes drops notifications. Run a safety-net incremental sync every 15 minutes anyway (cheap — uses syncToken so the response is empty if nothing changed).
- **Deduplication:** Google can deliver the same notification multiple times. Use `event_classifications.event_updated_at` as an idempotency key — skip reclassification if unchanged.
- **Token expiration:** Google access tokens last 1 hour; refresh proactively when <5 min remaining. Slack tokens don't expire (legacy app), but handle 401 by failing loudly.
- **Time zones:** store everything UTC in Postgres, render in `Europe/Paris` for the user.
- **DST:** `setTimeout` is wall-clock-aware on Node, but if a job's `trigger_at` is more than 24h out, recompute on the periodic sweep to be safe.
- **Cold start on Railway:** Railway's free tier sleeps containers. Use the Hobby plan ($5/mo) or set up an uptime ping. Sleeping = missed webhooks. Critical.
- **Crash recovery:** on startup, re-load all future `scheduled_jobs` and re-register with the in-process scheduler. Run an immediate incremental sync to catch anything missed during downtime.

---

## Cost estimate (monthly)

- **Railway Hobby:** $5
- **Postgres add-on:** included in Hobby allowance
- **Anthropic Haiku 4.5:** ~30 events/week × 4 = 120 classifications. With caching (~90% off cached input), input ≈ $0.05, output ≈ $0.10. **Under $0.20/mo.**
- **Google Calendar API:** free under quota.
- **Slack API:** free.

Total: **~$5–6/month.**

---

## Out of scope (for v1)

- Multi-user support (this is a personal tool for me)
- Web UI for configuring rules (the prompt is the config)
- Rich analytics or status history beyond what's in `current_status`
- Mobile app
- Outlook calendar (can add later — same architecture, different webhook format)