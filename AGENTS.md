# AGENTS.md

Instructions for AI agents working in this repository. Humans: read README.md first.

## What this is

FeedbackLoop / asc-gh-feedback: App Store Connect TestFlight feedback → GitHub issues → optional Claude Code routine triage → optional destinations (Discord/Slack/webhook). Single-tenant open core plus a multi-tenant SaaS layer (setup wizard, GitHub OAuth dashboard, encrypted tenant store).

## Map

```
src/core/        runtime-agnostic pipeline — fetch + Web Crypto ONLY (runs on Workers/Vercel/Node)
  handler.js     webhook Request→Response; processEvent honors cfg.pipeline flags
  asc.js         ASC API (jose ES256 JWT); NOTE: include=build,tester (never app)
  github.js      screenshot commits + issue creation (idempotent via asc-feedback-id marker)
  routine.js     Claude routine fire (beta header experimental-cc-routine-2026-04-01)
  destinations.js Discord/Slack/generic webhook fan-out
src/saas/        multi-tenant layer
  store.js       AES-256-GCM tenant records in a private GitHub repo + owners/<login>.json index
  session.js     HMAC-signed cookie sessions (fl_sess)
  asc-admin.js   webhook create/ping/deliveries against ASC
api/             Vercel functions: webhook (single-tenant), tenant-webhook (/t/:id/webhook),
                 setup (validate/provision/status), auth (GitHub OAuth), tenants (dashboard CRUD)
public/          static site: index.html (landing), setup.html (wizard), dash.html (dashboard)
.claude/skills/deploy-asc-feedback/  self-deploy skill — follow it for new deployments
agents/collect-requirements.md       computer-use prompt for gathering credentials
docs/SAAS.md     multi-tenant architecture; docs/LOOPBACK.md  EAS full-circle design
```

## Hard-won facts (do not rediscover these)

- **`vercel deploy` CLI hangs on this machine** at the file-upload step. Deploy via the REST API instead: `node <scratchpad>/api-deploy.mjs` pattern — POST `/v13/deployments?teamId=…&forceNew=1` with files inlined base64 (bundle is ~350KB). Poll `readyState` until READY; production alias applies automatically.
- ASC feedback endpoints reject `include=app`; bundle id comes from `attributes.buildBundleId`.
- ASC webhook `eventTypes` need the `_CREATED` suffix; deliveries list requires `filter[createdDateGreaterThanOrEqualTo]`; `webhookPings` gives a real signed delivery test.
- Trigger `last_fired_at` does NOT update on API fires — verify routine runs via session URL or issue side-effects.
- Env vars live in Vercel production (`vercel env ls production`); never commit secrets. Local sidecar files: `.webhook-secret.local`, `.setup-code.local`, `.tenant-key.local` (all gitignored).
- The public mirror is https://github.com/Vinniai/asc-gh-feedback — sync by `git archive` into a fresh tree, run the identifying-info grep (josh|taskr|tocld|trig_01|key ids…), commit as `Vinniai <Vinniai@users.noreply.github.com>`, push via `gh auth switch -u Vinniai`, switch back. Never push private history.

## Conventions

- `src/core/` stays free of Node-only APIs (no Buffer/fs/node:crypto).
- No personal/org values in code or docs — everything configurable is env or tenant record.
- Web-standard function signatures in `api/` (`export async function POST(request)`).
- Match existing style: no comments unless a constraint is invisible from code, 2-space, single quotes, no semicolo­n-free mixing.
- After changing tenant-affecting code, run the E2E: validate → provision (or reuse a tenant) → `webhookPings` → simulate with a real submission id → confirm the labeled issue.

## Verification commands

```bash
for f in api/*.js src/**/*.js; do node --check "$f"; done
npm run simulate                       # against local: npm start (port 8484)
WEBHOOK_URL=https://<host>/t/<id>/webhook ASC_WEBHOOK_SECRET=<tenant secret> npm run simulate -- betaFeedbackCrashSubmissionCreated <real id>
```
