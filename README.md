<div align="center">

<img src="public/logo.png" alt="" width="104" height="104">

<img src="public/hockeyai_name.png" alt="Hockey.AI" width="320">

### Your intelligent companion for the FIH Hockey World Cup 2026

**Analyze. Predict. Experience.**

16 nations · 32 matches · Belgium &amp; Netherlands · 15–30 August 2026

<br>

<a href="https://prashobhpaul.github.io/worldcup2026hockey/">
<img src="https://img.shields.io/badge/▶%20Open%20Hockey.AI-Install%20as%20an%20app-ffb547?style=for-the-badge&labelColor=0b1736" alt="Open Hockey.AI">
</a>

<br><br>

<img src="https://img.shields.io/badge/works-offline-22c55e?style=flat-square&labelColor=0b1736" alt="Works offline">
<img src="https://img.shields.io/badge/no-account%20needed-8fa3d1?style=flat-square&labelColor=0b1736" alt="No account needed">
<img src="https://img.shields.io/badge/no-ads%20or%20trackers-8fa3d1?style=flat-square&labelColor=0b1736" alt="No ads or trackers">
<img src="https://img.shields.io/badge/free-forever-ffb547?style=flat-square&labelColor=0b1736" alt="Free">

</div>

---

## Install it in five seconds

Hockey.AI is a web app that installs like a native one — no store, no sign-up, no download queue.

| | |
|---|---|
| **iPhone / iPad** | Open the link in Safari → **Share** → **Add to Home Screen** |
| **Android** | Open the link in Chrome → tap **Install** when it appears, or **⋮ → Install app** |
| **Desktop** | Open the link in Chrome or Edge → click the **install icon** in the address bar |

Once installed it keeps working on the underground, on a plane, and in a stadium with no signal — every match, table and prediction is stored on your device and refreshes itself the moment you're back online.

There is deliberately **no APK to sideload**: the install above IS the app — same icon, same full screen, same offline behaviour — delivered straight from this repository with nothing to download from a third party. Follow a team on its page and tap the bell on Home to get start-of-match and full-time notifications while the app is open or in the background (a static app has no push server, so a fully closed app stays silent — by design, nothing can track you to wake you).

---

## What it does

### 🏑 Every match, as it happens
Live scores, quarter-by-quarter timelines, penalty corners, cards and full match stats — with the key moments marked so you can catch up on a match in fifteen seconds.

### 🎯 Predictions that are graded in public
Every fixture gets an engine pick **before** it's played. Once the result is in, the pick is graded — correct or wrong, on the record. Picks are never edited or deleted after the fact, and the running accuracy is shown at the top of every screen. If the model is having a bad tournament, you'll see it.

### 📈 One champion probability, everywhere
A Monte-Carlo simulation runs the remaining tournament thousands of times after every completed match. The number you see on the Oracle race chart is the same number on the odds table, the team page and the home screen — one calculation, one answer, no contradictions.

### 🧠 AI Lab
Live win-probability that moves with the match, momentum swings, upcoming-fixture previews, and a written brief for every finished match.

### 🏆 Tournament centre
Pool tables, stat boards, the bracket as it locks, the Tournament's Best XI picked purely on AI player ratings — and the awards, with the engine's pre-tournament picks graded against the real ones.

### 🌍 Teams and players
All 16 squads with a pre-tournament introduction, a live title probability, and per-player AI ratings out of 100 that update after every match. Filter the field by who's still alive, the favourites, the contenders, the dark horses.

---

## Why you can trust the numbers

- **The engine shows its work.** Every probability names the snapshot it came from — how many matches are counted, which model version, how many simulations.
- **It says when it doesn't know.** No fake 33/33/33 splits, no invented stats. Where data is estimated rather than official, it's labelled as estimated.
- **Nothing is quietly rewritten.** Match results, predictions and awards are append-only; the git history is the audit trail.
- **Your data stays yours.** No account, no analytics, no ad network. The app never sends anything about you anywhere.

---

## Under the hood

React + Vite, offline storage in IndexedDB, and a GitHub Actions pipeline that pulls official FIH results through match days, recomputes player ratings and predictions, and redeploys itself. There is no server and no database to pay for — the tournament data lives in this repository.

The system is **AI-first with a deterministic fallback**. Match briefs and pick rationales are written by a language model when one is configured; every number underneath them comes from the calibrated statistical engine, which also stands in on its own whenever no model is available. Code, data and configuration are kept apart:

- `model/params.json` — every model constant, in one documented file, read verbatim by both the pipeline (Python) and the app engine (JavaScript) so the two can never drift.
- `public/data/` — the published tournament data. Append-only where it matters: picks and probabilities are never rewritten, corrections arrive as new revision rows.
- `scripts/backtest_model.py` — re-scores every completed match *as-of-then* (using only what was known before each push-back), so the calibration claims are reproducible on demand.

### Bring your own AI

Fork the repo, add one repository secret, and the AI tier switches on — no code changes:

| Secret | Provider | Default model |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic | `claude-sonnet-5` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |

Set `AI_MODEL` to pin a specific model id. Without a key, the deterministic engine composes the same content from the same event data — the app is complete either way. See `scripts/ai_provider.py`.

```bash
npm install
npm run dev               # local dev server
npm run build             # production build
npm run test:probability  # probability consistency suite
python3 scripts/backtest_model.py  # model calibration, as-of-then
```

---

<div align="center">

Sister app: **[Soccer.AI](https://fifa2026.prashobhpaul.com)** — the same engine for the football World Cup.

<sub>An independent project. Not affiliated with, endorsed by, or connected to the FIH.<br>
Team names, results and rankings are the property of their respective owners.</sub>

</div>
