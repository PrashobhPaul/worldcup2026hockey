// Match-intelligence consistency gate.
//
// The reported failure: the NZL v WAL intelligence panel called a 7-2 with two
// corner goals "set pieces decided this one", and named a seed-file player as
// "the premium drag-flick weapon" who had scored nothing in the tournament.
// Every claim the panel renders must be recomputable from the official event
// feed, for every completed match — this gate does exactly that recomputation.
import fs from 'node:fs'
import { buildMomentumSeries, buildProbSeries, buildInsights, buildDrivers, deriveComeback, deriveTelemetry } from '../src/engine/insights.js'
import { derivePrediction } from '../src/engine/prediction.js'

const read = f => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const fixtures = read('fixtures.json')
const predictions = read('predictions.json')
const teamsDoc = read('teams.json')

const teams = new Map(teamsDoc.teams.map(t => [t.code, { ...t, fihRank: t.fih_rank }]))
const active = new Map()
for (const r of predictions.predictions) {
  if (!r.superseded) {
    if (active.has(r.matchId)) active.get(r.matchId).push(r)
    else active.set(r.matchId, [r])
  }
}

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) return
  failed++
  console.log('  FAIL', name, detail)
}

// 1 — the ledger invariant: one active pick per fixture, never two.
for (const [mid, rows] of active) {
  check(`${mid}: exactly one active prediction row`, rows.length === 1,
    rows.map(r => r.id).join(', '))
}

const completed = fixtures.matches.filter(m => m.status === 'completed' && m.score?.home != null)
const allEvents = fixtures.matches.flatMap(m => (m.events ?? []).map(e => ({ matchId: m.id, ...e })))

for (const m of completed) {
  const events = (m.events ?? [])
  const home = teams.get(m.home), away = teams.get(m.away)
  const row = (active.get(m.id) ?? [])[0]
  const pred = row ? derivePrediction({ match: m, row }) : null
  const goals = events.filter(e => e.type === 'goal')
  const tele = deriveTelemetry({ match: m, home, away, events, pred })

  // 2 — the event feed must tally to the final score, or every downstream
  // panel (timeline, momentum, DNA) is narrating a different match.
  if (events.length) {
    const hg = goals.filter(g => g.team === m.home).length
    const ag = goals.filter(g => g.team === m.away).length
    check(`${m.id}: event goals tally to the final score`,
      hg === m.score.home && ag === m.score.away,
      `events ${hg}-${ag} vs score ${m.score.home}-${m.score.away}`)
  }

  // 3 — tactical insights: recompute every number the copy asserts.
  const insights = buildInsights({ match: m, home, away, events, pred, tele })
  for (const line of insights) {
    const pcClaim = line.match(/^(\d+) of (\d+) goals came from penalty corners/)
    if (pcClaim) {
      const pcGoals = goals.filter(g => g.via === 'PC').length
      check(`${m.id}: PC-goal count in insight matches events`,
        Number(pcClaim[1]) === pcGoals && Number(pcClaim[2]) === goals.length, line)
      check(`${m.id}: "decided" claimed only when corners scored the majority`,
        line.includes('decided') ? pcGoals * 2 > goals.length : pcGoals * 2 <= goals.length, line)
    }
    const q4Claim = line.match(/^(\d+) fourth-quarter goal/)
    if (q4Claim) {
      check(`${m.id}: fourth-quarter goal count matches events`,
        Number(q4Claim[1]) === goals.filter(g => g.minute >= 45).length, line)
    }
    const battle = line.match(/corner battle (\d+)-(\d+)/)
    if (battle && m.penalty_corners?.home != null) {
      const { home: ph, away: pa } = m.penalty_corners
      check(`${m.id}: corner-battle numbers match the fixture`,
        Number(battle[1]) === Math.max(ph, pa) && Number(battle[2]) === Math.min(ph, pa), line)
    }
  }

  // 4 — key drivers: rank claims match the rankings tab; any named set-piece
  // player must actually have a tournament PC goal for the picked side.
  if (pred?.status === 'ready') {
    const drivers = buildDrivers({ match: m, home, away, pred, allEvents })
    for (const d of drivers) {
      const rankClaim = d.text.match(/FIH #(\d+) vs #(\d+)/)
      if (rankClaim) {
        const stated = [Number(rankClaim[1]), Number(rankClaim[2])].sort((x, y) => x - y)
        const real = [home?.fihRank, away?.fihRank].sort((x, y) => x - y)
        check(`${m.id}: driver rank claim matches teams.json`,
          stated[0] === real[0] && stated[1] === real[1], d.text)
      }
      if (d.title === 'Set-piece threat') {
        const pickCode = pred.pick === 'HOME' ? m.home : m.away
        const name = d.text.split(' has ')[0]
        const scored = allEvents.some(e =>
          e.team === pickCode && e.type === 'goal' && e.via === 'PC' && e.player === name)
        check(`${m.id}: set-piece driver names a real tournament PC scorer`, scored, d.text)
      }
    }
  }

  // 5 — momentum timeline: full-match domain, mirrored bounds.
  const momentum = buildMomentumSeries({ match: m, events })
  if (events.length) {
    check(`${m.id}: momentum series spans the full 60 minutes`,
      momentum.length === 61, `len ${momentum.length}`)
    check(`${m.id}: momentum values stay in the mirrored band`,
      momentum.every(p => p.home >= 0 && p.home <= 100 && p.away <= 0 && p.away >= -100))
  } else {
    check(`${m.id}: no events -> no synthetic momentum curve`, momentum.length === 0)
  }

  // 6 — win-probability evolution: anchored at the frozen triple, and a
  // decided match must end certain.
  if (pred?.status === 'ready') {
    const probs = buildProbSeries({ match: m, events, pred })
    if (probs.length) {
      const anchor = probs[0]
      check(`${m.id}: prob series anchored at the published triple`,
        anchor.home === Math.round(pred.reg.home * 100)
          && anchor.draw === Math.round(pred.reg.draw * 100)
          && anchor.away === Math.round(pred.reg.away * 100),
        JSON.stringify(anchor))
      const last = probs[probs.length - 1]
      check(`${m.id}: prob series runs to full-time`, last.min === 60, `ends ${last.min}'`)
      if (events.length && m.score.home !== m.score.away) {
        const winner = m.score.home > m.score.away ? 'home' : 'away'
        check(`${m.id}: a decided match ends at certainty for the winner`,
          last[winner] === 100, JSON.stringify(last))
      }
    }
  }

  // 7 — comeback card: a finished match tracks nothing.
  const cb = deriveComeback({ match: m, tele, home, away })
  check(`${m.id}: comeback card closed at full-time`, cb.headline === 'Full-time', cb.headline)
}

// 8 — synthetic: a live match with a running score but no event feed yet
// (events land at full-time) must not chart a 0-0. The reported bug: NED 3-1
// IND at 60' rendered as "Draw 100%".
{
  const live = {
    id: 'SYN-LIVE', home: 'AAA', away: 'BBB', status: 'live',
    score: { home: 3, away: 1 }, kickoffUtc: Date.now() - 100 * 60000,
  }
  const pred = { status: 'ready', reg: { home: 0.5, draw: 0.3, away: 0.2 } }
  const s = buildProbSeries({ match: live, events: [], pred })
  check('live score without events: two honest points, never a 0-0 curve',
    s.length === 2, JSON.stringify(s))
  check('live score without events: the leader leads the chart, never Draw 100%',
    s.length === 2 && s[1].home > s[1].draw && s[1].home > s[1].away, JSON.stringify(s[1]))
}

console.log(failed
  ? `${failed} intelligence-consistency check(s) FAILED across ${completed.length} completed matches`
  : `All intelligence-consistency checks passed across ${completed.length} completed matches (and the prediction ledger holds one active pick per fixture).`)
process.exit(failed ? 1 : 0)
