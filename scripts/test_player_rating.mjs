// Hockey.AI — the positional rating must be readable and honest.
import { readFileSync } from 'node:fs'
const PLAYERS = JSON.parse(readFileSync(new URL('../public/data/players.json', import.meta.url))).players

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const rated = PLAYERS.filter(p => p.ai_rating != null)
console.log(`Positional rating (${rated.length} rated of ${PLAYERS.length})`)

check('every rated player has a position to be rated against',
  rated.every(p => p.position_effective),
  rated.filter(p => !p.position_effective).map(p => p.name).join(','))

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

check('every rating sits inside its scale',
  rated.every(p => p.ai_rating >= 40 && p.ai_rating <= 99))

check('the rating is the weighted sum of its own components',
  rated.every(p => {
    const pct = Object.values(p.rating_components).reduce((s, c) => s + c.weight * c.score, 0)
    return Math.abs((40 + (99 - 40) * pct / 100) - p.ai_rating) < 0.15
  }),
  rated.filter(p => {
    const pct = Object.values(p.rating_components).reduce((s, c) => s + c.weight * c.score, 0)
    return Math.abs((40 + (99 - 40) * pct / 100) - p.ai_rating) >= 0.15
  }).slice(0, 3).map(p => `${p.name} ${p.ai_rating}`).join(','))

check('every rating declares how much of its model it stands on',
  rated.every(p => p.rating_coverage > 0 && p.rating_coverage <= 1))

check('a component the record cannot feed is declared, not scored',
  rated.every(p => Array.isArray(p.rating_missing)))

check('a missing component never appears in the breakdown',
  rated.every(p => (p.rating_missing ?? []).every(k => !(k in p.rating_components))))

// The distortions the model exists to prevent.
const defenders = rated.filter(p => p.position_effective === 'Defender')
check('a defender is not rated mainly on his goals',
  defenders.every(p => (p.rating_components.set_piece?.weight ?? 0) <= 0.4),
  defenders.filter(p => (p.rating_components.set_piece?.weight ?? 0) > 0.4).map(p => p.name).join(','))

check('a goalkeeper is rated on goals against, not on scoring',
  rated.filter(p => p.position_effective === 'Goalkeeper')
    .every(p => !('scoring' in p.rating_components) && 'team_defence' in p.rating_components))

check('nobody who never took the field carries a rating',
  rated.every(p => p.games_played == null || p.games_played > 0),
  rated.filter(p => p.games_played === 0).map(p => p.name).join(','))

// Percentiles only mean something within a comparable group.
const groups = new Map()
for (const p of rated) {
  if (!groups.has(p.position_effective)) groups.set(p.position_effective, [])
  groups.get(p.position_effective).push(p)
}
check('each position group shares one component set',
  [...groups.values()].every(g => {
    const keys = g.map(p => Object.keys(p.rating_components).sort().join('|'))
    return new Set(keys).size === 1
  }),
  [...groups].filter(([, g]) => new Set(g.map(p => Object.keys(p.rating_components).sort().join('|'))).size !== 1)
    .map(([k]) => k).join(','))

check('each position group spans a real range, not one flat number',
  [...groups.values()].every(g => g.length < 3 || new Set(g.map(p => p.ai_rating)).size > 1))

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll positional-rating checks passed.')
process.exit(failed ? 1 : 0)
