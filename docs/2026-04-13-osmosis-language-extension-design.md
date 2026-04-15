# Osmosis — Language Learning Chrome Extension

**Date:** 2026-04-13  
**Status:** Approved

## Overview

Osmosis is a Chrome extension that passively teaches users a new language by replacing a configurable percentage of words on any webpage with their translated equivalents. Hovering a translated word reveals the original. Users sign up for a freemium account; translation is powered by Azure Translator via a Cloudflare Workers backend.

---

## Goals

- Replace N% of eligible words on any page with translations in the user's chosen target language
- Hover over any replaced word to reveal the original
- Enable/disable per-tab via popup toggle
- Freemium: 50,000 chars/month free, unlimited on Pro ($5/month via Stripe)
- Publish to Chrome Web Store for public use

---

## Architecture

### System Components

```
Chrome Extension → Cloudflare Worker (edge) → Azure Translator API
                         ↓                          ↓ (cache miss only)
                   Workers KV (translation cache)
                   D1 (users, usage)
                   Stripe (webhooks → plan updates)
```

### Extension (Manifest V3)

| File | Responsibility |
|------|---------------|
| `content.js` | DOM walking, word selection, replacement, hover tooltips |
| `background.js` (service worker) | API calls, in-memory translation cache, auth token management |
| `popup/` | Settings UI: toggle, language picker, % slider, settings page |

### Backend (Cloudflare Workers + Hono)

| Endpoint | Description |
|----------|-------------|
| `POST /translate` | Batch translate words; checks KV cache, falls back to Azure |
| `POST /auth/signup` | Create account, return JWT |
| `POST /auth/login` | Verify credentials, return JWT |
| `GET /user/me` | Return plan, usage, chars remaining this month |
| `POST /stripe/webhook` | Handle subscription events, update plan in D1 |

### Database (Cloudflare D1)

```sql
users(id, email, password_hash, stripe_customer_id, plan, created_at)
usage(user_id, year_month, char_count)
```

### Translation Cache (Workers KV)

- Key: `{word}:{target_lang_code}` → Value: translated word
- TTL: 30 days
- Deduplication before cache lookup — one lookup per unique word per request

---

## Word Selection Logic

The content script selects words via a 5-stage pipeline:

1. **DOM Walk** — `TreeWalker` visits text nodes only. Skips `<script>`, `<style>`, `<code>`, `<pre>`, `<input>`, `<textarea>`, `<nav>`, `<button>`.

2. **Hard Filters** — A word is ineligible if:
   - Fewer than 3 characters
   - All uppercase (acronyms: API, HTML, URL)
   - Contains a digit (version numbers, dates)
   - Resembles a URL or email address
   - Starts with a capital letter mid-sentence (proper noun heuristic)

3. **Frequency Scoring** — A bundled ~10K word frequency list (~20KB, shipped with extension) scores each eligible word. Words ranked 100–3000 (common but learnable) score highest. Ultra-common words (the, a, is) and unknown words score lowest.

4. **Percentage Sample** — The user's configured percentage (10–50%) determines how many top-scored words are selected. Selection uses a URL-hash seed so the same words are always replaced on the same page. Hard cap: 200 words per page.

5. **Batch Translate + Replace** — Selected words are deduplicated and sent in a single API call. Each replaced word is wrapped in `<span class="osmosis-word" data-original="originalWord">translation</span>`. A CSS `::after` tooltip on hover shows the original.

---

## Popup UI

### Main View
- **Header:** Logo + on/off toggle (persisted in `chrome.storage.sync`)
- **Language picker:** Searchable dropdown of all Azure-supported languages (~130). Last selection remembered.
- **Percentage slider:** 10%–50% in 5% steps. Changes re-run word selection on the active tab live.
- **Footer:** User email + ⚙️ settings icon

### Settings Page (⚙️)
- Account email + plan badge (Free / Pro)
- Monthly usage meter (green → yellow → red as limit approaches; resets display shows next reset date)
- Upgrade to Pro CTA → opens Stripe checkout in new tab (hidden for Pro users, replaced with "Pro ✓")
- Sign out

### Popup States
| State | Behavior |
|-------|----------|
| Logged out | Shows Sign In / Sign Up, no controls |
| Disabled (toggle off) | Controls visible but greyed out; content script idles |
| Limit reached | Translations blocked; upgrade CTA prominent in settings |
| Pro user | Usage meter hidden; upgrade CTA replaced with "Pro ✓" badge |

---

## Freemium Model

| Tier | Chars/month | Price |
|------|-------------|-------|
| Free | 50,000 (~10,000 words) | $0 |
| Pro | Unlimited | $5/month |

Usage is tracked in D1 by `(user_id, year_month)`. The Worker checks and increments `char_count` on every `/translate` call. Requests that would exceed the free limit are rejected with a `402` response; the extension suppresses replacement silently and shows the upgrade prompt in the popup.

---

## Chrome Permissions

```json
{
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": ["<all_urls>"]
}
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Monthly limit reached | Words stop being replaced; popup shows upgrade CTA; no error shown on page |
| Network offline | Skip translation silently; page loads and renders normally |
| Azure API error | Retry once; if still failing, fail silently — never break the host page |
| Auth token expired | Popup prompts re-login; extension disables itself gracefully |

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Extension | Vanilla TypeScript, Manifest V3, built with Vite |
| Backend runtime | Cloudflare Workers (TypeScript) |
| Backend router | Hono |
| Database | Cloudflare D1 (SQLite) |
| Translation cache | Cloudflare Workers KV |
| Translation API | Azure Cognitive Services Translator |
| Payments | Stripe |
| Auth | JWT (issued by Worker, stored in `chrome.storage.local`) |
| Deploy | Wrangler CLI |

---

## Out of Scope (v1)

- Mobile / Firefox support
- Offline/on-device translation
- Bi-directional translation (non-English source pages)
- Pronunciation audio
- Flashcard review mode
- Team/family plans
