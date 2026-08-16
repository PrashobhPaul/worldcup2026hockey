// Hockey.AI — deterministic match intelligence
// Port of Soccer.AI's IntelligencePanel telemetry, computed from real events
// only. Honesty rule carried over: when there is not enough data we return
// null / empty and the UI renders an explicit empty state — never a synthetic
// curve or a fake 33/33/33 split.

import { deriveClock } from './clock'
import { teamRating } from './strength'

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

function goalEvents(events) {
  return (events ?? []).filter(e => e.type === 'goal')
}

function cardPoints(events, teamCode) {
  let pts = 0
  for (const e of events ?? []) {
    if (e.team !== teamCode) continue
    if (e.type === 'yellow_card') pts += 1
    if (e.type === 'red_card') pts += 3
  }
  return pts
}

/**
 * Core live/post-match telemetry. All signals derive from FIH rank gap,
 * scoreline and the event feed — nothing random.
 */
export function deriveTelemetry({ match, home, away, events, pred }) {
  const clock = deriveClock(match)
  const minute = clock.minute ?? 0
  const live = match.status === 'live'
  const done = match.status === 'completed'

  const goals = goalEvents(events)
  const h = match.score?.home ?? 0
  const a = match.score?.away ?? 0
  const goalDiff = h - a

  // Recent attacks: goals + penalty corners won in the last 15 minutes of play
  const cutoff = Math.max(0, minute - 15)
  const recent = (events ?? []).filter(e =>
    e.minute >= cutoff && (e.type === 'goal' || e.type === 'pc_won'))
  const recentHome = recent.filter(e => e.team === match.home).length
  const recentAway = recent.filter(e => e.team === match.away).length

  const strengthLean = (teamRating(home) - teamRating(away)) / 8
  const liveLean = (live || done) ? goalDiff * 14 + (recentHome - recentAway) * 8 : 0

  const homeMomentum = Math.round(clamp(55 + strengthLean / 2 + liveLean))
  const awayMomentum = 100 - homeMomentum

  const homePressure = Math.round(clamp(60 + strengthLean / 1.5 + (recentHome - recentAway) * 10))
  const awayPressure = Math.round(clamp(60 - strengthLean / 1.5 + (recentAway - recentHome) * 10))

  const totalCards = cardPoints(events, match.home) + cardPoints(events, match.away)
  const eventDensity = minute > 0 ? ((events?.length ?? 0) / minute) * 60 : 0
  const chaos = Math.round(clamp(
    30 + eventDensity * 4 + Math.abs(goalDiff) * 4 + totalCards * 5
      + (1 - Math.min(1, Math.abs(strengthLean) / 25)) * 20))

  const pMax = pred?.status === 'ready'
    ? Math.max(pred.reg.home, pred.reg.draw, pred.reg.away) : 0.34
  const confidence = Math.round(clamp(55 + pMax * 35 + Math.abs(goalDiff) * 5))
  const overallScore = Math.round(clamp(40 + confidence * 0.35 + Math.max(homeMomentum, awayMomentum) * 0.25))

  return {
    clock, minute, live, done, goalDiff,
    homeMomentum, awayMomentum,
    homeDelta: (recentHome - recentAway) * 2.5,
    awayDelta: (recentAway - recentHome) * 2.5,
    homePressure, awayPressure,
    chaos, confidence, overallScore,
    goals, recentHome, recentAway,
  }
}

/**
 * Momentum timeline: event-impulse signal with exponential decay
 * (half-life 6'), rendered zero-sum like Soccer.AI's mirrored chart.
 * Returns [] when there are no events — callers must show an empty state.
 */
export function buildMomentumSeries({ match, events }) {
  const evs = (events ?? []).filter(e => typeof e.minute === 'number')
  if (!evs.length) return []
  const clock = deriveClock(match)
  const horizon = match.status === 'completed' ? 60 : Math.max(10, clock.minute ?? 10)

  const WEIGHTS = { goal: 8, pc_won: 2, green_card: -0.5, yellow_card: -1.5, red_card: -4 }
  const HALF_LIFE = 6
  const series = []
  for (let t = 0; t <= horizon; t++) {
    let hSig = 0, aSig = 0
    for (const e of evs) {
      if (e.minute > t) continue
      const w = WEIGHTS[e.type] ?? 0
      if (!w) continue
      const decay = Math.pow(0.5, (t - e.minute) / HALF_LIFE)
      if (e.team === match.home) hSig += w * decay
      else if (e.team === match.away) aSig += w * decay
    }
    const m = Math.tanh((hSig - aSig) / 8)
    series.push({
      min: t,
      home: Math.round(Math.max(0, m) * 100),
      away: -Math.round(Math.max(0, -m) * 100),
    })
  }
  return series
}

/**
 * Win-probability evolution: anchored at the frozen Oracle triple, then
 * updated every minute by a score-conditional Poisson forward model.
 * Returns [] without a ready prediction.
 */
export function buildProbSeries({ match, events, pred }) {
  if (!pred || pred.status !== 'ready') return []
  const clock = deriveClock(match)
  const done = match.status === 'completed'
  const live = match.status === 'live'
  if (!done && !live) return [{ min: 0, ...anchorPoint(pred) }]

  const horizon = done ? 60 : Math.min(60, Math.max(1, clock.minute ?? 1))
  const goals = goalEvents(events).sort((x, y) => x.minute - y.minute)
  const reds = (events ?? []).filter(e => e.type === 'red_card')

  // Fit λs so the pre-match Poisson matches the frozen triple's supremacy
  const supremacy = fitSupremacy(pred.reg)
  const totalGoals = 5.2

  const series = []
  for (let m = 0; m <= horizon; m++) {
    let h = 0, a = 0
    for (const g of goals) {
      if (g.minute > m) break
      if (g.team === match.home) h++
      else a++
    }
    const redsH = reds.filter(r => r.team === match.home && r.minute <= m).length
    const redsA = reds.filter(r => r.team === match.away && r.minute <= m).length
    const remaining = Math.max(0, 60 - m) / 60
    const lH = Math.max(0.05, ((totalGoals + supremacy) / 2) * Math.pow(0.75, redsH) * remaining)
    const lA = Math.max(0.05, ((totalGoals - supremacy) / 2) * Math.pow(0.75, redsA) * remaining)
    const p = conditionalOutcome(h - a, lH, lA)
    series.push({
      min: m,
      home: Math.round(p.home * 100),
      draw: Math.round(p.draw * 100),
      away: Math.round(p.away * 100),
    })
  }
  // Anchor: minute 0 must equal the frozen triple exactly
  series[0] = { min: 0, ...anchorPoint(pred) }
  return series
}

function anchorPoint(pred) {
  return {
    home: Math.round(pred.reg.home * 100),
    draw: Math.round(pred.reg.draw * 100),
    away: Math.round(pred.reg.away * 100),
  }
}

function fitSupremacy(reg) {
  let best = 0, bestErr = Infinity
  for (let s = -3; s <= 3.001; s += 0.1) {
    const p = conditionalOutcome(0, (5.2 + s) / 2, (5.2 - s) / 2)
    const err = (p.home - reg.home) ** 2 + (p.away - reg.away) ** 2
    if (err < bestErr) { bestErr = err; best = s }
  }
  return best
}

function conditionalOutcome(diff, lH, lA) {
  const max = 8
  const pmf = (lambda) => {
    const arr = []
    let p = Math.exp(-lambda)
    arr.push(p)
    for (let k = 1; k <= max; k++) { p *= lambda / k; arr.push(p) }
    return arr
  }
  const ph = pmf(lH), pa = pmf(lA)
  let home = 0, draw = 0, away = 0
  for (let x = 0; x <= max; x++) {
    for (let y = 0; y <= max; y++) {
      const p = ph[x] * pa[y]
      const d = diff + x - y
      if (d > 0) home += p
      else if (d < 0) away += p
      else draw += p
    }
  }
  const sum = home + draw + away || 1
  return { home: home / sum, draw: draw / sum, away: away / sum }
}

/** Comeback card: threshold statement, no synthetic percentage. */
export function deriveComeback({ match, tele, home, away }) {
  if (match.status !== 'live' && match.status !== 'completed') {
    return { headline: 'Pre-match', detail: 'Comeback tracking starts at push-back.' }
  }
  const { goalDiff, minute } = tele
  if (match.status === 'completed') {
    return { headline: 'Full-time', detail: 'No comeback left to track.' }
  }
  if (goalDiff === 0) {
    return { headline: `Level at ${minute}'`, detail: 'Next goal swings the whole match.' }
  }
  const trailing = goalDiff > 0 ? away : home
  const deficit = Math.abs(goalDiff)
  const remaining = Math.max(0, 60 - minute)
  return {
    headline: `${deficit === 1 ? 'One' : deficit === 2 ? 'Two' : deficit} down · ${remaining}' remaining`,
    detail: `${trailing?.name ?? 'The trailing side'} needs ${deficit} goal${deficit > 1 ? 's' : ''} to level.`,
    subtext: remaining <= 5 ? 'Keeper likely off for an extra outfielder.'
      : remaining <= 20 ? 'Expect an aggressive press and more penalty-corner traffic.'
      : 'Plenty of time — no panic yet.',
  }
}

/** Tactical insights: template family per phase, from real data only. */
export function buildInsights({ match, home, away, events, pred, tele }) {
  const out = []
  const hName = home?.name ?? match.home
  const aName = away?.name ?? match.away
  const h = match.score?.home ?? 0
  const a = match.score?.away ?? 0
  const pc = match.penalty_corners
  const goals = goalEvents(events)

  if (match.status === 'completed') {
    if (h !== a) {
      const wName = h > a ? hName : aName
      out.push(`${wName} took it ${Math.max(h, a)}-${Math.min(h, a)} in regulation.`)
    } else if (match.shootout && match.shootout.home !== match.shootout.away) {
      const wName = match.shootout.home > match.shootout.away ? hName : aName
      out.push(`Level after 60' — ${wName} held their nerve in the shootout.`)
    } else if (h === a) {
      out.push(`Honours even at ${h}-${a} — a point apiece.`)
    }
    const pcGoals = goals.filter(g => g.via === 'PC')
    if (pcGoals.length) out.push(`${pcGoals.length} of ${goals.length} goals came from penalty corners — set pieces decided this one.`)
    const late = goals.filter(g => g.minute >= 45)
    if (late.length) out.push(`${late.length} fourth-quarter goal${late.length > 1 ? 's' : ''} — the match lived right to the end.`)
    if (pc?.home != null && Math.abs(pc.home - pc.away) >= 3) {
      const dom = pc.home > pc.away ? hName : aName
      out.push(`${dom} won the corner battle ${Math.max(pc.home, pc.away)}-${Math.min(pc.home, pc.away)}.`)
    }
    const cardsH = cardPoints(events, match.home), cardsA = cardPoints(events, match.away)
    if (Math.abs(cardsH - cardsA) >= 2) {
      out.push(`Discipline gap: ${cardsH > cardsA ? hName : aName} gave away ${Math.abs(cardsH - cardsA)} more card points.`)
    }
  } else if (match.status === 'live') {
    if (h !== a) out.push(`${h > a ? hName : aName} lead ${Math.max(h, a)}-${Math.min(h, a)} — ${h > a ? aName : hName} chasing.`)
    else out.push(`All square at ${h}-${a}.`)
    if (tele.recentHome - tele.recentAway >= 2) out.push(`${hName} building pressure — ${tele.recentHome} attacking moments in the last 15'.`)
    if (tele.recentAway - tele.recentHome >= 2) out.push(`${aName} building pressure — ${tele.recentAway} attacking moments in the last 15'.`)
    const lastGoal = goals[goals.length - 1]
    if (lastGoal && tele.minute - lastGoal.minute <= 10) {
      out.push(`Fresh goal: ${lastGoal.player} (${lastGoal.via}) at ${lastGoal.minute}' shifted the momentum.`)
    }
  } else if (pred?.status === 'ready') {
    const gap = Math.abs(pred.reg.home - pred.reg.away)
    if (gap >= 0.18) {
      const fav = pred.reg.home > pred.reg.away ? hName : aName
      out.push(`${fav} clear favourites at ${Math.round(Math.max(pred.reg.home, pred.reg.away) * 100)}%.`)
    } else {
      out.push(`Tight matchup — ${Math.round(pred.reg.home * 100)} / ${Math.round(pred.reg.draw * 100)} / ${Math.round(pred.reg.away * 100)} split; conceding first widens the gap sharply.`)
    }
    const rankGap = (away?.fihRank ?? 8) - (home?.fihRank ?? 8)
    if (Math.abs(rankGap) >= 5) {
      out.push(`${rankGap > 0 ? hName : aName} carry an FIH ranking edge of ${Math.abs(rankGap)} places.`)
    }
  }
  return out.slice(0, 5)
}

/** Key drivers behind the Oracle pick — parsed from ranking + prediction. */
export function buildDrivers({ match, home, away, pred }) {
  if (pred?.status !== 'ready') return []
  const out = []
  const rankGap = (away?.fihRank ?? 8) - (home?.fihRank ?? 8)
  const better = rankGap > 0 ? home : away
  const worse = rankGap > 0 ? away : home
  if (rankGap !== 0) {
    out.push({
      tone: 'pos',
      title: `${better?.name ?? '—'} ranked higher`,
      text: `FIH #${better?.fihRank} vs #${worse?.fihRank} — a ${Math.abs(rankGap)}-place gap the model weighs heavily.`,
    })
  }
  const pickTeam = pred.pick === 'HOME' ? home : pred.pick === 'AWAY' ? away : null
  if (pickTeam?.key_players?.length) {
    out.push({
      tone: 'pos',
      title: 'Set-piece threat',
      text: `${pickTeam.key_players[0]} is the premium drag-flick weapon in this fixture.`,
    })
  }
  if (home?.contender_tier && away?.contender_tier && home.contender_tier !== away.contender_tier) {
    out.push({
      tone: 'neutral',
      title: 'Tier matchup',
      text: `${(home.contender_tier ?? '').replace('_', ' ')} vs ${(away.contender_tier ?? '').replace('_', ' ')} — tournament pedigree is in the prior.`,
    })
  }
  if ((home?.host || away?.host)) {
    const hostT = home?.host ? home : away
    out.push({ tone: 'pos', title: 'Home crowd', text: `${hostT.name} play in front of a host-nation crowd.` })
  }
  if (pred.isKnockout) {
    out.push({
      tone: 'neutral',
      title: 'Shootout path',
      text: `${Math.round(pred.paths.shootout * 100)}% chance this goes to a shootout — fine margins.`,
    })
  }
  return out.slice(0, 5)
}

/**
 * Match DNA: per-axis percentile vs every completed team-performance so far.
 * Axes from available hockey data; axes with no data are dropped, not padded.
 */
export function buildMatchDNA({ match, matches, allEvents }) {
  if (match.status !== 'completed' || match.score?.home == null) return null

  // Corpus: one row per team per completed match
  const rows = []
  for (const m of matches) {
    if (m.status !== 'completed' || m.score?.home == null) continue
    const evs = allEvents.filter(e => e.matchId === m.id)
    for (const side of ['home', 'away']) {
      const code = m[side]
      const opp = side === 'home' ? 'away' : 'home'
      const teamEvents = evs.filter(e => e.team === code)
      rows.push({
        matchId: m.id, code,
        goals: m.score[side] ?? 0,
        conceded: m.score[opp] ?? 0,
        pc: m.penalty_corners?.[side] ?? null,
        pcGoals: teamEvents.filter(e => e.type === 'goal' && e.via === 'PC').length,
        fieldGoals: teamEvents.filter(e => e.type === 'goal' && e.via === 'FG').length,
        discipline: -cardPoints(evs, code),
      })
    }
  }
  if (rows.length < 4) return null

  const pctile = (vals, v) => {
    const arr = vals.filter(x => x != null)
    if (!arr.length || v == null) return null
    const below = arr.filter(x => x < v).length
    const equal = arr.filter(x => x === v).length
    return Math.round(((below + equal / 2) / arr.length) * 100)
  }

  const axes = [
    { key: 'goals', label: 'Attack' },
    { key: 'fieldGoals', label: 'Open Play' },
    { key: 'pc', label: 'PC Volume' },
    { key: 'pcGoals', label: 'PC Conversion' },
    { key: 'discipline', label: 'Discipline' },
  ]

  const sideRow = (side) => rows.find(r => r.matchId === match.id && r.code === match[side])
  const hr = sideRow('home'), ar = sideRow('away')
  if (!hr || !ar) return null

  const data = []
  for (const ax of axes) {
    const vals = rows.map(r => r[ax.key])
    const hv = pctile(vals, hr[ax.key])
    const av = pctile(vals, ar[ax.key])
    if (hv == null || av == null) continue
    data.push({ axis: ax.label, home: hv, away: av, rawHome: hr[ax.key], rawAway: ar[ax.key] })
  }
  return data.length >= 3 ? data : null
}
