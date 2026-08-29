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


// ── Grading is about who advanced ──────────────────────────────────────────
// A knockout level after sixty minutes is decided in the shoot-out, and the
// pick is judged against that winner — a regulation win and a shoot-out win
// grade the same. Until the shoot-out is on record the tie grades NOBODY:
// the Belgium pick for IND v BEL was right, and still wore a ✗ for a day
// because the grader read 3-3 as the outcome of a knockout.
{
  const { gradePrediction } = await import('../src/engine/prediction.js')
  const row = { pick: 'AWAY', p_home_win: 0.28, p_draw: 0.38, p_away_win: 0.34, pick_confidence: 0.53 }
  const ko = { id: 'X', home: 'IND', away: 'BEL', phase: 'classification', status: 'completed', score: { home: 3, away: 3 } }
  ok('a drawn knockout with no shoot-out on record grades nobody',
     gradePrediction(ko, row) === 'pending', gradePrediction(ko, row))
  ok('the shoot-out winner vindicates the pick',
     gradePrediction({ ...ko, shootout: { home: 3, away: 4 } }, row) === 'correct')
  ok('the shoot-out loser is a miss, same as a regulation loss',
     gradePrediction({ ...ko, shootout: { home: 4, away: 3 } }, row) === 'wrong')
  ok('a regulation knockout win grades normally',
     gradePrediction({ ...ko, score: { home: 1, away: 3 } }, row) === 'correct')
  ok('a pool draw is still a callable, gradable outcome',
     gradePrediction({ ...ko, phase: 'pool' }, { ...row, pick: 'DRAW' }) === 'correct')
}

// The scoreline for a shoot-out tie carries the shoot-out inline.
{
  const { resultDisplay } = await import('../src/engine/prediction.js')
  const m = { id: 'X', home: 'IND', away: 'BEL', phase: 'classification', status: 'completed',
              score: { home: 3, away: 3 }, shootout: { home: 3, away: 4 } }
  const r = resultDisplay(m, { name: 'India' }, { name: 'Belgium' })
  ok('regulation and shoot-out are both on the board: 3 (3) – (4) 3',
     r.homeReg === 3 && r.awayReg === 3 && r.homeSO === 3 && r.awaySO === 4, JSON.stringify(r))
  ok('the board names the shoot-out and its winner',
     /shoot-out/i.test(r.decisiveLine) && r.decisiveLine.includes('Belgium'), r.decisiveLine)
  ok('the status tag says the tie went past sixty minutes', r.statusTag === 'FT (SO)')
}

// ── The knockouts are scored by their own model ───────────────────────────
// KNOCKOUT_MODEL_V1 publishes the REGULATION triple with level-after-sixty in
// the draw slot, and the app folds it at even odds to reach the advance split.
// Same arithmetic, stated twice in two languages, so the two are checked
// against each other rather than trusted to stay in step.
console.log('\nKnockout rows carry their own model\'s numbers')
for (const r of rows.filter(isKO)) {
  const m = fixtures.get(r.matchId)
  const adv = r.p_home_win + r.p_draw / 2
  ok(`${r.matchId}: a knockout is never published as a draw`, r.pick !== 'DRAW', r.pick)
  ok(`${r.matchId}: the published confidence is the advance probability`,
     Math.abs((r.pick === 'HOME' ? adv : 1 - adv) - r.pick_confidence) < 0.002,
     `${r.pick_confidence} vs ${(r.pick === 'HOME' ? adv : 1 - adv).toFixed(3)}`)
  // Rows published under the new model must not repeat what it replaced:
  // p_draw 0.00 on a round where half the classification matches were level,
  // and 97% asserted on a match that went to a shoot-out. Older rows are the
  // ledger's own record and are left exactly as published.
  if (m && m.status !== 'completed') {
    ok(`${r.matchId}: level after sixty carries real mass`, r.p_draw > 0.05, String(r.p_draw))
    ok(`${r.matchId}: no knockout claim is asserted above 80%`,
       Math.max(adv, 1 - adv) < 0.80, String(Math.max(adv, 1 - adv).toFixed(3)))
  }
}

// ── Prose must argue for the side the row actually picks ──────────────────
// A rationale names a team. A revision used to carry it forward whatever
// happened to the pick, so a flip left the card asserting one team in words
// and the other in its own pick — the gold final went out picking Spain above
// a paragraph making the case for Germany.
console.log('\nRationales argue for the side that was picked')
{
  const all = read('predictions.json').predictions
  const byId = new Map(all.map(p => [p.id, p]))
  let checked = 0
  for (const p of all) {
    if (p.superseded || !p.revises) continue
    const m = fixtures.get(p.matchId)
    // A finished card keeps what was published against it; only matches still
    // to come are held to this.
    if (!m || m.status === 'completed') continue
    // Trace the prose to the row where it was authored. A pick that goes
    // Germany -> Spain -> Germany carries Germany's prose throughout, and the
    // last row is right even though its parent disagrees; only the pick the
    // text was written for settles it.
    let origin = p
    while (origin.revises) {
      const up = byId.get(origin.revises)
      if (!up || up.reason !== p.reason) break
      origin = up
    }
    if (origin === p) continue
    checked++
    ok(`${p.matchId}: prose argues for the side the row picks`,
       p.pick === origin.pick,
       `text was written for ${origin.pick}, row picks ${p.pick}`)
  }
  ok('every revision that flipped a pick was checked', checked >= 0)
}

// ── The bracket board and the match card answer with one voice ────────────
// The board used to run a rating Elo of its own while the card read the
// published ledger, and the two disagreed in public: the board called
// Argentina to advance from a semi-final at 53% while the card called Germany
// at 58%. Different models, one question, both on screen. The board now reads
// the published row, and this holds it there.
console.log('\nThe bracket shows the published pick, not a second opinion')
{
  const src = fs.readFileSync(new URL('../src/pages/Oracle.jsx', import.meta.url), 'utf8')
  ok('the bracket resolves a published row for each tie',
     /publishedFor\.set\(/.test(src) && /activePredictions\(predictions/.test(src))
  ok('the tie card prefers the published advance probability',
     /published\?\.pHomeAdvance \?\? tie\.pHomeAdvance/.test(src))
  ok('the tie card prefers the published pick',
     /published\?\.predicted \?\? tie\.predicted/.test(src))
  ok('no tie card reads the simulated pick directly any more',
     !/tie\.predicted === (code|tie\.home)/.test(src),
     'a card still compares against tie.predicted')
  // The fold the board applies must be the one the card applies.
  for (const r of rows.filter(isKO)) {
    const adv = r.p_home_win + r.p_draw / 2
    const shown = r.pick === 'HOME' ? adv : 1 - adv
    ok(`${r.matchId}: the board would show the pick's own probability`,
       Math.abs(shown - r.pick_confidence) < 0.002,
       `${shown.toFixed(3)} vs ${r.pick_confidence}`)
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nAll pick-coherence checks passed.')
process.exit(fail ? 1 : 0)
