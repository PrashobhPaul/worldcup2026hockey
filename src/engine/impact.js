// Hockey.AI — how much of a side a player actually is.
//
// The positional rating says how well someone plays the position they play.
// It does not say what a team would lose without them, and those are different
// questions: a forward rated 78 who has scored six of his side's nine goals
// decides more matches than a forward rated 82 who has scored one of thirty.
//
// So every surface that names key players reads the same four measures here,
// each countable from the official record and each stated beside the name:
//
//   rating        the positional rating, and where it ranks in that line
//   share         goals as a percentage of everything the side has scored
//   set piece     penalty-corner goals, the routine a defence must plan for
//   presence      starts out of the matches the side has played
//
// Nothing is blended into one number. A card that says "carries 43% of the
// scoring" has told the reader something; the same fact folded into an impact
// score of 71 has not.
import { isAtTournament, roleOf, positionBoards, LINES } from './bestXI.js'

/** {code: goals scored} across every completed match. */
export function teamGoalTotals(matches) {
  const out = new Map()
  for (const m of matches ?? []) {
    if (m.status !== 'completed' || m.score?.home == null) continue
    out.set(m.home, (out.get(m.home) ?? 0) + m.score.home)
    out.set(m.away, (out.get(m.away) ?? 0) + m.score.away)
  }
  return out
}

/** {code: matches played} across every completed match. */
export function teamMatchCounts(matches) {
  const out = new Map()
  for (const m of matches ?? []) {
    if (m.status !== 'completed' || m.score?.home == null) continue
    out.set(m.home, (out.get(m.home) ?? 0) + 1)
    out.set(m.away, (out.get(m.away) ?? 0) + 1)
  }
  return out
}

/**
 * The context every impact figure is measured against: what each side has
 * scored, how often it has played, and where each player ranks in his line.
 */
export function impactContext(players, matches) {
  const boards = positionBoards(players)
  const rank = new Map()
  for (const line of LINES) {
    for (const row of boards[line.role]) rank.set(row.player.id, row.rank)
  }
  return {
    goals: teamGoalTotals(matches),
    played: teamMatchCounts(matches),
    rank,
    depth: Object.fromEntries(LINES.map(l => [l.role, boards[l.role].length])),
  }
}

const fieldGoals = p =>
  p.fg_scored ?? Math.max(0, (p.goals ?? 0) - (p.pc_scored ?? 0) - (p.ps_scored ?? 0))

/** Everything one surface needs to say why this player matters to his side. */
export function playerImpact(player, ctx) {
  const teamGoals = ctx.goals.get(player.team) ?? 0
  const teamMatches = ctx.played.get(player.team) ?? 0
  const { role, source } = roleOf(player)
  return {
    player,
    role,
    roleSource: source,
    rating: player.ai_rating ?? null,
    roleRank: ctx.rank.get(player.id) ?? null,
    roleDepth: role ? ctx.depth[role] ?? null : null,
    goals: player.goals ?? 0,
    teamGoals,
    // The talisman measure: what fraction of a side's scoring runs through him.
    share: teamGoals ? Math.round(((player.goals ?? 0) / teamGoals) * 100) : null,
    fieldGoals: fieldGoals(player),
    pcGoals: player.pc_scored ?? 0,
    psGoals: player.ps_scored ?? 0,
    starts: player.starts ?? null,
    teamMatches,
    cards: (player.green_cards ?? 0) + (player.yellow_cards ?? 0) + (player.red_cards ?? 0),
  }
}

/**
 * The players who decide a match for one nation.
 *
 * Four questions, each answered by one name and the figure that answers it:
 * who carries the scoring, who is rated highest, who takes the corners, and
 * who is in goal. A player can answer more than one — the same man is often
 * the talisman and the drag flicker — so each slot names the best remaining
 * candidate and the card says which question he answers.
 */
export function teamKeyPlayers(squad, ctx, { limit = 4 } = {}) {
  const list = (squad ?? []).filter(isAtTournament).map(p => playerImpact(p, ctx))
  const best = (rows, cmp) => rows.sort(cmp)[0] ?? null
  const desc = key => (a, b) => (b[key] ?? 0) - (a[key] ?? 0) ||
    a.player.name.localeCompare(b.player.name)

  // Each question is answered on its own merits, and one player may answer
  // several — usually does, because the man who takes the corners is often the
  // man who carries the scoring. Handing each question to a different name
  // instead is what made India's corner threat read as the player with one of
  // them, while the captain with six stood in the next column.
  const keeper = best(
    list.filter(r => r.role === 'Goalkeeper' && r.rating != null),
    // The one a coach actually plays, not the best-rated understudy.
    (a, b) => (b.starts ?? 0) - (a.starts ?? 0) || (b.rating ?? 0) - (a.rating ?? 0) ||
      a.player.name.localeCompare(b.player.name))
  const slots = [
    {
      key: 'talisman',
      label: 'Talisman',
      row: best(list.filter(r => r.goals > 0 && r.share != null), desc('share')),
      stat: r => `${r.goals} of his side's ${r.teamGoals} goals`,
      share: r => r.share,
    },
    {
      key: 'set_piece',
      label: 'Penalty corners',
      row: best(list.filter(r => r.pcGoals > 0), desc('pcGoals')),
      stat: r => `${r.pcGoals} from corners`,
    },
    {
      key: 'rated',
      label: 'Highest rated',
      // Outfield only: the keeper has his own card, and keepers rate high
      // enough to answer this question for almost every side.
      row: best(list.filter(r => r.rating != null && r.role !== 'Goalkeeper'), desc('rating')),
      stat: r => (r.roleRank
        ? `rated ${r.rating}, ${ordinalRank(r.roleRank)} of ${r.roleDepth} ${plural(r.role)}`
        : `rated ${r.rating}`),
    },
    {
      key: 'keeper',
      label: 'Goalkeeper',
      row: keeper,
      stat: r => (r.starts != null && r.teamMatches
        ? `rated ${r.rating}, started ${r.starts} of ${r.teamMatches}`
        : `rated ${r.rating}`),
    },
  ].filter(s => s.row)

  // One card per player, carrying every question he answers.
  const cards = []
  for (const slot of slots) {
    const existing = cards.find(c => c.impact.player.id === slot.row.player.id)
    if (existing) {
      existing.labels.push(slot.label)
      existing.stats.push(slot.stat(slot.row))
      if (slot.share) existing.share = slot.share(slot.row)
      continue
    }
    cards.push({
      key: slot.key,
      labels: [slot.label],
      stats: [slot.stat(slot.row)],
      impact: slot.row,
      share: slot.share ? slot.share(slot.row) : null,
    })
  }
  return cards.slice(0, limit)
}

const ordinalRank = n => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
const plural = role => ({
  Goalkeeper: 'keepers', Defender: 'defenders',
  Midfielder: 'midfielders', Forward: 'forwards',
}[role] ?? 'players')
