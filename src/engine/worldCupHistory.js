// Hockey.AI — every World Cup, and this one's place in it.
//
// Not to be confused with engine/history.js, which is the head-to-head record
// between two nations. This file is the roll of editions.
//
// The first fifteen editions are a static record: public/data/world-cup-history.json,
// assembled from public sources because the FIH archive is not reachable from
// here, and it says so in its own provenance block rather than implying an
// authority it does not have.
//
// The 2026 row is NOT in that file, deliberately. This app holds the 2026
// tournament first-hand — fifty match records, a gold medal match with a
// result — so writing the champion into a data file would be storing an answer
// the record already gives. It is derived here, from the same fixtures every
// other surface reads, which also means the row cannot be wrong in a way the
// match cards are right.
//
// Honours are counted, never stored. Pakistan's four titles are four rows with
// Pakistan in the champion column, and a hand-kept tally is one edition away
// from disagreeing with the table printed above it.

/** Who won a knockout: the scoreline, or the shoot-out when it was level. */
function winnerOf(m) {
  if (!m || !m.score || m.score.home == null) return null
  if (m.score.home !== m.score.away) return m.score.home > m.score.away ? m.home : m.away
  const so = m.shootout ?? {}
  if (so.home == null || so.home === so.away) return null
  return so.home > so.away ? m.home : m.away
}

function loserOf(m) {
  const w = winnerOf(m)
  if (!w) return null
  return w === m.home ? m.away : m.home
}

/**
 * The final's scoreline, stated CHAMPION FIRST.
 *
 * The fixture stores it home-first, and the gold medal match does not care
 * which of the two was nominally at home: ESP 0-1 GER is stored that way and
 * Germany won it. Printed raw under a column headed "Champion", that reads
 * "Germany 0-1" — the champion losing its own final. Every historical row in
 * world-cup-history.json states the winner's goals first, which is the
 * convention a medal table is read in, so the derived row has to as well.
 */
function finalLine(m) {
  if (!m?.score || m.score.home == null) return null
  const w = winnerOf(m)
  const flip = w != null && w !== m.home
  const [a, b] = flip ? [m.score.away, m.score.home] : [m.score.home, m.score.away]
  const so = m.shootout ?? {}
  if (so.home == null || so.home === so.away) return `${a}-${b}`
  const [sa, sb] = flip ? [so.away, so.home] : [so.home, so.away]
  return `${a}-${b} (${sa}-${sb} SO)`
}

/**
 * This tournament as a history row, or null while it is still being played.
 * A medal table is a finished thing; there is no honest partial version of it.
 */
export function currentEdition(matches, meta) {
  if (!matches?.length) return null
  const gold = matches.find(m => m.id === 'GOLD')
  const bronze = matches.find(m => m.id === 'BRZ')
  const champion = winnerOf(gold)
  if (!champion) return null
  return {
    year: meta?.year ?? new Date(gold.date).getFullYear(),
    city: meta?.city ?? null,
    country: meta?.country ?? null,
    champion: meta?.nameOf?.(champion) ?? champion,
    championCode: champion,
    runnerUp: meta?.nameOf?.(loserOf(gold)) ?? loserOf(gold),
    runnerUpCode: loserOf(gold),
    third: meta?.nameOf?.(winnerOf(bronze)) ?? winnerOf(bronze),
    thirdCode: winnerOf(bronze),
    final: finalLine(gold),
    current: true,
  }
}

/** Past editions plus this one, oldest first. */
export function editions(history, matches, meta) {
  const past = (history?.editions ?? []).map(e => ({ ...e, current: false }))
  const now = currentEdition(matches, meta)
  const rows = now ? [...past, now] : past
  return rows.slice().sort((a, b) => a.year - b.year)
}

/**
 * Honours per nation, counted from the rows: golds, silvers, bronzes.
 * Sorted the way a medal table is — gold first, then silver, then bronze.
 */
export function honours(rows) {
  const tally = new Map()
  const bump = (name, code, key) => {
    if (!name) return
    if (!tally.has(name)) tally.set(name, { name, code, gold: 0, silver: 0, bronze: 0 })
    tally.get(name)[key] += 1
  }
  for (const e of rows) {
    bump(e.champion, e.championCode, 'gold')
    bump(e.runnerUp, e.runnerUpCode, 'silver')
    bump(e.third, e.thirdCode, 'bronze')
  }
  return [...tally.values()].sort((a, b) =>
    b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name))
}
