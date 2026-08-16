# 🏑 Hockey.AI — FIH Hockey World Cup 2026

AI stories, match intelligence, simulations and visual analytics for every FIH Hockey World Cup 2026 fixture. Sister app to [Soccer.AI](https://fifa2026.prashobhpaul.com).

**Live:** https://hockey2026.prashobhpaul.com

## Architecture

Same product DNA as Soccer.AI:

- **React SPA** (Vite) + React Router · **Tailwind CSS v4** · Space Grotesk / Inter / JetBrains Mono
- **Dexie (IndexedDB)** — offline-first client datastore; standings computed live from finished matches
- **PWA** (vite-plugin-pwa + Workbox) — installable, full offline support, NetworkFirst data / CacheFirst assets
- **Oracle engine** — per-match probability rows (`p_home_win / p_draw / p_away_win`); knockout advance = `home + draw/2`; picks published before push-back, graded publicly, never edited
- **Zero backend** — GitHub Actions is the data plane:
  - `scripts/update_data.py` (every 30 min): FIH TMS PDF parse, status transitions, Oracle pick generation, `data-version.json` bump → every installed PWA resyncs
  - `scripts/generate_ai_stories.py`: Claude generates match stories for completed fixtures (needs `ANTHROPIC_API_KEY` repo secret)

## Manual score entry (phone, GitHub web UI)

Edit `public/data/fixtures.json` → set `score`, `status: "completed"`, `penalty_corners`, `events` → bump `version` in `public/data/data-version.json` → commit. The pipeline never overwrites manual scores.

## Deploy (Cloudflare Pages)

Build command `npm run build` · output directory `dist` · custom domain `hockey2026.prashobhpaul.com`.
