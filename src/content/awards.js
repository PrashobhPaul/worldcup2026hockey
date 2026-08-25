// Hockey.AI — frozen awards content
// Soccer.AI keeps its Hall of Fame in an operator table; the hockey edition
// freezes the same content in the repository, versioned in git. Oracle picks
// below were locked before the tournament; `winner` stays null until the FIH
// announces the official awards after the Gold Final (30 Aug), when the data
// pipeline fills them in and the page grades each pick publicly.

export const AWARDS_STATE = 'speculated' // speculated | official | frozen

export const HOF_AWARDS = [
  {
    key: 'best_player',
    section: 'The Sticks',
    label: 'Player of the Tournament',
    ringTone: 'gold',
    oraclePick: 'Harmanpreet Singh',
    oraclePickTeam: 'IND',
    statLine: 'World drag-flick No.1 · 42% PC conversion · India captain',
    reason: 'The premium set-piece weapon in world hockey. If India go deep, this is his trophy to lose.',
    winner: null, winnerTeam: null, grade: 'not_graded',
  },
  {
    key: 'top_scorer',
    section: 'The Sticks',
    label: 'Top Scorer',
    ringTone: 'gold',
    oraclePick: 'Blake Govers',
    oraclePickTeam: 'AUS',
    statLine: 'Australia spearhead · elite PC battery + open-play finishing',
    reason: 'Australia are ranked #1 and project the most goals — their first-choice flicker leads the scoring race.',
    winner: null, winnerTeam: null, grade: 'not_graded',
  },
  {
    key: 'best_goalkeeper',
    section: 'The Glove',
    label: 'Best Goalkeeper',
    ringTone: 'silver',
    oraclePick: 'Vincent Vanasch',
    oraclePickTeam: 'BEL',
    statLine: 'Three-time FIH Goalkeeper of the Year · shootout specialist',
    reason: 'The best big-moment keeper of his generation, on a Belgium side built to reach the medal rounds.',
    winner: null, winnerTeam: null, grade: 'not_graded',
  },
  {
    key: 'rising_star',
    section: 'Rising Star',
    label: 'Best Junior Player',
    ringTone: 'bronze',
    oraclePick: 'Arthur de Sloover',
    oraclePickTeam: 'BEL',
    statLine: 'Belgium midfield engine · first World Cup as a headline act',
    reason: 'The model backs minutes + team depth: the young star most likely to be on the pitch when medals are decided.',
    winner: null, winnerTeam: null, grade: 'not_graded',
  },
  {
    key: 'fair_play',
    section: 'Fair Play',
    label: 'Fair Play Trophy',
    ringTone: 'bronze',
    oraclePick: 'Netherlands',
    oraclePickTeam: 'NED',
    statLine: 'Lowest card count among projected medal contenders',
    reason: 'Deep runs accumulate bookings — the trophy weighs discipline against distance travelled. The hosts profile cleanest.',
    winner: null, winnerTeam: null, grade: 'not_graded',
  },
]

export const AWARDS_DISCLAIMER =
  'Award grading will reflect Oracle picks locked before the tournament began, recorded in the ' +
  'repository history. Official award winners per FIH, announced after the Gold Final on 30 August 2026.'

// Player of the Tournament race.
//
// The weights ARE the disclosure: the race scores each player by running the
// terms below, and the "How Oracle scores this" panel prints the same list.
// They cannot drift apart, which they had — the panel advertised a 15% assist
// term that the scoring code never applied and that the FIH record cannot
// support, because it publishes no assists for this competition.
export const POTM_MODEL = {
  terms: [
    { key: 'goals', label: 'Goals', weight: 3.0,
      of: p => p.goals ?? 0,
      describe: 'per goal scored, however it was scored' },
    { key: 'team_run', label: 'Team run', weight: 25,
      of: (p, ctx) => ctx.championOf(p.team),
      describe: 'times the champion probability of the player’s team, from Oracle' },
    { key: 'set_piece', label: 'Set-piece threat', weight: 1.5,
      of: p => p.pc_scored ?? 0,
      describe: 'extra per penalty-corner goal — the specialist’s signal' },
    { key: 'pedigree_star', label: 'Pedigree', weight: 1.5,
      of: p => (p.fih_star ? 1 : 0),
      describe: 'for a player the FIH lists among its world-ranked stars' },
    { key: 'pedigree_captain', label: 'Captaincy', weight: 0.5,
      of: p => (p.is_captain ? 1 : 0),
      describe: 'for wearing the armband' },
  ],
  softmaxT: 4,
  note: 'Scores convert to probabilities via softmax (T = 4), summing to 100%. ' +
    'Recomputed after every completed match — this is a live race, not a frozen list.',
}

/** The one place a race score is computed. */
export function potmScore(player, ctx) {
  return POTM_MODEL.terms.reduce((sum, t) => sum + t.weight * t.of(player, ctx), 0)
}
