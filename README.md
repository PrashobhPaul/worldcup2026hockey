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

## Feature parity with Soccer.AI

Every Soccer.AI surface has a hockey twin:

| Soccer.AI | Hockey.AI |
|---|---|
| AI Lab (live intelligence · previews · stories) | `/ai-lab` — momentum, win-prob evolution, chaos index, comeback, key drivers, tactical insights, match DNA radar |
| Oracle (race worm · odds · bracket) | `/prediction-race` — champion-probability race, per-team stage odds, predictive knockout bracket, graded picks ledger |
| Awards + Ballon d'Or | `/awards` — FIH Hall of Fame picks + live Player of the Tournament race (softmax model) |
| AI Simulation (Best XI exhibition) | `/match/sim/sim_best_xi_vs_rising_xi` — Tournament's Best XI vs Rising Stars XI |
| Stats (leaderboards + standings) | `/tournament` — Golden Stick, assists, attack & defense, fair play + pool standings |
| Trust & Privacy | `/trust` |
| Team pages with Oracle snapshot + champion worm | `/teams/:code` |

Where Soccer.AI runs its Elo + Dixon-Coles engine server-side, Hockey.AI ships a seeded
client-side Monte-Carlo engine (`src/engine/strength.js`, `simulate.js`) — 16 teams and 32
matches are cheap enough to simulate in the browser, deterministically.

## Manual score entry (phone, GitHub web UI)

Edit `public/data/fixtures.json` → set `score`, `status: "completed"`, `penalty_corners`, `events` → bump `version` in `public/data/data-version.json` → commit. The pipeline never overwrites manual scores.

## Deploy

**GitHub Pages** — `.github/workflows/deploy-pages.yml` builds and publishes on every push to
`main` (enable is automatic on first run). The build honors the Pages base path, so the app
works at `https://<user>.github.io/worldcup2026hockey/` and on a custom domain alike.

**Cloudflare Pages** (alternative) — build command `npm run build` · output directory `dist` ·
custom domain `hockey2026.prashobhpaul.com`.
