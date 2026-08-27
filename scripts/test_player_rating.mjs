// Hockey.AI — the positional rating must be readable and honest.
import { readFileSync } from 'node:fs'
const PLAYERS = JSON.parse(readFileSync(new URL('../public/data/players.json', import.meta.url))).players

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const rated = PLAYERS.filter(p => p.ai_rating != null)
console.log(`Positional rating (${rated.length} rated of ${PLAYERS.length})`)

// The line is not the group. The FIH names a position for 48 of 320 entrants
// and marks the rest "Squad", so `position_effective` is null for a player
// whose line the record cannot derive — and that used to mean no rating at
// all for 186 travelling players, 119 of whom started matches. They are rated
// in the Outfield group instead, and every rating says which group it was
// measured against.
check('every rated player says what group he was rated against',
  rated.every(p => p.rating_group),
  rated.filter(p => !p.rating_group).map(p => p.name).join(','))

check('a rating group is one the model defines',
  rated.every(p => ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Outfield']
    .includes(p.rating_group)))

check('a player with a line is rated against that line',
  rated.every(p => !p.position_effective || p.rating_group === p.position_effective),
  rated.filter(p => p.position_effective && p.rating_group !== p.position_effective)
    .map(p => `${p.name}:${p.position_effective}/${p.rating_group}`).slice(0, 3).join(','))

// The defect this whole rebuild exists for: everyone who took the field is
// evaluated. A rating that covers only the goalscorers is a scoring table.
const played = p => (p.appearances ?? 0) > 0
check('every travelling player who took the field carries a rating',
  PLAYERS.filter(p => p.on_team_list !== false && played(p)).every(p => p.ai_rating != null),
  PLAYERS.filter(p => p.on_team_list !== false && played(p) && p.ai_rating == null)
    .map(p => p.name).slice(0, 5).join(','))

check('every rated player carries the components behind the number',
  rated.every(p => p.rating_components && Object.keys(p.rating_components).length > 0),
  rated.filter(p => !Object.keys(p.rating_components ?? {}).length).map(p => p.name).join(','))

check('an unrated player carries no stale breakdown',
  PLAYERS.filter(p => p.ai_rating == null)
    .every(p => !p.rating_components && p.rating_coverage == null))

check('component weights sum to one',
  rated.every(p => {
    const w = Object.values(p.rating_components).reduce((s, c) => s + c.weight, 0)
    return Math.abs(w - 1) < 0.02
  }),
  rated.filter(p => Math.abs(Object.values(p.rating_components).reduce((s, c) => s + c.weight, 0) - 1) >= 0.02)
    .slice(0, 3).map(p => p.name).join(','))

check('every component score is a percentile in range',
  rated.every(p => Object.values(p.rating_components).every(c => c.score >= 0 && c.score <= 100)))

// Performance is bounded 40-99; the two multipliers below can each only
// shrink it, never grow it, so the rating's own floor is that scale times
// both multipliers' own floors — not 40, once either one has bitten.
const PLAYING_TIME_FLOOR = 0.45
const CONTEXT_FLOOR = 0.88
check('every rating sits inside its scale',
  rated.every(p => p.ai_rating >= 40 * PLAYING_TIME_FLOOR * CONTEXT_FLOOR - 0.15 && p.ai_rating <= 99),
  rated.filter(p => p.ai_rating < 40 * PLAYING_TIME_FLOOR * CONTEXT_FLOOR - 0.15 || p.ai_rating > 99)
    .slice(0, 3).map(p => `${p.name} ${p.ai_rating}`).join(','))

// The published rating is the performance the components add up to, times the
// standard it was produced against. Both halves are published, so both are
// checked: a rating that cannot be reconstructed from what is printed beside
// it is a number the reader is being asked to take on trust.
check('the performance is the weighted sum of its own components',
  rated.every(p => {
    const pct = Object.values(p.rating_components).reduce((s, c) => s + c.weight * c.score, 0)
    return Math.abs((40 + (99 - 40) * pct / 100) - p.rating_performance) < 0.15
  }),
  rated.filter(p => {
    const pct = Object.values(p.rating_components).reduce((s, c) => s + c.weight * c.score, 0)
    return Math.abs((40 + (99 - 40) * pct / 100) - p.rating_performance) >= 0.15
  }).slice(0, 3).map(p => `${p.name} ${p.rating_performance}`).join(','))

check('the rating is the performance times context times playing time',
  rated.every(p => {
    const ctx = p.rating_context ? p.rating_context.factor : 1
    const pt = p.rating_playing_time ? p.rating_playing_time.factor : 1
    return Math.abs(p.rating_performance * ctx * pt - p.ai_rating) < 0.15
  }),
  rated.filter(p => {
    const ctx = p.rating_context ? p.rating_context.factor : 1
    const pt = p.rating_playing_time ? p.rating_playing_time.factor : 1
    return Math.abs(p.rating_performance * ctx * pt - p.ai_rating) >= 0.15
  }).slice(0, 3).map(p => `${p.name} ${p.rating_performance}x${p.rating_context?.factor}x${p.rating_playing_time?.factor}!=${p.ai_rating}`).join(','))

// Context is bounded on purpose. It was tried as a weighted component and the
// engine's redistribution of unfed components inflated a declared 12% into
// 37.5% of a midfielder's rating, filling the XI with players whose countries
// had won matches. A multiplier cannot grow like that, and the floor says
// exactly how much it is allowed to matter.
check('the match context never leaves its bounds',
  rated.every(p => !p.rating_context ||
    (p.rating_context.factor >= CONTEXT_FLOOR && p.rating_context.factor <= 1)),
  rated.filter(p => p.rating_context &&
    (p.rating_context.factor < CONTEXT_FLOOR || p.rating_context.factor > 1))
    .slice(0, 3).map(p => `${p.name} ${p.rating_context.factor}`).join(','))

// Playing time is bounded the same way, on a lower floor: how much of the
// tournament a player actually took part in is a fact about him, not an
// indirect signal like his side's results, and it was chosen to move a
// rating harder — a zero-start substitute's four bench goals used to rate
// 6th of 31 forwards; this is the multiplier that stopped it.
check('the playing-time factor never leaves its bounds',
  rated.every(p => !p.rating_playing_time ||
    (p.rating_playing_time.factor >= PLAYING_TIME_FLOOR && p.rating_playing_time.factor <= 1)),
  rated.filter(p => p.rating_playing_time &&
    (p.rating_playing_time.factor < PLAYING_TIME_FLOOR || p.rating_playing_time.factor > 1))
    .slice(0, 3).map(p => `${p.name} ${p.rating_playing_time.factor}`).join(','))

check('neither multiplier ever outranks the performance',
  rated.every(p => p.ai_rating <= p.rating_performance + 0.05))

check('match context and playing time are never also weighted components',
  rated.every(p => !Object.keys(p.rating_components).includes('match_context') &&
    !Object.keys(p.rating_components).includes('workload')))

check('every rating declares how much of its model it stands on',
  rated.every(p => p.rating_coverage > 0 && p.rating_coverage <= 1))

check('a component the record cannot feed is declared, not scored',
  rated.every(p => Array.isArray(p.rating_missing)))

check('a missing component never appears in the breakdown',
  rated.every(p => (p.rating_missing ?? []).every(k => !(k in p.rating_components))))

// The distortions the model exists to prevent.
const defenders = rated.filter(p => p.position_effective === 'Defender')
check('a defender is not rated mainly on his goals',
  defenders.every(p =>
    (p.rating_components.set_piece?.weight ?? 0) +
    (p.rating_components.goal_value?.weight ?? 0) <= 0.45),
  defenders.filter(p =>
    (p.rating_components.set_piece?.weight ?? 0) +
    (p.rating_components.goal_value?.weight ?? 0) > 0.45).map(p => p.name).join(','))

// The rebuild's own headline claim, asserted rather than described: no line is
// rated mostly on goals any more. It was 91% for a forward and 74% for a
// midfielder, which is why a substitute who scored outranked a man who started
// every match.
const GOAL_COMPONENTS = ['goal_value', 'finishing', 'set_piece', 'talisman']
for (const g of ['Forward', 'Midfielder', 'Defender']) {
  const rows = rated.filter(p => p.rating_group === g)
  const share = p => GOAL_COMPONENTS.reduce((s, k) => s + (p.rating_components[k]?.weight ?? 0), 0)
  check(`a ${g.toLowerCase()} is not rated mostly on goals`,
    rows.every(p => share(p) <= 0.7),
    rows.filter(p => share(p) > 0.7).slice(0, 2).map(p => `${p.name} ${(share(p) * 100).toFixed(0)}%`).join(','))
}

// Starting is the strongest signal the FIH publishes about a player nobody
// else measures. A rating that ignores it picked three men with one start
// between them for the tournament's best eleven.
const starters = rated.filter(p => (p.starts ?? 0) >= 4)
const cameos = rated.filter(p => (p.starts ?? 0) === 0 && (p.appearances ?? 0) > 0)
check('a full starter outrates the average cameo in the same group',
  ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'].every(g => {
    const s = starters.filter(p => p.rating_group === g)
    const c = cameos.filter(p => p.rating_group === g)
    if (!s.length || !c.length) return true
    const mean = xs => xs.reduce((t, p) => t + p.ai_rating, 0) / xs.length
    return mean(s) > mean(c)
  }))

// The regression this whole rebuild guards against, named: a substitute who
// never started could still out-rate the group he was compared to, because
// the components that measure output know nothing about how little of the
// tournament produced it. James Hickson (NZL, 0 starts, 4 goals) rated 6th of
// 31 forwards under the old model; Will Calnan (ENG, 0 starts, 2 goals from
// three cameos) had the best goal value of any top-eight midfielder. Neither
// should sit in the upper half of a group of players who mostly started.
for (const [name, group] of [['James Hickson', 'Forward'], ['Will Calnan', 'Midfielder']]) {
  const p = rated.find(x => x.name === name)
  if (!p) continue
  const peers = rated.filter(x => x.rating_group === group).sort((a, b) => b.ai_rating - a.ai_rating)
  const rank = peers.findIndex(x => x.name === name) + 1
  check(`${name} does not rank in the upper half of ${peers.length} ${group.toLowerCase()}s`,
    rank > peers.length / 2, `rank ${rank}/${peers.length}, rtg ${p.ai_rating}`)
}

// A keeper is rated on his own record, not his team's. `team_defence` was a
// team property handed to every keeper in a squad alike: Argentina's two both
// carried 71.9, including the one who never took the field, and it was 62.5%
// of the rating.
check('a goalkeeper is rated on the record while he was on the pitch',
  rated.filter(p => p.rating_group === 'Goalkeeper').every(p =>
    'on_pitch_defence' in p.rating_components && !('scoring' in p.rating_components)))

check('no rating reads a team figure as though it were the player’s',
  rated.every(p => !('team_defence' in p.rating_components)))

// Two keepers of one squad shared a rating component and so nearly shared a
// rating. On-pitch record separates them, because one of them played.
const keeperPairs = new Map()
for (const p of rated.filter(p => p.rating_group === 'Goalkeeper')) {
  if (!keeperPairs.has(p.team)) keeperPairs.set(p.team, [])
  keeperPairs.get(p.team).push(p)
}
check('two keepers of one squad are separated by what they actually did',
  [...keeperPairs.values()].every(g => g.length < 2 ||
    new Set(g.map(p => p.rating_components.on_pitch_defence?.score)).size > 1 ||
    new Set(g.map(p => p.starts)).size === 1))

// Two official figures can disagree — the match-page squad table is a
// snapshot stamped "as of" a date and lags, the match sheets are per match.
// The sheets decide, so the check reads what the rating actually used.
check('nobody who never took the field carries a rating',
  rated.every(p => (p.appearances ?? 1) > 0),
  rated.filter(p => p.appearances === 0).map(p => p.name).join(','))

check('a player named on a sheet and never used is not counted as appearing',
  PLAYERS.filter(p => p.starts === 0 && p.appearances === 0)
    .every(p => p.ai_rating == null),
  PLAYERS.filter(p => p.starts === 0 && p.appearances === 0 && p.ai_rating != null)
    .map(p => p.name).join(','))

// Percentiles only mean something within a comparable group.
const groups = new Map()
for (const p of rated) {
  if (!groups.has(p.rating_group)) groups.set(p.rating_group, [])
  groups.get(p.rating_group).push(p)
}
check('each position group shares one component set',
  [...groups.values()].every(g => {
    const keys = g.map(p => Object.keys(p.rating_components).sort().join('|'))
    return new Set(keys).size === 1
  }),
  [...groups].filter(([, g]) => new Set(g.map(p => Object.keys(p.rating_components).sort().join('|'))).size !== 1)
    .map(([k]) => k).join(','))

// The condition that broke it: the FIH's appearance figures are read a squad
// at a time, so mid-refresh some players in a group carry an appearance count
// and others do not. Scoring the first on Availability while renormalising the
// second without it ranks two halves of a position against different models.
check('a component either counts for the whole group or for none of it',
  [...groups].every(([, g]) => {
    const keys = [...new Set(g.flatMap(p => Object.keys(p.rating_components)))]
    return keys.every(k => g.every(p => k in p.rating_components))
  }),
  [...groups].filter(([, g]) => {
    const keys = [...new Set(g.flatMap(p => Object.keys(p.rating_components)))]
    return !keys.every(k => g.every(p => k in p.rating_components))
  }).map(([k]) => k).join(','))

check('each position group spans a real range, not one flat number',
  [...groups.values()].every(g => g.length < 3 || new Set(g.map(p => p.ai_rating)).size > 1))

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll positional-rating checks passed.')
process.exit(failed ? 1 : 0)
