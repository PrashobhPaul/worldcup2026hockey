// Hockey.AI — who has earned a label
//
// Tags used to come off `contender_tier`, a hand-seeded field set before a ball
// was hit, and every one of the 16 carried one. A badge on all sixteen labels
// nothing: "outsider" next to a crest is noise, and a pre-tournament opinion
// stops being interesting the moment the tournament starts answering it.
//
// So only six teams are tagged, and the tag is earned here rather than seeded:
//
//   ⭐ Favourites (3)  the three most likely champions, from the canonical
//                      snapshot — the same number shown beside the crest.
//   ♞ Dark Horses (2)  not favourites, but outplaying their ranking by the
//                      widest margin: live threats the table did not predict.
//   ⚡ Underdog (1)     the lowest-ranked side over-delivering — the story of
//                      the tournament so far, not merely a good team.
//
// Everyone else carries no badge, which is the honest thing to show: they are
// having an ordinary tournament.
//
// Eliminated teams are never tagged. A side out of contention is not a
// favourite however well it played on the way out.

export const TIER_QUOTA = { favourite: 3, dark_horse: 2, underdog: 1 }

// What a team of this ranking is expected to average, in points per match.
// Linear across the 16 here: #1 ≈ 2.6 (wins most), #16 ≈ 0.65 (a draw here and
// there). The exact slope matters less than that it is monotonic — it is only
// ever used to rank teams by how far they have beaten it.
export function expectedPPM(rank) {
  const r = Math.max(1, Math.min(16, rank ?? 12))
  return 2.6 - 0.13 * (r - 1)
}

/** Points per match so far, or null when a team has not played. */
export function actualPPM(form) {
  const n = form?.played ?? 0
  if (!n) return null
  return ((form.wins ?? 0) * 3 + (form.draws ?? 0)) / n
}

/**
 * How far a team is beating what its ranking implies. Positive = punching
 * above its weight. Null until it has played, so nobody is called an
 * overachiever on the strength of no evidence.
 */
export function overachievement(team) {
  const ppm = actualPPM(team?.form)
  if (ppm == null) return null
  const rank = team.fihRank ?? team.fih_rank
  const gd = (team.form.gf ?? 0) - (team.form.ga ?? 0)
  // Goal difference breaks ties between teams on the same points, the same way
  // the pool table does.
  return (ppm - expectedPPM(rank)) + (gd / team.form.played) * 0.15
}

const rankOf = t => t.fihRank ?? t.fih_rank ?? 99

/** Median FIH ranking of a field — the line between its halves. */
export function medianRank(teams) {
  const ranks = teams.map(rankOf).sort((a, b) => a - b)
  if (!ranks.length) return 0
  const mid = ranks.length >> 1
  return ranks.length % 2 ? ranks[mid] : (ranks[mid - 1] + ranks[mid]) / 2
}

/**
 * @returns Map of team code -> 'favourite' | 'dark_horse' | 'underdog'.
 * Teams with no tag are simply absent from the map.
 */
export function assignTiers({ teams, championOf, isOut }) {
  const out = new Map()
  if (!teams?.length) return out

  const alive = teams.filter(t => !isOut?.(t.code))
  const champ = c => championOf?.(c) ?? 0

  // ── Favourites: the model's most likely champions ────────────────────────
  const byChampion = [...alive].sort(
    (a, b) => champ(b.code) - champ(a.code) || rankOf(a) - rankOf(b))
  for (const t of byChampion.slice(0, TIER_QUOTA.favourite)) out.set(t.code, 'favourite')

  const rest = alive.filter(t => !out.has(t.code))
  const scored = rest.map(t => ({ t, over: overachievement(t) }))
  const anyPlayed = scored.some(s => s.over != null)
  // Once matches are played, overachievement orders everything; before that,
  // the model's own ranking of who could still win it stands in.
  const ranked = anyPlayed
    ? [...scored].sort((a, b) => (b.over ?? -99) - (a.over ?? -99) || champ(b.t.code) - champ(a.t.code))
    : [...scored].sort((a, b) => champ(b.t.code) - champ(a.t.code))

  // ── Underdog: the lowest-ranked side over-delivering ─────────────────────
  // Picked before the dark horses, because a low-ranked team outplaying the
  // field is the underdog story — labelling it a dark horse and handing the ⚡
  // to someone lesser would get both tags wrong.
  //
  // "Low-ranked" is measured against the teams still standing, not against the
  // opening sixteen. Every side ranked 9–16 drops out of contention when the
  // pools finish, so an absolute cut-off would retire the label for the rest of
  // the tournament; against the surviving field it keeps meaning the same
  // thing — the least-fancied team left that is beating its ranking.
  const median = medianRank(alive)
  const bottom = ranked.filter(s => rankOf(s.t) > median)
  if (bottom.length) out.set(bottom[0].t.code, 'underdog')

  // ── Dark horses: beating their ranking by the widest margin ──────────────
  // Live threats the table did not predict — the next-best overachievers once
  // the favourites and the underdog are spoken for.
  for (const s of ranked.filter(s => !out.has(s.t.code)).slice(0, TIER_QUOTA.dark_horse)) {
    out.set(s.t.code, 'dark_horse')
  }

  return out
}
