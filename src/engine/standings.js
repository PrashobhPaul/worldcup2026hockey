// Hockey.AI — Pool standings, computed client-side from finished pool matches.
// Same pattern as Soccer.AI: standings are never stored, always derived.

export function computeStandings(teams, matches) {
  const poolOf = new Map()
  const pools = new Map()

  for (const t of teams) {
    if (!t.pool) continue
    poolOf.set(t.code, t.pool)
    if (!pools.has(t.pool)) pools.set(t.pool, new Set())
    pools.get(t.pool).add(t.code)
  }

  const rows = new Map()
  const rowFor = (code) => {
    let r = rows.get(code)
    if (!r) {
      r = { team: code, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
      rows.set(code, r)
    }
    return r
  }
  for (const code of poolOf.keys()) rowFor(code)

  for (const m of matches) {
    if (m.status !== 'completed' || m.phase !== 'pool') continue
    const h = m.score?.home
    const a = m.score?.away
    if (h == null || a == null) continue
    const home = rowFor(m.home)
    const away = rowFor(m.away)
    home.played++; away.played++
    home.gf += h; home.ga += a
    away.gf += a; away.ga += h
    if (h > a) { home.w++; home.pts += 3; away.l++ }
    else if (h < a) { away.w++; away.pts += 3; home.l++ }
    else { home.d++; away.d++; home.pts++; away.pts++ }
  }

  for (const r of rows.values()) r.gd = r.gf - r.ga

  return Array.from(pools.keys()).sort().map(pool => ({
    id: pool,
    standings: Array.from(pools.get(pool))
      .map(code => rowFor(code))
      // FIH pool ranking order: points, then matches won, then goal
      // difference, then goals for. (The "matches won" step is the FIH
      // criterion that a plain points→GD sort omits.)
      .sort((x, y) =>
        y.pts - x.pts || y.w - x.w || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team)
      ),
  }))
}
