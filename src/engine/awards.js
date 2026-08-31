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

// The naming rules live in one module, read by this file and by
// engine/awardsOfficial.js. The two import each other — awardRules borrows the
// age, card and ledger helpers from here — which ES modules resolve because
// every binding on both sides is a hoisted function used only at call time.
// scripts/test_award_rules.mjs imports both to prove it.
import * as rules from './awardRules.js'
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

  // Player of the Tournament — Player Index and goals, equally weighted, from
  // engine/awardRules.js. It used to be the race leader instead, which meant
  // this function and the awards page named different players for the same
  // award; there is one rule now and both read it. `potmRanked` is still
  // accepted so the race table can be rendered alongside, but it no longer
  // decides who is named.
  const potm = rules.playerOfTournament(players)
  out.best_player = potm.length
    ? { status: 'leading', player: potm[0].player,
        stat: `index ${potm[0].parts.index} · ${potm[0].parts.goals} goal`
          + `${potm[0].parts.goals === 1 ? '' : 's'}`,
        chasers: potm.slice(1, 3).map(r => r.player) }
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

  // Best goalkeeper — Player Index, clean sheets and goals conceded per match,
  // equally weighted, from engine/awardRules.js. It used to be conceded-per-
  // match alone with the index only as a tie-break, which is a different award
  // from the one the page named.
  const gks = rules.bestGoalkeeper(players, matches)
  out.best_goalkeeper = gks.length
    ? { status: 'leading', player: gks[0].player,
        stat: `${gks[0].parts.gaPerMatch.toFixed(2)} conceded per match`
          + (gks[0].parts.cleanSheets
              ? ` · ${gks[0].parts.cleanSheets} clean sheet${gks[0].parts.cleanSheets === 1 ? '' : 's'}`
              : '')
          + ` · index ${gks[0].parts.index}`,
        chasers: gks.slice(1, 3).map(r => r.player) }
    : none

  // Best young player — highest Player Index among players UNDER 21, from
  // engine/awardRules.js. The bound used to be 21 inclusive here.
  const start = tournamentStart ? new Date(`${tournamentStart}T00:00:00Z`) : null
  const juniors = rules.risingStar(players, start)
  out.rising_star = juniors.length
    ? { status: 'leading', player: juniors[0].player,
        stat: `${juniors[0].parts.age} years old · index ${juniors[0].parts.index}`
          + (juniors[0].player.goals ? ` · ${juniors[0].player.goals} goal${juniors[0].player.goals === 1 ? '' : 's'}` : ''),
        chasers: juniors.slice(1, 3).map(r => r.player) }
    : none

  // Fair play — fewest card points per match played, from awardRules.js.
  const clean = rules.fairPlay(matches, players)
  out.fair_play = clean.length
    ? { status: 'leading', team: clean[0].team,
        stat: `${clean[0].parts.cards} card${clean[0].parts.cards === 1 ? '' : 's'} `
          + `in ${clean[0].parts.mp} match${clean[0].parts.mp === 1 ? '' : 'es'}`,
        chasers: clean.slice(1, 3).map(r => r.team) }
    : none

  out.matchesGraded = done.length
  return out
}

function cleanSheetsFor(done, code) {
  return done.filter(m =>
    (m.home === code && m.score.away === 0) || (m.away === code && m.score.home === 0)).length
}
