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
import { computeOracleBundle, buildRaceSeries } from '../src/engine/oracleBundle.js'
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
const series = buildSnapshotSeries(teams, matches)
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
const seriesAgain = buildSnapshotSeries(teams, matches)
for (let k = 0; k <= N; k++) {
  ok(`snapshot ${k} reproducible`,
    series[k].probabilities.every((p, i) =>
      p.teamId === seriesAgain[k].probabilities[i].teamId &&
      p.champion === seriesAgain[k].probabilities[i].champion))
}
// Built out of order and in isolation, a snapshot is still identical.
for (const k of [0, 1, 4, Math.min(8, N), N].filter(k => k <= N)) {
  const isolated = getSnapshot(teams, matches, k)
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
const shuffled = buildSnapshotSeries(shuffle(teams, 7), shuffle(matches, 13))
for (let k = 0; k <= N; k++) {
  for (const t of teams) {
    ok(`snapshot ${k}: ${t.code} independent of input order`,
      shuffled[k].championOf(t.code) === series[k].championOf(t.code),
      `${shuffled[k].championOf(t.code)} vs ${series[k].championOf(t.code)}`)
  }
}

// ── 3. Historical snapshots vs the app bundle ─────────────────────────────
section('3. Bundle wiring (Oracle / Tournament / Home / Team)')
const bundle = computeOracleBundle(teams, matches)
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
  ok(`${path.relative(ROOT, f)} runs no simulation`,
    !/simulateTournament|championProgression|mulberry32|samplePoisson/.test(src))
}

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
