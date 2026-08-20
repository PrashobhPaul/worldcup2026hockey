// Hockey.AI — evidence-led match preview
//
// A pre-match card deck built from this tournament's own event ledger. The old
// preview could only say "France are ranked four places above South Africa, so
// France win" — a fact about a table, not about either team's hockey. Every
// card here carries a number we actually hold: goals, penalty corners won and
// converted, cards, scorers, when goals arrive, and any meeting the two sides
// have already had here.
//
// Honesty rules, carried from insights.js:
//  • Only this tournament. We hold no career or all-time head-to-head, so we
//    never claim one — a card with no supporting data is dropped, not padded.
//  • Every stat states its scope in words, so "3 from 8" can never be read as
//    an all-time record.
//  • A card needs a real sample. One match is not "form"; those cards stay out.

const PLAYED = m => m.status === 'completed' && m.score?.home != null

/** Everything we know about one team's tournament so far. */
export function teamLedger(code, matches, events) {
  const played = matches.filter(m => PLAYED(m) && (m.home === code || m.away === code))
  const byId = new Map(played.map(m => [m.id, m]))
  const mine = (events ?? []).filter(e => e.team === code && byId.has(e.matchId))

  let w = 0, d = 0, l = 0, gf = 0, ga = 0, pcWon = 0
  const results = []
  for (const m of played) {
    const side = m.home === code ? 'home' : 'away'
    const opp = side === 'home' ? 'away' : 'home'
    const f = m.score[side], a = m.score[opp]
    gf += f; ga += a
    if (f > a) w++; else if (f < a) l++; else d++
    pcWon += (m.penalty_corners ?? {})[side] ?? 0
    results.push({ id: m.id, for: f, against: a, opponent: m[opp], won: f > a, drew: f === a })
  }

  const goals = mine.filter(e => e.type === 'goal')
  const scorers = new Map()
  for (const g of goals) {
    if (!g.player) continue
    const s = scorers.get(g.player) ?? { name: g.player, goals: 0, pc: 0 }
    s.goals++
    if (g.via === 'PC') s.pc++
    scorers.set(g.player, s)
  }

  return {
    code, played: played.length, w, d, l, gf, ga, results,
    pcWon,
    pcGoals: goals.filter(g => g.via === 'PC').length,
    goals: goals.length,
    lateGoals: goals.filter(g => g.minute >= 46).length,
    green: mine.filter(e => e.type === 'green_card').length,
    yellow: mine.filter(e => e.type === 'yellow_card').length,
    red: mine.filter(e => e.type === 'red_card').length,
    topScorers: [...scorers.values()].sort((x, y) => y.goals - x.goals || y.pc - x.pc),
  }
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null)
const record = t => `${t.w}W-${t.d}D-${t.l}L`
const nameOf = (team, code) => team?.name ?? code

/**
 * Preview cards for a fixture that has not been played.
 * Returns [] when the tournament has not produced enough evidence yet — the UI
 * then falls back to the model line rather than showing invented colour.
 */
export function buildPreview({ match, home, away, matches, events, pred }) {
  if (!match || match.status === 'completed') return []
  const hCode = match.home, aCode = match.away
  if (!hCode || !aCode || hCode === 'TBD' || aCode === 'TBD') return []

  const H = teamLedger(hCode, matches, events)
  const A = teamLedger(aCode, matches, events)
  if (!H.played && !A.played) return []

  const hName = nameOf(home, hCode), aName = nameOf(away, aCode)
  const cards = []

  // ── Already met here ─────────────────────────────────────────────────────
  // In Stage 2 this is the sharpest card on the deck: two sides out of the same
  // Stage-1 pool carry that result forward, so it is not history — it is points
  // already on the table.
  const met = matches.filter(m => PLAYED(m) && m.id !== match.id &&
    ((m.home === hCode && m.away === aCode) || (m.home === aCode && m.away === hCode)))
  if (met.length) {
    const m = met[met.length - 1]
    const hs = m.home === hCode ? m.score.home : m.score.away
    const as = m.home === hCode ? m.score.away : m.score.home
    const carried = match.phase === 'stage2' && m.phase === 'pool'
    cards.push({
      kind: 'h2h', label: 'Already met', tone: 'brand',
      stat: `${hs}-${as}`,
      statLabel: `${hName} vs ${aName}, earlier in this World Cup`,
      headline: hs === as
        ? `They could not be separated last time`
        : `${hs > as ? hName : aName} took the first meeting`,
      text: carried
        ? `These two came through the same Stage-1 pool, so this ${hs}-${as} is not a memory — it carries forward into the Stage-2 table, and both sides start this round with it already counted.`
        : `They met here on ${m.date}, ${hName} ${hs}-${as} ${aName}.`,
    })
  }

  // ── Form in this tournament ──────────────────────────────────────────────
  if (H.played >= 2 && A.played >= 2) {
    const line = t => `${record(t)}, ${t.gf} scored and ${t.ga} conceded`
    const best = A.results.filter(r => !r.won).sort((x, y) => (x.against - x.for) - (y.against - y.for))[0]
    const noWins = H.w === 0 && A.w === 0
    // Wins first, goal difference as the separator — the same order the pool
    // table uses, so the card never calls a side "better" on a tie.
    const gd = t => t.gf - t.ga
    const lead = H.w !== A.w ? (H.w > A.w ? H : A) : (gd(H) !== gd(A) ? (gd(H) > gd(A) ? H : A) : null)
    const leadName = lead ? (lead.code === hCode ? hName : aName) : null
    cards.push({
      kind: 'form', label: 'Form', tone: 'pos',
      stat: noWins ? '0' : `${H.w}–${A.w}`,
      statLabel: noWins
        ? `wins between them in ${H.played + A.played} matches here`
        : `${hName} and ${aName} wins at this World Cup`,
      headline: noWins
        ? `Neither side has won at this World Cup`
        : lead && H.w !== A.w
          ? `${leadName} carry the better record`
          : leadName
            ? `Level on wins — ${leadName} ahead on goal difference`
            : `Nothing between them on the table`,
      text: `${hName} are ${line(H)}. ${aName} are ${line(A)}.` +
        (best && best.drew ? ` ${aName}'s best was holding ${best.opponent} ${best.for}-${best.against}.` : ''),
    })
  }

  // ── Penalty corners: volume is not the same as threat ────────────────────
  const hConv = pct(H.pcGoals, H.pcWon), aConv = pct(A.pcGoals, A.pcWon)
  if (H.pcWon >= 3 && A.pcWon >= 3 && hConv != null && aConv != null) {
    const volume = H.pcWon >= A.pcWon ? H : A
    const sharper = hConv >= aConv ? H : A
    const flip = volume.code !== sharper.code
    const nm = c => (c === hCode ? hName : aName)
    cards.push({
      kind: 'pc', label: 'PC threat', tone: 'warn',
      stat: `${sharper.pcGoals}/${sharper.pcWon}`,
      statLabel: `${nm(sharper.code)} penalty corners converted in this World Cup`,
      headline: flip
        ? `${nm(volume.code)} win more corners, ${nm(sharper.code)} score more from them`
        : `${nm(sharper.code)} are the set-piece threat`,
      text: `${hName} have won ${H.pcWon} penalty corners here and scored ${H.pcGoals} ` +
        `(${hConv}%). ${aName} have won ${A.pcWon} and scored ${A.pcGoals} (${aConv}%).` +
        (flip ? ` Corner count has not been the same thing as corner danger in this fixture.` : ''),
    })
  }

  // ── Discipline ───────────────────────────────────────────────────────────
  const cardsOf = t => t.green + t.yellow + t.red
  if (cardsOf(H) + cardsOf(A) >= 4 && Math.abs(cardsOf(H) - cardsOf(A)) >= 2) {
    const worse = cardsOf(H) > cardsOf(A) ? H : A
    const wName = worse.code === hCode ? hName : aName
    const bits = [
      worse.green ? `${worse.green} green` : null,
      worse.yellow ? `${worse.yellow} yellow` : null,
      worse.red ? `${worse.red} red` : null,
    ].filter(Boolean).join(' and ')
    cards.push({
      kind: 'discipline', label: 'Discipline', tone: 'warn',
      stat: `${cardsOf(worse)}`,
      statLabel: `${wName} cards in this World Cup`,
      headline: `${wName} have spent the most time a man down`,
      text: `${wName} have taken ${bits} — ${cardsOf(worse) - cardsOf(worse === H ? A : H)} more than ` +
        `${worse.code === hCode ? aName : hName}. A yellow is ten minutes off the pitch, and this ` +
        `is the kind of match those minutes decide.`,
    })
  }

  // ── The man to watch ─────────────────────────────────────────────────────
  const top = [...H.topScorers.map(s => ({ ...s, code: hCode })), ...A.topScorers.map(s => ({ ...s, code: aCode }))]
    .sort((x, y) => y.goals - x.goals || y.pc - x.pc)[0]
  if (top && top.goals >= 2) {
    const tName = top.code === hCode ? hName : aName
    cards.push({
      kind: 'danger', label: 'Danger man', tone: 'pos',
      stat: `${top.goals}`,
      statLabel: `${top.name} goals in this World Cup`,
      headline: `${top.name} is the leading scorer in this fixture`,
      text: `${top.goals} goals for ${tName} so far` +
        (top.pc ? `, ${top.pc} of them from penalty corners — stop the set piece and you stop most of his output.` : ` from open play.`),
    })
  }

  // ── When the goals arrive ────────────────────────────────────────────────
  if (H.goals + A.goals >= 6 && H.lateGoals + A.lateGoals >= 2) {
    const late = H.lateGoals + A.lateGoals
    const leader = H.lateGoals >= A.lateGoals ? H : A
    cards.push({
      kind: 'timing', label: 'Fourth quarter', tone: 'neutral',
      stat: `${late}`,
      statLabel: 'goals these two have scored after the 45th minute',
      headline: `This one may not be settled early`,
      text: `${leader.code === hCode ? hName : aName} have scored ${leader.lateGoals} of their ` +
        `${leader.goals} goals in the final quarter. Neither side has been safe with a lead here.`,
    })
  }

  // ── The pick, argued from the evidence above ─────────────────────────────
  if (pred?.status === 'ready') {
    const pH = Math.round(pred.reg.home * 100)
    const pD = Math.round(pred.reg.draw * 100)
    const pA = Math.round(pred.reg.away * 100)
    const favCode = pH >= pA ? hCode : aCode
    const favName = favCode === hCode ? hName : aName
    const dogName = favCode === hCode ? aName : hName
    const F = favCode === hCode ? H : A
    const U = favCode === hCode ? A : H

    const why = []
    if (F.w > U.w) why.push(`${favName} have won ${F.w} here to ${U.w}`)
    if (F.gf - F.ga > U.gf - U.ga) why.push(`a goal difference of ${F.gf - F.ga >= 0 ? '+' : ''}${F.gf - F.ga} against ${U.gf - U.ga >= 0 ? '+' : ''}${U.gf - U.ga}`)
    const fTop = F.topScorers[0]
    if (fTop && fTop.goals >= 2) why.push(`${fTop.name} carrying ${fTop.goals} goals`)

    const against = []
    const uConv = pct(U.pcGoals, U.pcWon), fConv = pct(F.pcGoals, F.pcWon)
    if (uConv != null && fConv != null && uConv > fConv && U.pcGoals >= 2) {
      against.push(`${dogName} have been the sharper side at a penalty corner (${U.pcGoals} from ${U.pcWon}, against ${F.pcGoals} from ${F.pcWon})`)
    }
    const upset = U.results.find(r => r.drew || r.won)
    if (upset) against.push(`they already ${upset.won ? 'beat' : 'held'} ${upset.opponent} ${upset.for}-${upset.against} here`)
    if (U.lateGoals >= 2) against.push(`and ${U.lateGoals} of their goals have come in the final quarter`)

    cards.push({
      kind: 'prediction', label: 'Prediction', tone: 'brand',
      stat: `${Math.max(pH, pA)}%`,
      statLabel: `${favName} to win in regulation`,
      headline: against.length
        ? `${favName} favoured — but ${dogName} have a route`
        : `${favName} favoured`,
      text: `The model makes it ${pH}/${pD}/${pA} — ${hName} win, draw, ${aName} win. ` +
        (why.length ? `Weighing for ${favName}: ${why.join('; ')}. ` : '') +
        (against.length ? `The case against: ${against.join('; ')}.` : ''),
      // Shown as the model's own reasoning, so a reader can weigh it themselves.
      evidence: { pH, pD, pA, favourite: favCode },
    })
  }

  return cards
}
