# Osmosis

Passively learn a language by replacing words on any webpage with their translations as you browse. No flashcards, no study sessions — just natural exposure while you read.

## How it works

Osmosis replaces a configurable percentage of words on every page you visit with their translations in your target language. Hovering over a replaced word shows the original. Over time, vocabulary builds up through repeated context-based exposure.

## Architecture

```
extension/          Chrome extension (MV3, TypeScript + Vite)
backend/            Cloudflare Workers API (Hono, TypeScript)
```

**Extension** — content script walks the DOM, samples eligible words, and sends them to the background service worker. The service worker translates via the backend API, caches results in memory, and applies replacements. A popup provides settings and account management.

**Backend** — Hono app deployed on Cloudflare Workers. Handles auth (email/password + Google OAuth), translation (Azure Cognitive Services), usage tracking (D1 SQLite), caching (KV), and Stripe billing.

```
User visits page
  → content script collects words
  → background service worker checks session cache
  → uncached words sent to POST /translate
  → backend checks KV cache, calls Azure Translator
  → translations returned and applied to DOM
```

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome MV3, TypeScript, Vite, @crxjs/vite-plugin |
| Backend | Cloudflare Workers, Hono |
| Database | Cloudflare D1 (SQLite) |
| Cache | Cloudflare KV |
| Translation | Azure Cognitive Services Translator |
| Auth | JWT, Google OAuth 2.0 |
| Payments | Stripe (subscriptions) |

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account with D1 and KV enabled
- An Azure Cognitive Services resource with the Translator API
- A Stripe account
- A Google Cloud project with OAuth 2.0 credentials

## Project Setup

### 1. Clone and install

```bash
git clone https://github.com/jasonkopacz/osmosis
cd osmosis
npm install           # root workspace deps
cd backend && npm install
cd ../extension && npm install
```

### 2. Configure the backend

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

Required values in `.env`:

```
JWT_SECRET=<random 64-char hex string>
AZURE_TRANSLATOR_KEY=<your Azure key>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_CLIENT_ID=<your Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
```

Deploy secrets to Cloudflare Workers (never stored in `wrangler.toml`):

```bash
cd backend
wrangler secret put JWT_SECRET
wrangler secret put AZURE_TRANSLATOR_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

Edit `backend/wrangler.toml` and set your Stripe price ID:

```toml
[vars]
STRIPE_PRO_PRICE_ID = "price_..."
```

### 3. Create Cloudflare resources

```bash
# Create D1 database
wrangler d1 create osmosis

# Create KV namespace
wrangler kv namespace create TRANSLATION_CACHE
```

Update the IDs returned by these commands in `backend/wrangler.toml`.

### 4. Run database migrations

```bash
cd backend
wrangler d1 execute osmosis --file=./migrations/001_init.sql
```

### 5. Build the extension

```bash
cd extension
npm run build
```

The built extension will be in `extension/dist/`.

### 6. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

Note the extension ID shown — you'll need it for Google OAuth setup.

### 7. Configure Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create an OAuth 2.0 Web client (or use an existing one)
2. Add `https://<YOUR_EXTENSION_ID>.chromiumapp.org/` to **Authorized redirect URIs**
3. The extension ID is shown on `chrome://extensions` after loading

## Development

### Backend (local)

```bash
cd backend
npm run dev        # starts wrangler dev server at http://localhost:8787
```

### Extension (watch mode)

```bash
cd extension
npm run dev        # rebuilds on file changes
```

After any rebuild, go to `chrome://extensions` and click the reload icon on the Osmosis card.

### Running tests

```bash
# Backend
cd backend && npm test

# Extension
cd extension && npm test
```

## API Reference

All authenticated endpoints require `Authorization: Bearer <jwt>`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/signup` | — | Create account (email + password) |
| `POST` | `/auth/login` | — | Sign in, returns JWT |
| `GET` | `/auth/google/url` | — | Get Google OAuth authorization URL |
| `POST` | `/auth/google/exchange` | — | Exchange OAuth code for JWT |
| `GET` | `/user/me` | ✓ | Get current user profile and usage |
| `POST` | `/user/checkout` | ✓ | Create Stripe checkout session |
| `POST` | `/user/portal` | ✓ | Open Stripe billing portal |
| `POST` | `/translate` | ✓ | Translate an array of words |
| `POST` | `/stripe/webhook` | — | Stripe webhook receiver |
| `GET` | `/health` | — | Health check |

### `POST /translate`

```json
{
  "words": ["hello", "world"],
  "targetLang": "de"
}
```

Response:
```json
{
  "translations": {
    "hello": "Hallo",
    "world": "Welt"
  }
}
```

Returns `402` with `{ "code": "LIMIT_REACHED" }` when a free-tier user exceeds their monthly character limit.

## Plans & Billing

| | Free | Pro |
|---|---|---|
| Monthly character limit | 50,000 | Unlimited |
| Price | Free | Stripe subscription |

Plan is stored in the `users` table and enforced server-side via the `checkUsage` middleware. Upgrades and downgrades are handled via Stripe webhooks (`checkout.session.completed` and `customer.subscription.deleted`).

To test billing without real charges, use Stripe's test card `4242 4242 4242 4242` with any future expiry and any CVC.

## Extension Settings

Accessible via the gear icon in the popup:

| Setting | Description |
|---|---|
| **Enable/Disable** | Toggle replacements on/off globally |
| **Target Language** | Language to translate words into (50+ supported) |
| **Replacement %** | Percentage of eligible words to replace (1–100%) |

Settings are synced across devices via `chrome.storage.sync`.

## Supported Languages

All languages supported by Azure Cognitive Services Translator, including German, Spanish, French, Japanese, Mandarin, Korean, Italian, Portuguese, Russian, Arabic, and more. See `extension/src/shared/languages.ts` for the full list.

## Environment Variables

### Backend (`wrangler.toml` vars — not secret)

| Variable | Description |
|---|---|
| `AZURE_TRANSLATOR_REGION` | Azure region (e.g. `eastus`) |
| `STRIPE_PRO_PRICE_ID` | Stripe Price ID for the Pro subscription |
| `FREE_TIER_CHAR_LIMIT` | Override free tier limit (default: 50,000) |

### Backend secrets (via `wrangler secret put`)

| Secret | Description |
|---|---|
| `JWT_SECRET` | Secret for signing JWTs |
| `AZURE_TRANSLATOR_KEY` | Azure Cognitive Services API key |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

## Deployment

```bash
cd backend
npm run deploy      # deploys to Cloudflare Workers
```

### Stripe webhook

Register the webhook endpoint in your [Stripe Dashboard](https://dashboard.stripe.com/webhooks):

- **URL:** `https://osmosis-api.jtkopacz.workers.dev/stripe/webhook`
- **Events:** `checkout.session.completed`, `customer.subscription.deleted`

## Project Structure

```
osmosis/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Hono app entry point
│   │   ├── types.ts              # Env bindings and shared types
│   │   ├── lib/
│   │   │   ├── db.ts             # D1 database helpers
│   │   │   ├── jwt.ts            # JWT sign/verify
│   │   │   ├── passwords.ts      # PBKDF2 hashing
│   │   │   ├── limits.ts         # Free tier config
│   │   │   └── googleOAuth.ts    # Google OAuth helpers
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts    # JWT authentication
│   │   │   └── checkUsage.ts     # Free tier enforcement
│   │   └── routes/
│   │       ├── auth.ts           # Email/password auth
│   │       ├── googleOAuth.ts    # Google OAuth flow
│   │       ├── translate.ts      # Translation endpoint
│   │       ├── user.ts           # User profile + Stripe checkout
│   │       └── stripe.ts         # Stripe webhook handler
│   ├── test/
│   └── wrangler.toml
│
└── extension/
    ├── src/
    │   ├── background/
    │   │   ├── index.ts          # Service worker message handler
    │   │   ├── api.ts            # Backend API client
    │   │   ├── auth.ts           # Token storage helpers
    │   │   └── cache.ts          # In-memory translation cache
    │   ├── content/
    │   │   ├── index.ts          # Content script entry
    │   │   ├── walker.ts         # DOM word collection
    │   │   ├── filter.ts         # Word eligibility filtering
    │   │   ├── scorer.ts         # Word frequency scoring
    │   │   └── replacer.ts       # DOM replacement + tooltips
    │   ├── popup/
    │   │   ├── main.ts           # Popup bootstrap
    │   │   ├── views/
    │   │   │   ├── login.ts      # Login/signup view
    │   │   │   ├── main.ts       # Main settings view
    │   │   │   └── settings.ts   # Account + plan view
    │   │   └── components/
    │   │       ├── toggle.ts
    │   │       ├── slider.ts
    │   │       ├── languagePicker.ts
    │   │       └── usageMeter.ts
    │   └── shared/
    │       ├── types.ts          # Shared TypeScript types
    │       ├── constants.ts      # API URL, storage keys
    │       └── languages.ts      # Supported language list
    ├── manifest.json
    └── vite.config.ts
```
