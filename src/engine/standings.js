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

// ── Stage 2 standings — the REAL table, as the official app publishes it ────
// Each Stage-2 pool of four plays only four cross fixtures; the fifth and
// sixth pairings are carried forward from Stage 1: the two teams that arrived
// together from the same Stage-1 pool do not replay, their result counts as
// played. Mechanically that means: any completed pool- or stage2-phase match
// whose BOTH teams sit in this Stage-2 pool belongs in the table — a Stage-1
// match passing that test is, by construction, exactly the carried pairing.
export function computeStage2Standings(matches) {
  const pools = new Map()
  for (const m of matches) {
    if (m.phase !== 'stage2' || m.home === 'TBD' || !m.pool) continue
    if (!pools.has(m.pool)) pools.set(m.pool, new Set())
    pools.get(m.pool).add(m.home)
    pools.get(m.pool).add(m.away)
  }

  return Array.from(pools.keys()).sort().map(pool => {
    const codes = pools.get(pool)
    const rows = new Map(Array.from(codes, c =>
      [c, { team: c, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }]))
    // Result of the meeting between two pool members, for the FIH tie-break.
    const beat = new Map()
    let crossPlayed = 0, crossTotal = 0
    for (const m of matches) {
      if (m.phase !== 'pool' && m.phase !== 'stage2') continue
      if (!rows.has(m.home) || !rows.has(m.away)) continue
      if (m.phase === 'stage2') {
        crossTotal++
        if (m.status === 'completed' && m.score?.home != null) crossPlayed++
      }
      if (m.status !== 'completed' || m.score?.home == null) continue
      const h = m.score.home, a = m.score.away
      const rh = rows.get(m.home), ra = rows.get(m.away)
      rh.played++; ra.played++
      rh.gf += h; rh.ga += a
      ra.gf += a; ra.ga += h
      if (h > a) { rh.w++; rh.pts += 3; ra.l++; beat.set(`${m.home}>${m.away}`, true) }
      else if (h < a) { ra.w++; ra.pts += 3; rh.l++; beat.set(`${m.away}>${m.home}`, true) }
      else { rh.d++; ra.d++; rh.pts++; ra.pts++ }
    }
    for (const r of rows.values()) r.gd = r.gf - r.ga
    return {
      id: pool,
      crossPlayed,
      crossTotal,
      standings: [...rows.values()].sort((x, y) =>
        y.pts - x.pts || y.w - x.w || y.gd - x.gd || y.gf - x.gf ||
        // FIH: still level → the result between the teams concerned decides.
        (beat.get(`${y.team}>${x.team}`) ? 1 : 0) - (beat.get(`${x.team}>${y.team}`) ? 1 : 0) ||
        x.team.localeCompare(y.team)),
    }
  })
}
