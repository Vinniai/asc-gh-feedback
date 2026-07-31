# Identity architecture: Apple-first sign-in with the fewest moving parts

Goal: a first-time user registers and connects apps with Apple identity (OAuth or Keychain passkey), GitHub is linked only when needed, and we run the least infrastructure possible.

## Where we are

Hand-rolled: GitHub OAuth + WebAuthn passkeys + HMAC cookie sessions + an encrypted GitHub-repo store. Zero external services, but auth code is the fastest-growing surface and passkey-first *registration* has a real gap: a passkey alone carries no identity (no email, no name), so someone must anchor the account first — today that anchor is GitHub.

## The three options

### A. Keep hand-rolling (add Sign in with Apple ourselves)
SIWA is just OAuth with an annoying client secret (a JWT you sign with an Apple key). ~120 lines next to the GitHub flow. Requirements from the Apple Developer portal: an App ID + **Services ID** (the OAuth client), a **Sign in with Apple key** (.p8), domain association for `appshake.tocld.com`. Account model change: user records keyed by internal id with `identities: [{provider, sub, email}]` so Apple-first users exist before any GitHub link.

- Moving parts: zero new services. Most code owned by us.
- Cost: we maintain OAuth quirks, token rotation, account-linking edge cases forever.

### B. WorkOS AuthKit (recommended)
AuthKit is a hosted auth front door: **Sign in with Apple, GitHub OAuth, passkeys, email magic links** — all configured in a dashboard, delivered through one redirect + one `/callback` exchange. Free to 1M MAU.

- Replaces: our `api/auth.js`, `api/passkey.js`, session minting, challenge cookies — roughly 400 lines deleted, one SDK call added.
- Account linking (Apple first, GitHub later) is their problem, solved in their dashboard.
- GitHub repo access still needs our own GitHub OAuth app for the `repo` token (AuthKit authenticates identity; it doesn't farm API tokens) — kept as the existing one-click "connect GitHub" inside the dashboard.
- Moving parts added: exactly one (WorkOS). Everything else unchanged — Vercel functions + encrypted store stay.

### C. Convex as the backend
Full backend: real database (tenants, users, logs), functions, real-time dashboard subscriptions. Pairs with Convex Auth or WorkOS on top. The team already lives in Convex daily, so familiarity is maximal — but it replaces the storage layer *and* the function layer: the biggest migration, most moving parts, and webhook ingestion still wants an HTTP edge in front.

## Recommendation

**B now, C later if ever.** WorkOS AuthKit gives Apple OAuth + Apple-Keychain passkeys + GitHub sign-in as one integration and deletes our riskiest code. The encrypted-repo store is crude but has zero operational burden and is invisible to users; migrate storage to Convex only when the dashboard needs live queries (activity streaming, team seats) — and that migration is orthogonal to auth.

First-time flow after AuthKit:
1. Landing → "Continue with Apple" (Face ID via Keychain, or Apple OAuth) — account exists.
2. Wizard step 1: App Store Connect key (the only unavoidable manual step; Apple has no OAuth for ASC).
3. Wizard step 2: pick apps (multi-select) → live. GitHub connect is offered only when they choose GitHub as a destination; Discord/Slack destinations need no GitHub at all once issue-creation is optional per tenant.

## What's needed from the operator to start B

- WorkOS account → AuthKit enabled → add `https://appshake.tocld.com/api/auth/callback` as redirect URI → `WORKOS_API_KEY` + `WORKOS_CLIENT_ID` env vars.
- In WorkOS dashboard: enable Apple (they broker it — no Apple Developer setup needed for basic SIWA through their connection) and GitHub providers, enable Passkeys.
- ~1 hour of integration to swap `api/auth.js` to the AuthKit redirect and delete `api/passkey.js`.
