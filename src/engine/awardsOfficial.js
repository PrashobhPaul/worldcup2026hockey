// Hockey.AI — the official awards, and how the Oracle did against them.
//
// The Awards tab was a prediction for a fortnight. The FIH has now announced
// the winners, so it is a record, and the prediction becomes something to be
// judged by rather than something to keep showing on its own.
//
// This app publishes its accuracy everywhere else; the awards are no different
// and no more flattering. There are two separate Oracle claims to grade, and
// they are different claims made at different times:
//
//   * the pre-tournament pick, locked in content/awards.js before a ball was
//     hit and never edited since (git is the audit trail);
//   * the live Player of the Tournament race, recomputed after every match,
//     which is the number the page has been showing all fortnight.
//
// Both are graded, because reporting only the kinder one is the failure this
// repository keeps designing against. As it happens both missed, and that is
// printed as plainly as a hit would be.

/** Nothing is graded against an award the FIH has not announced. */
export function officialAwards(doc) {
  return (doc?.awards ?? []).filter(a => a.winner)
}

/**
 * One row per announced award: the winner, the pre-tournament pick, and
 * whether that pick was right.
 *
 * `hof` is the frozen pre-tournament list; rows are matched by key, so an
 * award with no locked pick simply reports the winner and says the Oracle
 * never named one, rather than being silently dropped.
 */
export function gradeAwards(doc, hof) {
  const picks = new Map((hof ?? []).map(a => [a.key, a]))
  return officialAwards(doc).map(a => {
    const pick = picks.get(a.key) ?? null
    const called = pick ? sameName(pick.oraclePick, a.winner) : null
    return {
      ...a,
      display: a.winnerDisplay ?? a.winner,
      oraclePick: pick?.oraclePick ?? null,
      oraclePickTeam: pick?.oraclePickTeam ?? null,
      oracleReason: pick?.reason ?? null,
      called,
    }
  })
}

/** Names travel with and without accents; compare on the letters. */
export function sameName(a, b) {
  const flat = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '')
  return Boolean(a) && Boolean(b) && flat(a) === flat(b)
}

/**
 * Where the live race put the actual winner.
 *
 * `race` is the scored list the Awards page already builds. Returning the rank
 * rather than a bare hit/miss is the honest form: a model that had the winner
 * third was closer than one that had him thirtieth, and both are misses.
 */
export function racePlacement(race, winnerName) {
  if (!race?.length || !winnerName) return null
  const i = race.findIndex(p => sameName(p.name, winnerName))
  if (i < 0) return null
  return { rank: i + 1, player: race[i], leader: race[0], calledIt: i === 0 }
}
