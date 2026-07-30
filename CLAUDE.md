# asc-gh-feedback

Webhook bridge: App Store Connect TestFlight feedback → GitHub issues → Claude routine triage. Generic — works for any app/repo; all targets come from env vars.

## What it does

1. App Store Connect POSTs signed webhook events (`betaFeedbackScreenshotSubmissionCreated`, `betaFeedbackCrashSubmissionCreated`) to `/webhook`.
2. The service verifies the HMAC-SHA256 `X-Apple-Signature` against `ASC_WEBHOOK_SECRET`, then fetches the full submission from the ASC API (ES256 JWT auth): tester comment, device/OS/build metadata, screenshots, crash log.
3. Screenshots are committed to `GITHUB_REPO` under `GITHUB_ASSET_DIR`; a GitHub issue is opened with everything embedded, labeled per `GITHUB_LABELS` (+ `crash`). Idempotent per submission via an `asc-feedback-id` marker in the issue body.
4. If `CLAUDE_ROUTINE_ID`/`CLAUDE_ROUTINE_TOKEN` are set, a Claude Code routine is fired via `POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire` with the issue URL as context, so it can analyze the feedback against the codebase, comment root-cause analysis, apply type/priority labels, hand off to agents, and open PRs for small confident fixes. Without them the service still files triage-ready issues.

## Required inputs (no defaults — ask the operator)

| Input | Where it lives |
| --- | --- |
| Target GitHub repo (`owner/repo`) | `GITHUB_REPO` env |
| GitHub PAT (Issues:write, Contents:write on that repo) | `GITHUB_TOKEN` |
| ASC API key: Key ID, Issuer ID, .p8 | `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_B64` |
| Webhook signing secret (operator-chosen random) | `ASC_WEBHOOK_SECRET` + the ASC webhook config |
| Which App Store Connect app to watch | the webhook created in ASC |
| Claude routine id + API token (optional) | `CLAUDE_ROUTINE_ID`, `CLAUDE_ROUTINE_TOKEN` |
| Where the routine should focus (app path in a monorepo, labels) | the routine's saved prompt |

`agents/collect-requirements.md` is a ready-made agent prompt that gathers all of these interactively (browser/computer use with the operator present) and configures a deployment.

## Architecture

```
src/core/       runtime-agnostic logic — fetch + Web Crypto only, no Node APIs
  handler.js    Request → Response entry; async processing via ctx.waitUntil when available
  verify.js     HMAC signature check (constant-time)
  asc.js        ASC API client (jose ES256 JWT)
  github.js     screenshot commits + issue creation
  routine.js    Claude routine fire (no-op if unset)
src/worker.js   Cloudflare Workers adapter (wrangler.toml)
api/webhook.js  Vercel Function adapter (vercel.json rewrites /webhook → /api/webhook)
src/server.js   plain Node adapter (npm start, port 8484)
scripts/send-test-event.js  signed fake webhook for testing (npm run simulate)
```

## Commands

```bash
npm start            # local server :8484
npm run simulate     # send signed fake event (WEBHOOK_URL / ASC_WEBHOOK_SECRET env)
vercel deploy --prod --yes
npx wrangler deploy  # Cloudflare alternative
```

## Conventions

- Keep `src/core/` free of Node-only APIs (no Buffer, node:crypto, fs) — it must run on Workers.
- New event types: add to `EVENT_HANDLERS` in `src/core/handler.js` with a fetcher in `asc.js`.
- No personal/org-specific values in code or docs — everything configurable is an env var, and agents must ask for or verify targets before acting.
- Secrets never in code or wrangler.toml `[vars]`; use `vercel env add` / `wrangler secret put`.
