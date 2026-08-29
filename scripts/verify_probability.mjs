#!/usr/bin/env node
/**
 * Tournament probability consistency suite.
 *
 * Guards the single-source-of-truth rule: every surface that shows a champion
 * probability must read the same canonical snapshot, and a given snapshot must
 * be byte-identical no matter how many times, or in what order, it is built.
 *
 * Run: npm run test:probability
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildSnapshotSeries, getSnapshot, probabilityMass, classifyProbability,
  formatProbability, MODEL_VERSION, SIMULATION_COUNT, makeSnapshotId,
} from '../src/engine/probability.js'
import { computeOracleBundle, buildRaceSeries, publishedAdvanceMap } from '../src/engine/oracleBundle.js'
import { orderedResults } from '../src/engine/simulate.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8'))

// Mirror src/sync.js field mapping so the test exercises real shipped data.
const rawTeams = readJson('teams.json')
const teams = (rawTeams.teams ?? rawTeams).map(t => ({
  ...t, fihRank: t.fih_rank, winProb: t.win_prob,
}))
const matches = readJson('fixtures.json').matches.map(m => ({
  ...m, kickoffUtc: Date.parse(`${m.date}T${m.time}:00+02:00`),
}))
// The bundle is built with the ledger, as every page builds it. Without it the
// simulation falls back to its own rating model and this file would verify a
// bundle no screen actually shows.
const predictions = readJson('predictions.json').predictions
const activeRows = predictions.filter(p => !p.superseded)
// The same map the app builds, from the one definition, so every snapshot
// compared below is built on the ledger the screens are built on.
const published = publishedAdvanceMap(matches, predictions)

let failures = 0
let checks = 0
const ok = (name, cond, detail = '') => {
  checks++
  if (cond) return
  failures++
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
const section = name => console.log(`\n${name}`)
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol

const results = orderedResults(matches)
const N = results.length
console.log(`Data: ${teams.length} teams, ${matches.length} fixtures, ${N} completed`)
console.log(`Model: ${MODEL_VERSION} · ${SIMULATION_COUNT.toLocaleString()} sims/snapshot`)

// ── 1. Snapshot integrity ─────────────────────────────────────────────────
section('1. Snapshot integrity')
const series = buildSnapshotSeries(teams, matches, published)
ok('series covers 0…N', series.length === N + 1, `got ${series.length}, want ${N + 1}`)
for (const snap of series) {
  const k = snap.completedMatches
  ok(`snapshot ${k} id`, snap.snapshotId === makeSnapshotId(k))
  ok(`snapshot ${k} entries`, snap.probabilities.length === teams.length)
  ok(`snapshot ${k} sums to 1`, near(probabilityMass(snap), 1, 1e-9),
    `sum=${probabilityMass(snap)}`)
  ok(`snapshot ${k} uniform sim count`, snap.simulationCount === SIMULATION_COUNT)
  ok(`snapshot ${k} ranks are 1…n`,
    snap.probabilities.every((p, i) => p.rank === i + 1))
  ok(`snapshot ${k} sorted by champion desc`,
    snap.probabilities.every((p, i, a) => i === 0 || a[i - 1].champion >= p.champion))
  ok(`snapshot ${k} classification matches probability`,
    snap.probabilities.every(p => p.classification === classifyProbability(p.champion)))
  ok(`snapshot ${k} team ids are stable codes`,
    snap.probabilities.every(p => /^[A-Z]{3}$/.test(p.teamId)))
}

// ── 2. Determinism (refresh / re-navigation must not move numbers) ────────
section('2. Determinism across rebuilds')
const seriesAgain = buildSnapshotSeries(teams, matches, published)
for (let k = 0; k <= N; k++) {
  ok(`snapshot ${k} reproducible`,
    series[k].probabilities.every((p, i) =>
      p.teamId === seriesAgain[k].probabilities[i].teamId &&
      p.champion === seriesAgain[k].probabilities[i].champion))
}
// Built out of order and in isolation, a snapshot is still identical.
for (const k of [0, 1, 4, Math.min(8, N), N].filter(k => k <= N)) {
  const isolated = getSnapshot(teams, matches, k, undefined, published)
  ok(`snapshot ${k} build-order-independent`,
    isolated.probabilities.every((p, i) => p.champion === series[k].probabilities[i].champion))
}

// INPUT-order independence. The app loads teams from Dexie (keyed by code)
// while the seed file and this test load them in seeding order; the simulator
// consumes RNG draws resolving pool tie-breaks, so an unsorted input would
// silently produce different numbers in the browser than in CI.
section('2b. Input-order independence')
const shuffle = (arr, seed) => {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const shuffled = buildSnapshotSeries(shuffle(teams, 7), shuffle(matches, 13), published)
for (let k = 0; k <= N; k++) {
  for (const t of teams) {
    ok(`snapshot ${k}: ${t.code} independent of input order`,
      shuffled[k].championOf(t.code) === series[k].championOf(t.code),
      `${shuffled[k].championOf(t.code)} vs ${series[k].championOf(t.code)}`)
  }
}

// ── 3. Historical snapshots vs the app bundle ─────────────────────────────
section('3. Bundle wiring (Oracle / Tournament / Home / Team)')
const bundle = computeOracleBundle(teams, matches, predictions)
ok('bundle.current is the last snapshot object', bundle.current === bundle.snapshots[N])
ok('bundle.current completedMatches', bundle.current.completedMatches === N)

for (const k of [0, 1, 4, 8].filter(k => k <= N)) {
  const fromBundle = bundle.snapshotAt(k)
  const canonical = series[k]
  for (const t of teams) {
    ok(`after match #${k}: ${t.code} identical in bundle`,
      fromBundle.championOf(t.code) === canonical.championOf(t.code),
      `${fromBundle.championOf(t.code)} vs ${canonical.championOf(t.code)}`)
  }
}

// Every consumer expression, evaluated exactly as the pages evaluate it.
section('4. Cross-surface equality (all 16 teams, current state)')
const race = buildRaceSeries(bundle, teams)
const raceEnd = race.data[race.data.length - 1]
for (const t of teams) {
  const canonical = bundle.current.championOf(t.code)
  const out = bundle.eliminationAt.has(t.code)

  // Tournament → Win Probability
  const tournament = bundle.current.get(t.code)?.champion ?? 0
  // Oracle → Odds
  const odds = bundle.current.probabilities.find(p => p.teamId === t.code)?.champion ?? 0
  // Home → Trending
  const home = bundle.current.championOf(t.code)
  // Team page → Oracle snapshot
  const team = bundle.current.get(t.code)?.champion ?? 0
  // Awards → team odds
  const awards = bundle.current.championOf(t.code)
  // Oracle → Race chart endpoint (rounded to 2dp for the chart axis)
  const chart = raceEnd[t.code]

  ok(`${t.code}: Tournament == canonical`, tournament === canonical)
  ok(`${t.code}: Oracle odds == canonical`, odds === canonical)
  ok(`${t.code}: Home == canonical`, home === canonical)
  ok(`${t.code}: Team page == canonical`, team === canonical)
  ok(`${t.code}: Awards == canonical`, awards === canonical)
  if (chart !== undefined) {
    ok(`${t.code}: Race endpoint == canonical`,
      near(chart, out ? 0 : +(canonical * 100).toFixed(2), 1e-9),
      `chart=${chart} canonical=${(canonical * 100).toFixed(2)}`)
  }
}

// ── 5. Eliminated teams carry zero champion mass ──────────────────────────
section('5. Eliminated teams')
for (const [code] of bundle.eliminationAt) {
  ok(`${code} eliminated ⇒ 0% champion`, bundle.current.championOf(code) === 0,
    `${bundle.current.championOf(code)}`)
}

// ── 6. Formatting is presentation-only ────────────────────────────────────
section('6. Formatting')
ok('formatProbability rounds at display time', formatProbability(0.289736) === '29.0%')
ok('formatProbability handles zero', formatProbability(0) === '0.0%')
ok('formatProbability handles missing', formatProbability(null) === '—')
ok('canonical values keep full precision',
  bundle.current.probabilities.some(p => p.champion > 0 && p.champion !== +p.champion.toFixed(3)) ||
  bundle.current.probabilities.every(p => Number.isFinite(p.champion)))

// ── 7. No hardcoded probabilities in UI components ────────────────────────
section('7. No hardcoded probabilities in the UI')
const uiFiles = []
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(jsx?|tsx?)$/.test(e.name)) uiFiles.push(p)
  }
}
walk(path.join(ROOT, 'src/pages'))
walk(path.join(ROOT, 'src/components'))
for (const f of uiFiles) {
  const src = fs.readFileSync(f, 'utf8')
  const rel = path.relative(ROOT, f)
  ok(`${rel} runs no simulation`,
    !/simulateTournament|championProgression|mulberry32|samplePoisson/.test(src))

  // One rounding rule. A screen that rounds a probability itself is a second
  // presentation of a number the app already prints elsewhere — that is how
  // the gold final came to read 53% on the match card, 53% on the Oracle pick
  // and 52.8% in the champion race, three renderings of one published claim.
  // formatProbability is the only place a probability may be rounded.
  const selfRounded = [...src.matchAll(/(?:Math\.round|Number)\(([^\n]{0,90}?)\s*\*\s*100\s*\)|([\w.?[\]]*(?:champion|confidence|advance|prob|pHome|pAway)[\w.?[\]]*)\.toFixed\(/gi)]
    .map(m => (m[1] ?? m[2]).trim())
    .filter(e => /pred\b|\.reg\b|advance|champion|confidence|prob|pHome|pAway|p_home|p_away|p_draw/i.test(e))
  ok(`${rel} leaves probability rounding to formatProbability`,
    selfRounded.length === 0, selfRounded.join(' | '))
}

// The race axis and its caption span the real fixture list. Both were written
// down as 32 — a leftover from an earlier, smaller format — and stayed wrong
// on screen through every schedule change since.
const oracleSrc = fs.readFileSync(path.join(ROOT, 'src/pages/Oracle.jsx'), 'utf8')
ok('the race axis domain is read from the fixture list',
  !/domain=\{\[\s*0\s*,\s*\d+\s*\]\}/.test(oracleSrc))
ok('the race caption states no hardcoded match total',
  !/\(0\s*(?:→|–|-)\s*\d+/.test(oracleSrc))

// ── 8. Team intros must not contradict the official rankings ─────────────
// The pipeline rewrites fih_rank from fih.hockey on every run, and an intro
// written against the old table silently becomes false. Any rank claim an
// intro makes is checked against the current data here.
section('8. Team intro rank claims vs official ranks')
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth']
const rankOf = code => teams.find(t => t.code === code)?.fihRank
const worstInPool = pool => Math.max(...teams.filter(t => t.pool === pool).map(t => t.fihRank))

for (const t of teams) {
  const intro = t.intro || ''
  if (!intro) { ok(`${t.code} has a pre-tournament intro`, false); continue }
  checks++ // an intro that makes no rank claim still counts as checked

  // "ranked first in the world" / "arrive fourth in the world"
  for (const [i, word] of ORDINALS.entries()) {
    const claim = new RegExp(`(ranked|arrive|start[^.]*?)\\s+${word}\\s+in the world`, 'i')
    if (claim.test(intro)) {
      ok(`${t.code} claims world #${i + 1}`, t.fihRank === i + 1, `actually #${t.fihRank}`)
    }
  }
  // "ranked sixteenth of sixteen"
  const ofN = intro.match(/ranked (\w+) of (\d+)/i)
  if (ofN) {
    const claimed = ORDINALS.indexOf(ofN[1].toLowerCase()) + 1
    ok(`${t.code} claims #${claimed} of ${ofN[2]}`, claimed === t.fihRank, `actually #${t.fihRank}`)
  }
  // "the lowest ranking / lowest-ranked side in Pool X"
  const lowest = intro.match(/lowest[- ](?:ranking|ranked side) in Pool ([A-D])/i)
  if (lowest) {
    const pool = lowest[1].toUpperCase()
    ok(`${t.code} claims lowest rank in Pool ${pool}`,
      t.pool === pool && t.fihRank === worstInPool(pool),
      `#${t.fihRank}, worst in pool is #${worstInPool(pool)}`)
  }
  // "outside the top ten"
  if (/outside the top ten/i.test(intro)) {
    ok(`${t.code} claims outside the top ten`, t.fihRank > 10, `actually #${t.fihRank}`)
  }
}
console.log(`  checked ${teams.length} intros against fih_rank`)

// ── Certainty needs a played final ─────────────────────────────────────────
// On 29 Aug the app said Spain were 100% to win the cup, two days before the
// final — a corrupted record had marked the gold final completed with a score
// borrowed from a stage-2 match. Whatever the data says, the engine must
// never assert a champion while the final is unplayed; certainty is earned on
// the pitch, never computed.
{
  const gold = matches.find(m => m.phase === 'gold-final')
  const finalPlayed = gold && gold.status === 'completed' && gold.score?.home != null
  const snaps = Object.values(series)
  const last = snaps[snaps.length - 1]
  const top = last.probabilities[0]
  if (!finalPlayed) {
    ok('no champion probability reaches certainty before the final is played',
      last.probabilities.every(p => p.champion < 1 && p.champion >= 0),
      `${top?.teamId} at ${top?.champion}`)
    const alive = last.probabilities.filter(p => p.champion > 0)
    ok('while the final is unplayed, both finalists still carry championship mass',
      alive.length >= 2, alive.map(p => p.teamId).join(','))
  } else {
    ok('once the final is played, exactly one champion carries certainty',
      last.probabilities.filter(p => p.champion === 1).length <= 1)
  }
}

// ── The champion race and the bracket answer with one voice ───────────────
// Once the gold final is the only match left, "wins the final" and "is
// champion" are the same question. The race used to run a rating Elo while
// the board read the published pick, and they differed by ten points in
// public — Germany 53% on the board against 63.8% in the race. Both now read
// the ledger, and this holds them together.
{
  const unplayed = matches.filter(m => m.phase === 'gold-final'
    && (m.score?.home == null || m.status !== 'completed'))
  if (unplayed.length === 1) {
    const gold = unplayed[0]
    const row = activeRows.find(p => p.matchId === gold.id)
    if (row && row.p_home_win != null) {
      const advHome = row.p_home_win + (row.p_draw ?? 0) / 2
      const champ = new Map(bundle.current.probabilities.map(p => [p.teamId, p.champion]))
      for (const [code, want] of [[gold.home, advHome], [gold.away, 1 - advHome]]) {
        const got = champ.get(code) ?? 0
        // Exact, not close. With only the final left these are the same
        // question, and the knockout tail is summed rather than sampled, so
        // any daylight between them is a wiring fault and not simulation noise.
        ok(`${code}: the champion race equals the published final pick`,
              Math.abs(got - want) < 1e-9,
              `race ${(got * 100).toFixed(4)}% vs published ${(want * 100).toFixed(4)}%`)
        // And the reader sees one value, not two roundings of one value.
        ok(`${code}: race and pick print the same figure`,
              formatProbability(got) === formatProbability(want),
              `${formatProbability(got)} vs ${formatProbability(want)}`)
      }
      const others = bundle.current.probabilities
        .filter(p => p.teamId !== gold.home && p.teamId !== gold.away && p.champion > 0.001)
      ok('nobody outside the final carries champion probability',
            others.length === 0, others.map(p => p.teamId).join(', '))
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
const top = bundle.current.probabilities.slice(0, 5)
  .map(p => `${p.teamId} ${formatProbability(p.champion)}`).join(' · ')
console.log(`\nCurrent snapshot (${bundle.current.snapshotId}): ${top}`)
console.log(`${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('All probability consistency checks passed.')
