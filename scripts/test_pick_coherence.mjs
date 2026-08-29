// A published pick, its probabilities and its reason must say the same thing.
//
// The card that prompted this read "India to win" as its headline, "ARG 70%
// Draw 17% IND 13%" as its distribution, and "70%" in the confidence ring —
// three claims, two of which contradicted the pick. The cause was an
// alignment step that moved the distribution to follow the pick only when the
// pick was DRAW, plus a confidence field set to the largest probability in
// the row rather than the probability of the pick.
//
// These checks hold the published ledger to the three things a reader assumes
// without being told:
//
//   1. the pick is the outcome the distribution ranks first — and in a
//      knockout, where nobody goes home on a draw, the outcomes being ranked
//      are the two ways to advance: regulation draw mass falls half to each
//      side through the shoot-out, exactly as the app engine folds it
//      (prediction.js). "Draw ranks first" is not a pickable outcome there.
//   2. the confidence shown is the pick's own probability — for a knockout,
//      the pick's probability OF ADVANCING.
//   3. the distribution is a distribution
//
// and, because a pick is also argued in words, that the named team in
// `pick_team` is the team the pick refers to.
import fs from 'node:fs'

const read = p => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'))
const fixtures = new Map(read('fixtures.json').matches.map(m => [m.id, m]))
const rows = read('predictions.json').predictions.filter(p => !p.superseded)

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }
const KEY = { HOME: 'p_home_win', DRAW: 'p_draw', AWAY: 'p_away_win' }

console.log(`Published picks agree with their own numbers (${rows.length} active rows)`)

const probsOf = r => ({ HOME: r.p_home_win, DRAW: r.p_draw, AWAY: r.p_away_win })
const scored = rows.filter(r => Object.values(probsOf(r)).every(v => typeof v === 'number'))
ok('every active row carries a full distribution', scored.length === rows.length,
   rows.filter(r => !scored.includes(r)).map(r => r.matchId).join(', '))

const KO_PHASES = new Set(['semi-final', 'bronze-final', 'gold-final', 'classification'])
const isKO = r => KO_PHASES.has(fixtures.get(r.matchId)?.phase)
// A knockout row published before the regulation-honest model carries a flat
// two-way split (p_draw 0); the fold is then the identity, so one rule covers
// both eras of the ledger.
const advOf = r => ({ HOME: r.p_home_win + r.p_draw / 2, AWAY: r.p_away_win + r.p_draw / 2 })

const disagree = scored.filter(r => {
  if (isKO(r)) {
    const a = advOf(r)
    return r.pick !== (a.HOME >= a.AWAY ? 'HOME' : 'AWAY')
  }
  const p = probsOf(r)
  const top = Object.keys(p).reduce((a, b) => (p[b] > p[a] ? b : a))
  return r.pick !== top
})
ok('the pick is the outcome its own distribution ranks first', disagree.length === 0,
   disagree.map(r => `${r.matchId}: pick ${r.pick} but ${JSON.stringify(probsOf(r))}`).join(' | '))

const wrongConf = scored.filter(r => {
  if (r.pick_confidence == null) return false
  const want = isKO(r) ? advOf(r)[r.pick] : probsOf(r)[r.pick]
  return Math.abs(r.pick_confidence - want) > 0.0015
})
ok('the confidence shown is the probability of the pick', wrongConf.length === 0,
   wrongConf.map(r => `${r.matchId}: shows ${r.pick_confidence}`).join(' | '))

const badSum = scored.filter(r => {
  const s = r.p_home_win + r.p_draw + r.p_away_win
  return Math.abs(s - 1) > 0.01
})
ok('each distribution sums to one', badSum.length === 0,
   badSum.map(r => `${r.matchId}: ${(r.p_home_win + r.p_draw + r.p_away_win).toFixed(3)}`).join(' | '))

const badRange = scored.filter(r => Object.values(probsOf(r)).some(v => v < 0 || v > 1))
ok('no probability sits outside 0…1', badRange.length === 0, badRange.map(r => r.matchId).join(', '))

// pick_team is what the prose and the cards name, so it has to be the side the
// pick actually refers to — and empty for a draw, which names nobody.
const namedWrong = scored.filter(r => {
  const m = fixtures.get(r.matchId)
  if (!m || m.home === 'TBD' || m.away === 'TBD') return false
  const want = r.pick === 'HOME' ? m.home : r.pick === 'AWAY' ? m.away : null
  return (r.pick_team ?? null) !== want
})
ok('pick_team names the side the pick refers to', namedWrong.length === 0,
   namedWrong.map(r => {
     const m = fixtures.get(r.matchId)
     return `${r.matchId}: pick ${r.pick} in ${m.home}-${m.away} but pick_team=${r.pick_team}`
   }).join(' | '))

ok('every active row has exactly one pick per match',
   new Set(rows.map(r => r.matchId)).size === rows.length,
   'duplicate active rows for a match')

console.log(fail ? `\n${fail} FAILED` : '\nAll pick-coherence checks passed.')
process.exit(fail ? 1 : 0)
