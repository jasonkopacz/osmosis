# Osmosis — Project Guide

## What this is

A Chrome MV3 extension that quietly replaces words on any webpage with translations, paired with a Cloudflare Workers backend. Users hover replaced words to see the original; a popup controls language and replacement frequency.

## Monorepo layout

```
extension/   Chrome extension (Vite + CRXJS, TypeScript)
backend/     Cloudflare Workers API (Hono, D1, KV)
```

## Extension architecture

```
src/
├── popup/
│   ├── styles/          ← ALL popup CSS lives here, split by concern
│   │   ├── tokens.css   ← :root design tokens (load first)
│   │   ├── base.css     ← html/body/reset
│   │   ├── chrome.css   ← header, footer, body shell
│   │   ├── components.css ← reusable: toggle, slider, buttons, inputs…
│   │   ├── login.css    ← login view classes
│   │   └── settings.css ← settings view classes
│   ├── components/      ← reusable UI (toggle, slider, usageMeter…)
│   ├── views/           ← full-screen renders (main, login, settings)
│   ├── index.html       ← structure + font links only; no <style> tags
│   └── main.ts          ← entry point; imports all CSS files
├── content/
│   ├── styles/
│   │   └── replacer.css ← .osmosis-word states + #osmosis-tooltip-host
│   └── replacer.ts      ← imports replacer.css?raw for DOM injection
└── background/          ← service worker
```

## CSS / HTML / TS separation rules (enforced)

1. **CSS in `.css` files only.** No `<style>` blocks in HTML, no `element.style.cssText = '...'` in TypeScript.
2. **HTML files contain structure only.** `index.html` has semantic elements, `<link>` for fonts, and one `<script type="module">`. Nothing else.
3. **TypeScript uses class names, not style strings.** Apply state with `classList.toggle('modifier--class', bool)`.
4. **Inline styles only for runtime-computed values.** The only acceptable inline style properties are values that cannot be expressed as static CSS (e.g. `fill.style.width = pct + '%'`).
5. **Content script CSS uses `?raw` imports.** `import styles from './styles/replacer.css?raw'` then inject the string via `injectTooltipStyles()`.

## Design system

Tokens are defined in `styles/tokens.css`. The full spec is at `Osmosis Design System.html` in the project root.

Key palette:
- `--osmo` (#2aa4e0) — primary blue, wordmark
- `--current` (#22d3ee) — links, focus, active state
- `--ember` (#f59a2e) — billing CTAs, fresh-word state
- `--signal` (#4ade80) — success, known-word state
- `--error` (#f87171) — danger, limit reached

Primary gradient: `linear-gradient(180deg, var(--osmo-bright), var(--osmo), var(--osmo-deep))`
Ember gradient (billing only): `linear-gradient(180deg, #fbb461, var(--ember), #c97817)`

## Build

```bash
cd extension && npm run build   # Vite + CRXJS → dist/
cd backend && npm run deploy    # Wrangler → Cloudflare Workers
```

## Key files

| File | Purpose |
|------|---------|
| `extension/src/popup/styles/tokens.css` | Single source of truth for all design tokens |
| `extension/src/popup/main.ts` | Imports all CSS; boots the popup |
| `extension/src/content/replacer.ts` | Word replacement + tooltip injection |
| `backend/src/index.ts` | Hono router entry point |
| `backend/src/routes/translate.ts` | Translation endpoint |
