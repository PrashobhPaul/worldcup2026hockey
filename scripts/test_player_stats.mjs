// Every player number the app prints must be countable from the match feed.
//
// The Stats tab carried a Top Assists board. FIH does not publish assists for
// this competition and no event in the feed carries one — the nine players on
// that board held a phantom assist each, kept alive by a max() against the
// pre-tournament seed, and three of the four AI-rating formulas were weighting
// them. It is the same fault as the fabricated match stats and the
// penalty-corner attempt counts: a number nobody measured, printed as fact.
//
// So each stat is recomputed here from fixtures.json and compared. A field the
// feed cannot support must be zero everywhere, not merely small.
import fs from 'node:fs'

const read = p => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'))
const matches = read('fixtures.json').matches
const players = read('players.json').players

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }

console.log(`Player stats against the match feed (${players.length} players)`)

const truth = new Map()
const bump = (name, key) => {
  if (!name) return
  const t = truth.get(name) ?? { goals: 0, pc: 0, yellow: 0, red: 0, green: 0 }
  t[key] += 1
  truth.set(name, t)
}
let assistKeys = 0
for (const m of matches) {
  for (const e of m.events ?? []) {
    if (e.assist != null) assistKeys += 1
    if (e.type === 'goal') {
      bump(e.player, 'goals')
      if (String(e.via ?? '').toUpperCase() === 'PC') bump(e.player, 'pc')
    } else if (e.type === 'yellow_card') bump(e.player, 'yellow')
    else if (e.type === 'red_card') bump(e.player, 'red')
    else if (e.type === 'green_card') bump(e.player, 'green')
  }
}

const off = (field, pick) => players.filter(p => {
  const t = truth.get(p.name) ?? { goals: 0, pc: 0, yellow: 0, red: 0, green: 0 }
  return (p[field] ?? 0) !== pick(t)
}).map(p => `${p.name} (${p.team}) ${p[field]} vs ${pick(truth.get(p.name) ?? { goals: 0, pc: 0, yellow: 0, red: 0, green: 0 })}`)

for (const [field, pick] of [
  ['goals', t => t.goals],
  ['pc_scored', t => t.pc],
  ['yellow_cards', t => t.yellow],
  ['red_cards', t => t.red],
  ['green_cards', t => t.green],
]) {
  const bad = off(field, pick)
  ok(`${field} matches the feed for every player`, bad.length === 0, bad.slice(0, 4).join(' | '))
}

// Assists: the feed carries none, so no player may claim one.
ok('the feed carries no assist to count', assistKeys === 0, `${assistKeys} event(s) carry an assist key`)
const claimingAssists = players.filter(p => (p.assists ?? 0) > 0)
ok('no player claims an assist the feed cannot support', claimingAssists.length === 0,
   claimingAssists.slice(0, 6).map(p => `${p.name} (${p.team}) ${p.assists}`).join(', '))

// A rating is a derived opinion, but it must not be built on an unsupported
// stat, and it must stay inside its own scale — widened here below the
// component blend's own 40-99, because two bounded multipliers (match
// context, playing time) can each only shrink a rating, and a player caught
// by both — a losing side's man who barely played — is meant to read low.
const rated = players.filter(p => p.ai_rating != null)
const RATING_FLOOR = 40 * 0.45 * 0.88 // PLAYING_TIME_FLOOR x CONTEXT_FLOOR, player_rating.py
ok('every rating sits inside its scale',
   rated.every(p => p.ai_rating >= RATING_FLOOR - 0.15 && p.ai_rating <= 99),
   rated.filter(p => p.ai_rating < RATING_FLOOR - 0.15 || p.ai_rating > 99)
     .map(p => `${p.name} ${p.ai_rating}`).join(', '))
ok('a rated player has something in the feed or a stated position',
   rated.every(p => truth.has(p.name) || p.position),
   rated.filter(p => !truth.has(p.name) && !p.position).slice(0, 4).map(p => p.name).join(', '))

console.log(fail ? `\n${fail} FAILED` : '\nAll player-stat checks passed.')
process.exit(fail ? 1 : 0)
