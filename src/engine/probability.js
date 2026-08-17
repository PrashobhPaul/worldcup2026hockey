// Hockey.AI — canonical tournament probability layer
//
// THE SINGLE SOURCE OF TRUTH for "how likely is each team to win the World Cup".
// Every page, chart, badge and card in the app reads champion/final/SF/QF
// probabilities from a snapshot produced here. No component may run its own
// simulation or display a probability that did not come out of this module.
//
// Model
//   A snapshot is one deterministic Monte-Carlo run of the whole tournament
//   with the first `k` chronological results held fixed and everything after
//   sampled from the Elo+Poisson strength model (see strength.js / simulate.js).
//   Snapshot k therefore means "the tournament state AFTER match #k".
//
//   snapshots[0]  = pre-tournament
//   snapshots[8]  = after match #8
//   snapshots[N]  = after the newest result  ← this IS the current snapshot
//
//   The current snapshot is not a separate calculation: it is literally the
//   last element of the same series the Oracle race chart plots. That identity
//   is what keeps Tournament, Oracle, Home and Team pages numerically equal.
//
// Determinism
//   Seed and simulation count are derived from the snapshot index alone, so a
//   given (teams, results-prefix, model version) triple always reproduces the
//   same numbers — on reload, on re-navigation, in tests, on any device.
//   Historical snapshots can never drift.

import { MODEL_PARAMS } from './strength.js'
import { simulateTournament, orderedResults } from './simulate.js'

export const TOURNAMENT_ID = 'fih_worldcup_2026'

/** Bump when the model, seeding or snapshot semantics change. */
export const MODEL_VERSION = 'hockey-mc-2026.1'

/** Same simulation count for every snapshot — mixing counts breaks equality. */
export const SIMULATION_COUNT = MODEL_PARAMS.nSims

/** Per-snapshot seed. Index-derived, so snapshot k is always reproducible. */
export const snapshotSeed = k => MODEL_PARAMS.rngSeed + k * 7919

export const makeSnapshotId = k => `${TOURNAMENT_ID}@after-match-${k}`

// ── Classification ────────────────────────────────────────────────────────
// One rule set for the ⭐ Favourite / 🔥 Contender / 🐎 Dark Horse badges.
// Driven by canonical champion probability, never by seed-file editorial
// fields, so a team's badge and its percentage can never disagree.
const TIER_THRESHOLDS = [
  { id: 'favourite', min: 0.15 },
  { id: 'contender', min: 0.08 },
  { id: 'dark_horse', min: 0.03 },
  { id: 'challenger', min: 0.0005 },
]

export function classifyProbability(champion) {
  for (const tier of TIER_THRESHOLDS) if (champion >= tier.min) return tier.id
  return 'outsider'
}

// ── Presentation ──────────────────────────────────────────────────────────
/**
 * The app's only probability formatter. Takes a canonical fraction (0…1) and
 * renders it for display. Full precision stays in the data layer; rounding
 * happens here and nowhere else.
 */
export function formatProbability(p, digits = 1) {
  if (p == null || !Number.isFinite(p)) return '—'
  return `${(p * 100).toFixed(digits)}%`
}

/** Same value as a bare number (for chart series that need a numeric y). */
export function toPercent(p, digits = 2) {
  if (p == null || !Number.isFinite(p)) return 0
  return +(p * 100).toFixed(digits)
}

// ── Snapshot construction ─────────────────────────────────────────────────
const EMPTY_REACH = { top8: 0, sf: 0, final: 0, bronze: 0, champion: 0 }

// The simulator draws from the RNG while resolving pool tie-breaks, so the
// order its inputs arrive in would otherwise change the numbers: Dexie returns
// teams keyed by code, the seed JSON is in seeding order, and a test harness
// may pass either. Canonical ordering is applied here, once, so a snapshot
// depends only on WHAT the data says — never on how it was loaded.
export function canonicalTeams(teams) {
  return [...teams].sort((a, b) => a.code.localeCompare(b.code))
}

export function canonicalMatches(matches) {
  return [...matches].sort((a, b) =>
    (a.kickoffUtc ?? 0) - (b.kickoffUtc ?? 0) || a.id.localeCompare(b.id))
}

function buildSnapshot(teams, matches, k, results) {
  const roster = canonicalTeams(teams)
  const sim = simulateTournament(roster, canonicalMatches(matches), {
    runs: SIMULATION_COUNT,
    seed: snapshotSeed(k),
    truncateAfter: k,
  })

  // Central normalization: the champion column is a probability distribution
  // over the 16 teams and must sum to 1 here, once, for every consumer.
  // Summed in canonical order too — float addition is not associative, and an
  // input-order-dependent divisor would reintroduce per-device drift.
  let mass = 0
  for (const t of roster) mass += sim.reach.get(t.code)?.champion ?? 0

  const probabilities = roster
    .map(t => {
      const r = sim.reach.get(t.code) ?? EMPTY_REACH
      return {
        teamId: t.code,
        teamName: t.name,
        champion: mass > 0 ? r.champion / mass : 0,
        final: r.final,
        sf: r.sf,
        top8: r.top8,
        bronze: r.bronze,
      }
    })
    .sort((a, b) =>
      b.champion - a.champion || b.final - a.final || b.sf - a.sf ||
      b.top8 - a.top8 || a.teamId.localeCompare(b.teamId))

  probabilities.forEach((p, i) => {
    p.rank = i + 1
    p.classification = classifyProbability(p.champion)
  })

  const byTeam = new Map(probabilities.map(p => [p.teamId, p]))

  return {
    snapshotId: makeSnapshotId(k),
    tournamentId: TOURNAMENT_ID,
    completedMatches: k,
    snapshotLabel: k === 0 ? 'Pre-tournament' : `After match ${k}`,
    matchId: k > 0 ? results[k - 1]?.id ?? null : null,
    modelVersion: MODEL_VERSION,
    simulationCount: SIMULATION_COUNT,
    seed: snapshotSeed(k),
    probabilities,
    byTeam,
    /** Canonical champion probability for a team id (0 for unknown teams). */
    championOf: code => byTeam.get(code)?.champion ?? 0,
    /** Full reach entry for a team id. */
    get: code => byTeam.get(code) ?? null,
  }
}

// Snapshot k depends only on the teams and the FIRST k results, so a new
// result invalidates exactly one snapshot (the new last one) and every
// historical snapshot is served from memory, byte-identical, forever.
const _memo = new Map()
const MEMO_LIMIT = 240

function teamsKey(teams) {
  return canonicalTeams(teams)
    .map(t => `${t.code}:${t.fihRank ?? ''}:${t.winProb ?? ''}:${t.host ? 1 : 0}`).join('|')
}

function resultsKey(results, k) {
  return results.slice(0, k).map(m => `${m.id}${m.score.home}-${m.score.away}`).join(',')
}

export function getSnapshot(teams, matches, k, results = orderedResults(matches)) {
  const key = `${MODEL_VERSION}|${SIMULATION_COUNT}|${k}|${teamsKey(teams)}|${resultsKey(results, k)}`
  const hit = _memo.get(key)
  if (hit) return hit
  const snap = buildSnapshot(teams, matches, k, results)
  if (_memo.size >= MEMO_LIMIT) _memo.clear()
  _memo.set(key, snap)
  return snap
}

/**
 * The canonical snapshot series: index k = tournament state after match #k.
 * The last element is the current state — the Oracle race chart and the
 * Tournament win-probability tab are two views of this one array.
 */
export function buildSnapshotSeries(teams, matches) {
  const results = orderedResults(matches)
  const series = []
  for (let k = 0; k <= results.length; k++) series.push(getSnapshot(teams, matches, k, results))
  return series
}

/** Sum of the champion column — 1 for a well-formed snapshot. */
export function probabilityMass(snapshot) {
  return snapshot.probabilities.reduce((sum, p) => sum + p.champion, 0)
}

/** Human-readable provenance block — which snapshot is a surface reading? */
export function describeSnapshot(snapshot) {
  return [
    'Probability Snapshot',
    '--------------------',
    'Tournament: FIH Hockey World Cup 2026',
    `Completed Matches: ${snapshot.completedMatches}`,
    `Snapshot ID: ${snapshot.snapshotId}`,
    `Model Version: ${snapshot.modelVersion}`,
    `Simulation Count: ${snapshot.simulationCount}`,
    `Seed: ${snapshot.seed}`,
    `Leader: ${snapshot.probabilities[0]?.teamId} ${formatProbability(snapshot.probabilities[0]?.champion)}`,
  ].join('\n')
}
