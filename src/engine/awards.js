// Hockey.AI — live award leaders.
//
// The Hall of Fame holds Oracle's pre-tournament picks, frozen: they are a
// ledger and are never rewritten. What was missing is the other half — who is
// actually leading each award right now — so the page sat unchanged for the
// whole tournament while the matches it describes were being played.
//
// Everything below is recomputed from the match record on every render. None
// of it is an FIH award: the FIH announces those after the Gold Final, and
// `winner` stays null until the pipeline fills it in. These are Hockey.AI's
// standings for the same categories, and every surface that shows them says so.

import { formatProbability } from './probability.js'

/**
 * Cards weighted by severity, per match played — lower is cleaner.
 *
 * Hockey's three cards are three different sanctions: green is a two-minute
 * suspension, yellow at least five, red is the rest of the match. The weights
 * follow that, and this is the only place they are written down — the Fair
 * Play board and the fair-play award once disagreed about what a card costs
 * and about whether a green counted at all.
 */
export const CARD_WEIGHT = { green: 1, yellow: 2, red: 5 }

/** Discipline points for one player, from the card counts on their record. */
export function disciplinePoints(p) {
  return (p.green_cards ?? 0) * CARD_WEIGHT.green
    + (p.yellow_cards ?? 0) * CARD_WEIGHT.yellow
    + (p.red_cards ?? 0) * CARD_WEIGHT.red
}

/** The same weighting applied to a single card event. */
export function cardPoints(eventType) {
  return eventType === 'green_card' ? CARD_WEIGHT.green
    : eventType === 'yellow_card' ? CARD_WEIGHT.yellow
    : eventType === 'red_card' ? CARD_WEIGHT.red
    : 0
}

/** FIH junior eligibility is an age cut. Age on the day the tournament opened. */
export const JUNIOR_MAX_AGE = 21

function parseDob(dob) {
  // Entry lists print "15 Aug 2001".
  const t = dob ? Date.parse(dob) : NaN
  return Number.isNaN(t) ? null : new Date(t)
}

export function ageOn(dob, onDate) {
  const d = parseDob(dob)
  if (!d || !onDate) return null
  let age = onDate.getUTCFullYear() - d.getUTCFullYear()
  const before =
    onDate.getUTCMonth() < d.getUTCMonth() ||
    (onDate.getUTCMonth() === d.getUTCMonth() && onDate.getUTCDate() < d.getUTCDate())
  return before ? age - 1 : age
}

function played(matches) {
  return (matches ?? []).filter(m => m.status === 'completed' && m.score
    && m.score.home != null && m.score.away != null)
}

/** Per-team goals for/against and cards, from the completed matches only. */
export function teamLedger(matches, players) {
  const rows = new Map()
  const row = code => {
    if (!rows.has(code)) rows.set(code, { code, mp: 0, gf: 0, ga: 0, cards: 0, cardPoints: 0 })
    return rows.get(code)
  }
  for (const m of played(matches)) {
    for (const [side, opp] of [['home', 'away'], ['away', 'home']]) {
      const r = row(m[side])
      r.mp += 1
      r.gf += m.score[side]
      r.ga += m.score[opp]
    }
  }
  for (const p of players ?? []) {
    const r = rows.get(p.team)
    if (!r) continue
    r.cards += (p.green_cards ?? 0) + (p.yellow_cards ?? 0) + (p.red_cards ?? 0)
    r.cardPoints += disciplinePoints(p)
  }
  return rows
}

const byDesc = key => (a, b) => (b[key] ?? 0) - (a[key] ?? 0) || a.name.localeCompare(b.name)

/**
 * Who leads each award category on the current record.
 *
 * Returns one entry per award key, each either
 *   {status: 'leading', player|team, stat, chasers}   — someone leads it, or
 *   {status: 'no-record'}                             — nothing to rank yet.
 * `potmRanked` is the full Player of the Tournament race, already ordered, so
 * the page and the race table cannot disagree about who is top.
 */
export function liveAwardLeaders({ players, matches, potmRanked, tournamentStart }) {
  const done = played(matches)
  const ledger = teamLedger(matches, players)
  const out = {}
  const none = { status: 'no-record' }

  if (!done.length || !(players ?? []).length) {
    return { best_player: none, top_scorer: none, best_goalkeeper: none,
             rising_star: none, fair_play: none, matchesGraded: done.length }
  }

  // Player of the Tournament — the race leader, from the same ordering the
  // race table renders, so the two can never disagree.
  const top = (potmRanked ?? [])[0]
  out.best_player = top
    ? { status: 'leading', player: top, stat: `${formatProbability(top.prob)} of the race`,
        chasers: (potmRanked ?? []).slice(1, 3) }
    : none

  // Top scorer — goals, ties kept visible rather than broken arbitrarily.
  const scorers = players.filter(p => (p.goals ?? 0) > 0).sort(byDesc('goals'))
  const topGoals = scorers[0]?.goals ?? 0
  const tied = scorers.filter(p => p.goals === topGoals)
  out.top_scorer = scorers.length
    ? { status: 'leading', player: scorers[0], tied: tied.length > 1 ? tied : null,
        stat: `${topGoals} goal${topGoals === 1 ? '' : 's'}`
          + (scorers[0].pc_scored ? ` · ${scorers[0].pc_scored} from penalty corners` : ''),
        chasers: scorers.filter(p => p.goals < topGoals).slice(0, 2) }
    : none

  // Best goalkeeper — the record carries no save counts, so this is the goals
  // conceded per match by the keeper's team, which is the number it can
  // actually support. Keepers share a team, so the tie-break is the Hockey.AI
  // index; a team's second keeper never outranks its first on the same figure.
  const keepers = players
    .filter(p => p.position === 'Goalkeeper' && (ledger.get(p.team)?.mp ?? 0) > 0)
    .map(p => {
      const r = ledger.get(p.team)
      return { ...p, gaPerMatch: r.ga / r.mp, cleanSheets: cleanSheetsFor(done, p.team) }
    })
    .sort((a, b) => a.gaPerMatch - b.gaPerMatch
      || (b.ai_rating ?? 0) - (a.ai_rating ?? 0)
      || a.name.localeCompare(b.name))
  out.best_goalkeeper = keepers.length
    ? { status: 'leading', player: keepers[0],
        stat: `${keepers[0].gaPerMatch.toFixed(2)} conceded per match`
          + (keepers[0].cleanSheets ? ` · ${keepers[0].cleanSheets} clean sheet${keepers[0].cleanSheets === 1 ? '' : 's'}` : ''),
        chasers: keepers.slice(1, 3) }
    : none

  // Best junior — age is on the entry list, so eligibility is a fact; the
  // ranking between eligible players is the Hockey.AI index.
  const start = tournamentStart ? new Date(`${tournamentStart}T00:00:00Z`) : null
  const juniors = players
    .map(p => ({ ...p, age: ageOn(p.dob, start) }))
    .filter(p => p.age != null && p.age <= JUNIOR_MAX_AGE && p.ai_rating != null)
    .sort((a, b) => (b.ai_rating ?? 0) - (a.ai_rating ?? 0) || a.name.localeCompare(b.name))
  out.rising_star = juniors.length
    ? { status: 'leading', player: juniors[0],
        stat: `${juniors[0].age} years old · index ${juniors[0].ai_rating}`
          + (juniors[0].goals ? ` · ${juniors[0].goals} goal${juniors[0].goals === 1 ? '' : 's'}` : ''),
        chasers: juniors.slice(1, 3) }
    : none

  // Fair play — a team award, so it is scored per match played: a side that
  // has played six matches is not punished for having been on the pitch
  // longer than one that played four.
  const teams = [...ledger.values()]
    .filter(r => r.mp > 0)
    .map(r => ({ ...r, perMatch: r.cardPoints / r.mp }))
    .sort((a, b) => a.perMatch - b.perMatch || a.code.localeCompare(b.code))
  out.fair_play = teams.length
    ? { status: 'leading', team: teams[0],
        stat: `${teams[0].cards} card${teams[0].cards === 1 ? '' : 's'} in ${teams[0].mp} match${teams[0].mp === 1 ? '' : 'es'}`,
        chasers: teams.slice(1, 3) }
    : none

  out.matchesGraded = done.length
  return out
}

function cleanSheetsFor(done, code) {
  return done.filter(m =>
    (m.home === code && m.score.away === 0) || (m.away === code && m.score.home === 0)).length
}
