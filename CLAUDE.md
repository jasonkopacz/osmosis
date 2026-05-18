# Osmosis — Project Guide

## What this is

Chrome MV3 extension (Vite + CRXJS + TypeScript) + Cloudflare Workers backend (Hono + D1 + KV). Words on any webpage are silently replaced with translations; users hover to reveal originals and manage settings via popup.

## Quick commands

```bash
# Root
npm test                              # all workspace tests
npm run build                         # build extension

# Backend workspace
npm run test -w backend               # vitest (better-sqlite3 in-process D1 sim)
npm run typecheck -w backend          # tsc --noEmit
npm run dev -w backend                # wrangler dev (local)
npm run deploy -w backend             # wrangler deploy → Cloudflare

# Extension workspace
npm run test -w extension             # vitest + jsdom
npm run typecheck -w extension        # tsc --noEmit
npm run build -w extension            # Vite + CRXJS → dist/
npm run dev -w extension              # watch mode
npm run pack:store -w extension       # zip for Chrome Web Store
```

## Monorepo layout

```
extension/   Chrome MV3 (Vite + CRXJS, TypeScript)
backend/     Cloudflare Workers API (Hono, D1, KV)
```

## Backend architecture

```
backend/src/
├── index.ts          ← Hono app factory; mounts all routes
├── routes/           ← auth.ts, google.ts, translate.ts, srs.ts, user.ts, stripe.ts
├── services/         ← azure.ts (Cognitive Services), google.ts (OAuth), email*.ts
├── middleware/        ← requireAuth.ts, checkUsage.ts
├── db/               ← D1 helpers: translations.ts, srs.ts
├── utils/            ← passwords.ts, stripe.ts
├── data/             ← static lookup tables
└── types.ts          ← Env bindings + shared types
```

**Hard constraints:**
- Workers runtime only — no `fs`, `path`, `child_process`, or any Node.js built-ins
- `crypto.subtle` for crypto (not `node:crypto`)
- D1 = SQL (SQLite dialect) for persistent user/SRS/translation data
- KV = rate-limit counters and ephemeral session state
- All routes use `requireAuth` middleware except `/auth/*` and `/stripe/webhook`
- D1 queries must use parameterized statements — never string-interpolated SQL

## Extension architecture

```
extension/src/
├── popup/
│   ├── styles/        ← ALL CSS here, split by concern (tokens first)
│   │   ├── tokens.css       ← :root design tokens — load first
│   │   ├── base.css         ← html/body/reset
│   │   ├── chrome.css       ← header, footer, body shell
│   │   ├── components.css   ← toggle, slider, buttons, inputs, usageMeter
│   │   ├── login.css
│   │   ├── settings.css
│   │   ├── progress.css
│   │   └── quiz.css
│   ├── components/    ← reusable TS UI: toggle, slider, usageMeter, streakDisplay
│   ├── views/         ← full-screen renders: main, login, settings, progress, quiz, about
│   ├── index.html     ← structure + font links only; no <style> or inline style attrs
│   └── main.ts        ← boots popup; imports all CSS files in token-first order
├── content/
│   ├── styles/replacer.css  ← .osmosis-word states + #osmosis-tooltip-host
│   ├── replacer.ts          ← DOM walker, word replacement, tooltip injection
│   └── filter.ts            ← word frequency / probability filtering
├── background/        ← MV3 service worker (alarms, storage sync)
├── constants.ts       ← API base URL, limits, shared constants
└── types.ts           ← shared extension types
```

**Hard constraints:**
- MV3 service worker: no persistent background page, no `eval`, no remote scripts
- CSP allows `'self'` scripts only — no dynamic code evaluation
- Content script CSS: `import styles from './styles/replacer.css?raw'` → inject string
- Cross-context comms via `chrome.runtime.sendMessage` and `chrome.storage.sync`

## CSS / HTML / TS separation (enforced)

1. **CSS only in `.css` files.** No `<style>` blocks in HTML. No `element.style.cssText = '...'` in TS.
2. **`index.html` is structure only.** Semantic elements, `<link>` for fonts, one `<script type="module">`.
3. **TS uses class names for state.** `classList.toggle('--modifier', bool)` — not `element.style.*`.
4. **Inline style only for runtime-computed values** that cannot be static CSS — e.g. `fill.style.width = pct + '%'`.
5. **Content script CSS uses `?raw`.** `import styles from './styles/replacer.css?raw'` then `injectTooltipStyles(raw)`.

When adding a UI state: add a CSS modifier class to the relevant `.css` file, toggle it in TS. Never reach for `element.style`.

## Design system

Tokens: `extension/src/popup/styles/tokens.css` — single source of truth, imported first in `main.ts`.
Full spec: `osmosis_design_system.html` in the project root.

| Role | Variable | Hex |
|---|---|---|
| Primary blue | `--osmo` | #2aa4e0 |
| Links / focus / active | `--current` | #22d3ee |
| Billing CTAs / fresh words | `--ember` | #f59a2e |
| Success / known words | `--signal` | #4ade80 |
| Danger / limit reached | `--error` | #f87171 |

Primary gradient: `linear-gradient(180deg, var(--osmo-bright), var(--osmo), var(--osmo-deep))`
Ember gradient (billing only): `linear-gradient(180deg, #fbb461, var(--ember), #c97817)`

## Context loading guide

Read files in this order to minimize unnecessary context:

| Task area | Read first | Then read |
|---|---|---|
| Any backend route | `backend/src/index.ts` | the relevant `routes/*.ts` file |
| Auth / JWT | `backend/src/routes/auth.ts` | `middleware/requireAuth.ts`, `utils/passwords.ts` |
| Translations | `backend/src/routes/translate.ts` | `services/azure.ts`, `db/translations.ts` |
| SRS / spaced repetition | `backend/src/routes/srs.ts` | `backend/src/db/srs.ts` |
| Stripe / billing | `backend/src/routes/stripe.ts` | `backend/src/utils/stripe.ts` |
| Popup UI | `extension/src/popup/main.ts` | relevant `views/*.ts` + its matching `styles/*.css` |
| Word replacement | `extension/src/content/replacer.ts` | `filter.ts`, `styles/replacer.css` |
| Background / alarms | `extension/src/background/` | `constants.ts` |

**Skip always:** `node_modules/`, `dist/`, `*.sql` seed files, `client_secret_*.json`, `package-lock.json`.

## Adding new things

### New backend route
1. Create `backend/src/routes/myroute.ts` — export a Hono app instance.
2. Mount in `backend/src/index.ts`: `app.route('/myroute', myRoute)`.
3. Wrap with `requireAuth` unless intentionally public.
4. Write tests in `backend/test/routes/myroute.test.ts` first.

### New popup view
1. Create `extension/src/popup/views/myview.ts` — `render()` returns `HTMLElement`.
2. Create `extension/src/popup/styles/myview.css` — view-specific classes only.
3. Import CSS in `extension/src/popup/main.ts` (after tokens.css).
4. Wire navigation in `main.ts`.

### New reusable component
1. Create `extension/src/popup/components/mycomponent.ts`.
2. Add its classes to `extension/src/popup/styles/components.css`.
3. Do not create a separate CSS file unless the component is large.

## Auth flow

Backend issues JWTs. `requireAuth` validates the `Authorization: Bearer <token>` header and sets `c.set('userId', id)`. Password hashing is in `utils/passwords.ts`. Google OAuth is in `routes/google.ts` + `services/google.ts`.

## SRS system

SRS state lives in D1 (`srs_cards` table). All D1 ops in `backend/src/db/srs.ts`. The quiz view (`popup/views/quiz.ts`) fetches due cards, renders them, and POSTs results back. Streak display is `popup/components/streakDisplay.ts`.

## What NOT to do

- `element.style.*` for non-runtime-computed values → use CSS classes
- `<style>` blocks in `index.html` → use `.css` files
- Node.js built-ins in backend → Workers runtime equivalents only
- `eval` / `new Function` / remote scripts in extension → violates MV3 CSP
- String-interpolated SQL → parameterized D1 statements only
- Hardcoded secrets in source → Cloudflare Worker environment bindings
- `console.log` in production paths → remove before commit

## Tests

- Backend: `backend/test/` — vitest, `better-sqlite3` simulates D1 in-process
- Extension: `extension/test/` — vitest + jsdom
- Coverage target: 80%+ on any new code
- TDD: write the test first, run it red, then implement

## Key files reference

| File | Purpose |
|---|---|
| `extension/src/popup/styles/tokens.css` | Single source of truth for all design tokens |
| `extension/src/popup/main.ts` | Popup entry; imports all CSS; boots navigation |
| `extension/src/content/replacer.ts` | Word replacement + tooltip injection |
| `extension/src/constants.ts` | API URL, frequency limits, shared constants |
| `backend/src/index.ts` | Hono router entry; all routes mounted here |
| `backend/src/routes/translate.ts` | Translation endpoint |
| `backend/src/types.ts` | Cloudflare Worker `Env` binding types |
