// Hockey.AI — the best XI a team has actually fielded evidence for.
//
// A best XI is not the eleven highest-rated names on a squad list: it is
// eleven players in the positions they play. Hockey plays 1-4-3-3 — a keeper,
// a back four the drag flick comes from, a midfield three, a front three.
//
// The FIH entry list states no position, and the TMS line-up pages that would
// are not served publicly, so the role each player is placed in comes from the
// Hockey.AI position model in the data pipeline: it reads how a player's goals
// were scored and marks penalty-corner scorers as defenders, repeat field
// scorers as forwards, other scorers as midfielders. `position_source` says
// which of the two — FIH or Hockey.AI — each shirt is standing on.
//
// A player with nothing on the record gets no role. When a line is short of
// bodies, those players fill it in index order and the shirt says the role is
// not on the record. Nothing is invented to fill a shirt quietly.

export const HOCKEY_FORMATION = '1-4-3-3'

export const LINES = [
  { role: 'Goalkeeper', short: 'GK', count: 1 },
  { role: 'Defender', short: 'DEF', count: 4 },
  { role: 'Midfielder', short: 'MID', count: 3 },
  { role: 'Forward', short: 'FWD', count: 3 },
]

/**
 * Is this player actually at the tournament?
 *
 * The squad list carries two kinds of row: the twenty names on each nation's
 * official FIH team list, and pre-tournament seed entries for players who were
 * expected and did not travel. Twenty-four of the latter were being rated,
 * ranked and picked for best XIs — the Netherlands were fielding a goalkeeper
 * who retired after Paris 2024. A player the official list does not carry is
 * not part of this tournament, and no surface that describes the tournament
 * should show him.
 */
export function isAtTournament(p) {
  return p?.on_team_list !== false
}

/** The role a surface should show for a player, and where it came from. */
export function roleOf(p) {
  const stated = p.position && p.position !== 'Squad' ? p.position : null
  return {
    role: stated ?? p.position_effective ?? null,
    source: stated ? 'FIH' : (p.position_effective ? 'Hockey.AI' : null),
  }
}

/**
 * The Top Performers boards: every rated player at the tournament, ranked
 * within the line they actually play in.
 *
 * This is the one ranking. The Stats tab shows the head of each board and the
 * best XI takes the first one, four, three and three from the same four
 * lists, so the eleven on the pitch are by construction the players at the top
 * of the boards beside them — they cannot drift apart, because there is
 * nothing to drift from.
 */
export function positionBoards(players, { top = Infinity } = {}) {
  const eligible = (players ?? []).filter(p => isAtTournament(p) && p.ai_rating != null)
  const boards = {}
  for (const line of LINES) {
    boards[line.role] = eligible
      .filter(p => roleOf(p).role === line.role)
      .sort((a, b) => b.ai_rating - a.ai_rating || a.name.localeCompare(b.name))
      .map((p, i) => ({ player: p, rating: p.ai_rating, rank: i + 1, line }))
      .slice(0, top)
  }
  return boards
}

/**
 * The tournament's best XI: the highest-rated player in each line, across
 * every nation, in 1-4-3-3.
 *
 * Different question from the per-team `bestXI` below, which answers "who does
 * this coach actually field" and so orders on starts. This one is a merit XI
 * and orders on the rating alone.
 *
 * The line a player belongs to is `roleOf`, never the raw entry-list value.
 * This selection used to read `position` directly, and because the FIH marks
 * only `(GK)` — three players in the whole tournament are stated Defenders —
 * the back four could never be filled and the XI quietly fielded ten men.
 */
export function tournamentXI(players) {
  const boards = positionBoards(players)
  return LINES.flatMap(l => boards[l.role].slice(0, l.count)
    .map(r => ({ ...r.player, line: l, roleRank: r.rank })))
}

/**
 * Who to pick for a role.
 *
 * Starts come first, because the official team sheets now state them and the
 * side a coach actually fields is a better answer to "the best eleven" than a
 * rating is. The rating breaks ties between players the coach used equally,
 * and goals break ties after that.
 *
 * Before the sheets were readable there was no start count and this ordered on
 * rating alone, which meant a substitute who scored could displace a man who
 * started every match.
 */
const byIndex = (a, b) =>
  (b.starts ?? 0) - (a.starts ?? 0) ||
  (b.ai_rating ?? 0) - (a.ai_rating ?? 0) ||
  (b.goals ?? 0) - (a.goals ?? 0) ||
  a.name.localeCompare(b.name)

/**
 * {lines, bench, derivedCount, unplacedCount} for one squad.
 *
 * `lines` follows 1-4-3-3 from the back. Each slot is
 *   {player, source: 'FIH'|'Hockey.AI'|null, offRole: boolean}
 * where offRole marks a shirt filled by a player the record gives no role to.
 */
export function bestXI(rawSquad) {
  const squad = (rawSquad ?? []).filter(isAtTournament)
  // Every squad member is available to fill a shirt. Filtering to players who
  // carry a rating left four squads short of eleven: a player the record says
  // nothing about still travelled, and the shirt he fills says exactly that.
  const byRole = new Map(LINES.map(l => [l.role, []]))
  const spare = []
  for (const p of squad ?? []) {
    const { role } = roleOf(p)
    if (role && byRole.has(role)) byRole.get(role).push(p)
    else spare.push(p)
  }
  for (const list of byRole.values()) list.sort(byIndex)
  spare.sort(byIndex)

  const taken = new Set()
  const lines = LINES.map(line => {
    const slots = []
    for (const p of byRole.get(line.role)) {
      if (slots.length >= line.count) break
      slots.push({ player: p, source: roleOf(p).source, offRole: false })
      taken.add(p.id)
    }
    while (slots.length < line.count) {
      const p = spare.find(x => !taken.has(x.id))
      if (!p) break
      slots.push({ player: p, source: null, offRole: true })
      taken.add(p.id)
    }
    return { ...line, slots }
  })

  const bench = (squad ?? []).filter(p => !taken.has(p.id)).sort(byIndex)
  const placed = lines.flatMap(l => l.slots)
  return {
    lines,
    bench,
    formation: HOCKEY_FORMATION,
    derivedCount: placed.filter(s => s.source === 'Hockey.AI').length,
    officialCount: placed.filter(s => s.source === 'FIH').length,
    unplacedCount: placed.filter(s => s.offRole).length,
    size: placed.length,
  }
}

/**
 * The best in each department for one squad — the team's own leaderboard,
 * so a page about one nation does not have to send the reader to a global
 * table to find out who its own top scorer is.
 *
 * Every entry carries whether it is the FIH's figure or Hockey.AI's.
 */
export function teamToppers(rawSquad, { matchesPlayed = 0, goalsAgainst = 0 } = {}) {
  const list = (rawSquad ?? []).filter(isAtTournament)
  const best = (pred, cmp, pick) => {
    const rows = list.filter(pred).sort(cmp)
    return rows.length && pick(rows[0]) ? rows[0] : null
  }
  const num = key => (a, b) => (b[key] ?? 0) - (a[key] ?? 0) || a.name.localeCompare(b.name)

  const scorer = best(p => (p.goals ?? 0) > 0, num('goals'), p => p.goals)
  const setPiece = best(p => (p.pc_scored ?? 0) > 0, num('pc_scored'), p => p.pc_scored)
  const fieldOf = p => p.fg_scored ?? Math.max(0, (p.goals ?? 0) - (p.pc_scored ?? 0) - (p.ps_scored ?? 0))
  const fieldRows = list.filter(p => fieldOf(p) > 0)
    .sort((a, b) => fieldOf(b) - fieldOf(a) || a.name.localeCompare(b.name))
  const index = best(p => p.ai_rating != null, num('ai_rating'), p => p.ai_rating)
  const keeper = best(p => p.position === 'Goalkeeper' && p.ai_rating != null,
    num('ai_rating'), p => p.ai_rating)
  const cardsOf = p => (p.green_cards ?? 0) + (p.yellow_cards ?? 0) + (p.red_cards ?? 0)
  const carded = list.filter(p => cardsOf(p) > 0)
    .sort((a, b) => cardsOf(b) - cardsOf(a) || a.name.localeCompare(b.name))[0] ?? null

  const rows = [
    scorer && { key: 'scorer', label: 'Top scorer', player: scorer, derived: false,
      stat: `${scorer.goals} goal${scorer.goals === 1 ? '' : 's'}` },
    setPiece && { key: 'set_piece', label: 'Penalty corners', player: setPiece, derived: false,
      stat: `${setPiece.pc_scored} scored` },
    fieldRows[0] && { key: 'open_play', label: 'Open play', player: fieldRows[0], derived: true,
      stat: `${fieldOf(fieldRows[0])} field goal${fieldOf(fieldRows[0]) === 1 ? '' : 's'}` },
    keeper && { key: 'keeper', label: 'Goalkeeper', player: keeper, derived: true,
      stat: matchesPlayed
        ? `${(goalsAgainst / matchesPlayed).toFixed(2)} conceded per match`
        : `index ${keeper.ai_rating}` },
    index && { key: 'index', label: 'Player index', player: index, derived: true,
      stat: `${index.ai_rating} / 100` },
    carded && { key: 'cards', label: 'Most carded', player: carded, derived: false,
      stat: `${cardsOf(carded)} card${cardsOf(carded) === 1 ? '' : 's'}` },
  ].filter(Boolean)

  return rows
}
