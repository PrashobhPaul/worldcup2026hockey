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
import { projectBracket, orderedResults } from './simulate.js'
import { buildSnapshotSeries, toPercent, describeSnapshot } from './probability.js'
import { computeStandings } from './standings.js'

let _cache = { key: null, value: null }

export function computeOracleBundle(teams, matches) {
  const results = orderedResults(matches)
  const key = `${teams.length}:${matches.length}:${results.map(m => `${m.id}${m.score.home}-${m.score.away}`).join(',')}`
  if (_cache.key === key) return _cache.value

  const snapshots = buildSnapshotSeries(teams, matches)
  const current = snapshots[snapshots.length - 1]
  const standings = computeStandings(teams, matches)
  const bracket = projectBracket(teams, matches, standings)

  // Title-elimination point on the finished-count axis. Everyone advances from
  // Stage 1 to Stage 2, so nobody is out of the *tournament* at the pool stage —
  // but finishing 3rd/4th drops a team into pools G/H, which only play for
  // places 9–16, so they are out of *contention* the moment their pool
  // completes. Semi-final losers drop out of the gold race at that result.
  const eliminationAt = new Map()
  const poolMatches = matches.filter(m => m.phase === 'pool')
  for (const pool of standings) {
    const done = poolMatches.filter(m => m.pool === pool.id).every(m =>
      m.status === 'completed' && m.score?.home != null)
    if (!done) continue
    pool.standings.slice(2).forEach(row => {
      const lastIdx = results.reduce((acc, m, i) =>
        (m.home === row.team || m.away === row.team) ? i + 1 : acc, 0)
      eliminationAt.set(row.team, { finishedCount: lastIdx, stage: 'Stage 2 (9–16)' })
    })
  }
  for (const tie of bracket.ties) {
    if (tie.played && tie.loser && tie.group === 'semi') {
      const idx = results.findIndex(m => m.id === tie.id)
      if (idx >= 0) eliminationAt.set(tie.loser, { finishedCount: idx + 1, stage: 'SF' })
    }
  }

  const value = {
    snapshots,
    current,
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
  return useMemo(() => {
    if (!teams?.length || !matches?.length) return null
    return computeOracleBundle(teams, matches)
  }, [teams, matches])
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
