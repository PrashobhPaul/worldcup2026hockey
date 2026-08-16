// Hockey.AI — shared Oracle simulation bundle
// Soccer.AI stores engine snapshots server-side; here the whole tournament is
// small enough to simulate in the browser. One module-level cache keyed by the
// result fingerprint keeps every page reading identical numbers (the
// single-derivation-site rule that keeps Race, Odds and Bracket in sync).

import { useMemo } from 'react'
import { simulateTournament, championProgression, projectBracket, orderedResults } from './simulate'
import { computeStandings } from './standings'

let _cache = { key: null, value: null }

export function computeOracleBundle(teams, matches) {
  const results = orderedResults(matches)
  const key = `${teams.length}:${matches.length}:${results.map(m => `${m.id}${m.score.home}-${m.score.away}`).join(',')}`
  if (_cache.key === key) return _cache.value

  const live = simulateTournament(teams, matches, { runs: 4000 })
  const progression = championProgression(teams, matches, { runsPerStep: 1000 })
  const standings = computeStandings(teams, matches)
  const bracket = projectBracket(teams, matches, standings)

  // Elimination point on the finished-count axis: pool exits when the pool
  // completes without a top-2 finish; knockout losers at that tie's result.
  const eliminationAt = new Map()
  const poolMatches = matches.filter(m => m.phase === 'pool')
  for (const pool of standings) {
    const done = poolMatches.filter(m => m.pool === pool.id).every(m =>
      m.status === 'completed' && m.score?.home != null)
    if (!done) continue
    pool.standings.slice(2).forEach(row => {
      const lastIdx = results.reduce((acc, m, i) =>
        (m.home === row.team || m.away === row.team) ? i + 1 : acc, 0)
      eliminationAt.set(row.team, { finishedCount: lastIdx, stage: 'Pool' })
    })
  }
  for (const tie of bracket.ties) {
    if (tie.played && tie.loser && tie.id !== 'BRZ' && tie.id !== 'GOLD') {
      const idx = results.findIndex(m => m.id === tie.id)
      if (idx >= 0) eliminationAt.set(tie.loser, { finishedCount: idx + 1, stage: tie.id.startsWith('QF') ? 'QF' : 'SF' })
    }
  }

  const value = { live, progression, standings, bracket, eliminationAt, results, key }
  _cache = { key, value }
  return value
}

export function useOracleBundle(teams, matches) {
  return useMemo(() => {
    if (!teams?.length || !matches?.length) return null
    return computeOracleBundle(teams, matches)
  }, [teams, matches])
}

/** Race series for the worm chart: one row per finished-count step. */
export function buildRaceSeries(bundle, teams) {
  if (!bundle) return { data: [], top: [], eliminated: [] }
  const byCode = new Map(teams.map(t => [t.code, t]))
  const lastStep = bundle.progression[bundle.progression.length - 1]

  const alive = teams
    .filter(t => !bundle.eliminationAt.has(t.code))
    .sort((x, y) => (lastStep.champion[y.code] ?? 0) - (lastStep.champion[x.code] ?? 0))
  const top = alive.slice(0, 10).map(t => t.code)

  const eliminated = teams
    .filter(t => bundle.eliminationAt.has(t.code))
    .sort((x, y) => (y.winProb ?? 0) - (x.winProb ?? 0))
    .map(t => t.code)

  const data = bundle.progression.map(step => {
    const row = { match: step.finishedCount }
    for (const code of [...top, ...eliminated]) {
      const cut = bundle.eliminationAt.get(code)
      row[code] = cut && step.finishedCount >= cut.finishedCount
        ? 0
        : +((step.champion[code] ?? 0) * 100).toFixed(2)
    }
    return row
  })

  return { data, top, eliminated, byCode }
}
