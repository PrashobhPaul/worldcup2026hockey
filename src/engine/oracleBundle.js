// Hockey.AI — shared tournament state bundle
//
// Composes the canonical probability snapshots (engine/probability.js) with
// standings, the projected bracket and elimination points, and hands every
// page the SAME object. One cache keyed by the result fingerprint means Race,
// Odds, Bracket, Tournament, Home and Team pages all read identical numbers.
//
// bundle.snapshots[k] — tournament state after match #k (k = 0 … N)
// bundle.current      — snapshots[N]; the same object, not a second run

import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db.js'
import { activePredictions } from './prediction.js'
import { projectBracket, orderedResults } from './simulate.js'
import { buildSnapshotSeries, toPercent, describeSnapshot } from './probability.js'
import { computeStandings } from './standings.js'
import { assignTiers } from './tiers.js'

let _cache = { key: null, value: null }

// The ledger's advance probability for every tie still to be played, keyed the
// way the simulation keys a knockout. This is what makes the champion race and
// the bracket board one claim rather than two: both read the published pick,
// and neither runs a model of its own on top of it.
export function publishedAdvanceMap(matches, predictions) {
  const byId = new Map(matches.map(m => [m.id, m]))
  const out = new Map()
  for (const row of activePredictions(predictions ?? [])) {
    const m = byId.get(row.matchId)
    if (!m || m.home === 'TBD' || m.away === 'TBD') continue
    if (row.p_home_win == null || m.phase === 'pool' || m.phase === 'stage2') continue
    const pair = m.home < m.away ? `${m.home}|${m.away}` : `${m.away}|${m.home}`
    out.set(`${m.phase}:${pair}`, { home: m.home, p: row.p_home_win + (row.p_draw ?? 0) / 2 })
  }
  return out
}

export function computeOracleBundle(teams, matches, predictions) {
  const results = orderedResults(matches)
  const published = publishedAdvanceMap(matches, predictions)
  const pkey = [...published.entries()].map(([k, v]) => `${k}${v.home}${v.p.toFixed(4)}`).join(',')
  const key = `${teams.length}:${matches.length}:${results.map(m => `${m.id}${m.score.home}-${m.score.away}`).join(',')}|${pkey}`
  if (_cache.key === key) return _cache.value

  const snapshots = buildSnapshotSeries(teams, matches, published)
  const current = snapshots[snapshots.length - 1]
  const standings = computeStandings(teams, matches)
  const bracket = projectBracket(teams, matches, standings)

  // Title-elimination point on the finished-count axis.
  //
  // The title race is the semi-final path and nothing else, so the honest
  // definition is the bracket's: once the semi-finals name their four teams,
  // everyone else is out of contention — including the sides that finished
  // 3rd and 4th in Pools E and F, who play only for 5th to 8th. Reading it
  // off the bracket rather than re-deriving it here is what keeps the Teams
  // grid, the Oracle race and the team pages from disagreeing: they are all
  // looking at the same four names.
  //
  // Before the semi-finals are named, a Stage-1 pool that has finished still
  // settles part of it — 3rd and 4th drop into Pools G/H, which play only for
  // places 9–16 — so that rule stays as the earlier signal.
  const eliminationAt = new Map()
  const markOut = (code, stage) => {
    if (eliminationAt.has(code)) return
    const lastIdx = results.reduce((acc, m, i) =>
      (m.home === code || m.away === code) ? i + 1 : acc, 0)
    eliminationAt.set(code, { finishedCount: lastIdx, stage })
  }

  const poolMatches = matches.filter(m => m.phase === 'pool')
  for (const pool of standings) {
    const done = poolMatches.filter(m => m.pool === pool.id).every(m =>
      m.status === 'completed' && m.score?.home != null)
    if (!done) continue
    pool.standings.slice(2).forEach(row => markOut(row.team, 'Stage 2 (9–16)'))
  }

  // Once both semi-finals name their sides, the four of them are the title
  // race and every other nation is out of it.
  const semis = bracket.ties.filter(t => t.group === 'semi')
  const contenders = new Set(semis.flatMap(t => [t.home, t.away]).filter(Boolean))
  if (semis.length > 0 && semis.every(t => t.locked) && contenders.size === semis.length * 2) {
    for (const t of teams) {
      if (!contenders.has(t.code)) markOut(t.code, 'Stage 2 (5–8)')
    }
  }

  // A semi-final that has been played settles two more.
  for (const tie of bracket.ties) {
    if (tie.played && tie.loser && tie.group === 'semi') {
      const idx = results.findIndex(m => m.id === tie.id)
      if (idx >= 0) eliminationAt.set(tie.loser, { finishedCount: idx + 1, stage: 'SF' })
    }
  }

  // Who has earned a label. Derived from the same snapshot every surface
  // reads, so the badge on the Teams grid can never disagree with the one on
  // the team page.
  const tiers = assignTiers({
    teams,
    championOf: code => current.championOf(code),
    isOut: code => eliminationAt.has(code),
  })

  const value = {
    snapshots,
    current,
    tiers,
    tierOf: code => tiers.get(code) ?? null,
    /** Historical lookup — `snapshotAt(8)` is the "after match #8" state. */
    snapshotAt: k => snapshots[Math.max(0, Math.min(snapshots.length - 1, k))],
    standings,
    bracket,
    eliminationAt,
    results,
    key,
  }
  _cache = { key, value }

  // Provenance handle: which snapshot is this session showing? Silent in
  // production, logged while developing. Makes a cross-page disagreement
  // diagnosable in one line instead of by comparing screenshots.
  if (typeof window !== 'undefined') {
    window.__hockeyProbability = {
      snapshotId: current.snapshotId,
      modelVersion: current.modelVersion,
      simulationCount: current.simulationCount,
      completedMatches: current.completedMatches,
      seed: current.seed,
      champion: Object.fromEntries(current.probabilities.map(p => [p.teamId, p.champion])),
      describe: () => describeSnapshot(current),
    }
  }
  if (import.meta.env?.DEV) console.info(describeSnapshot(current))
  return value
}

export function useOracleBundle(teams, matches) {
  // The hook reads the ledger itself rather than making every page pass it in.
  // Seven pages call this; one of them forgetting the argument would put that
  // page back on a second opinion, which is the failure this exists to end.
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  return useMemo(() => {
    if (!teams?.length || !matches?.length) return null
    return computeOracleBundle(teams, matches, predictions)
  }, [teams, matches, predictions])
}

/** Race series for the worm chart: one row per snapshot, straight from it. */
export function buildRaceSeries(bundle, teams) {
  if (!bundle) return { data: [], top: [], eliminated: [] }
  const byCode = new Map(teams.map(t => [t.code, t]))
  const current = bundle.current
  const opening = bundle.snapshots[0]

  const alive = teams
    .filter(t => !bundle.eliminationAt.has(t.code))
    .sort((x, y) => current.championOf(y.code) - current.championOf(x.code))
  const top = alive.slice(0, 10).map(t => t.code)

  const eliminated = teams
    .filter(t => bundle.eliminationAt.has(t.code))
    .sort((x, y) => opening.championOf(y.code) - opening.championOf(x.code))
    .map(t => t.code)

  const data = bundle.snapshots.map(snap => {
    const row = { match: snap.completedMatches }
    for (const code of [...top, ...eliminated]) {
      const cut = bundle.eliminationAt.get(code)
      row[code] = cut && snap.completedMatches >= cut.finishedCount
        ? 0
        : toPercent(snap.championOf(code))
    }
    return row
  })

  return { data, top, eliminated, byCode }
}
