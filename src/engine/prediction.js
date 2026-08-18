// Hockey.AI — Oracle prediction engine
// Direct port of Soccer.AI's derive-prediction module, adapted for FIH rules:
// pool matches can draw; knockout matches level after 60' go to shootout (SO).

// Single-match knockouts level after 60' go to a shootout. Stage-2 group
// matches ('stage2') can draw, like the Stage-1 pools, so they are NOT here.
const KNOCKOUT_PHASES = new Set(['semi-final', 'bronze-final', 'gold-final', 'classification'])

export function isKnockout(match) {
  return KNOCKOUT_PHASES.has(match.phase)
}

// Regulation score (subtract shootout goals if a shootout happened)
export function regulationScore(match) {
  const s = match.score || {}
  const so = match.shootout
  if (so && typeof so.home === 'number' && typeof so.away === 'number' && so.home !== so.away) {
    // score.home/away include the shootout "1 goal" convention? FIH records SO separately —
    // our data keeps score = regulation/FT score and shootout separate, so pass through.
    return { h: s.home ?? 0, a: s.away ?? 0 }
  }
  return { h: s.home ?? 0, a: s.away ?? 0 }
}

// Final result descriptor: winner side, decidedBy FT | SO
export function matchResult(match) {
  if (match.status !== 'completed') {
    return { winnerSide: null, winnerTeam: null, loserTeam: null, decidedBy: null }
  }
  const so = match.shootout
  if (so && typeof so.home === 'number' && typeof so.away === 'number' && so.home !== so.away) {
    const homeWins = so.home > so.away
    return {
      winnerSide: homeWins ? 'H' : 'A',
      winnerTeam: homeWins ? match.home : match.away,
      loserTeam: homeWins ? match.away : match.home,
      decidedBy: 'SO',
    }
  }
  const r = regulationScore(match)
  if (r.h > r.a) return { winnerSide: 'H', winnerTeam: match.home, loserTeam: match.away, decidedBy: 'FT' }
  if (r.a > r.h) return { winnerSide: 'A', winnerTeam: match.away, loserTeam: match.home, decidedBy: 'FT' }
  return { winnerSide: 'D', winnerTeam: null, loserTeam: null, decidedBy: 'FT' }
}

// Display line for a finished match ("FT", "FT (SO)", "NED win 3-1 on shootout")
export function resultDisplay(match, homeTeam, awayTeam) {
  const so = match.shootout
  const hasSO = !!so && so.home !== so.away
  const reg = regulationScore(match)
  let decisiveLine = null
  if (hasSO) {
    const winnerName = so.home > so.away
      ? (homeTeam?.name ?? match.home)
      : (awayTeam?.name ?? match.away)
    decisiveLine = `${winnerName} win ${Math.max(so.home, so.away)}-${Math.min(so.home, so.away)} on shootout`
  }
  return {
    homeReg: reg.h,
    awayReg: reg.a,
    homeSO: hasSO ? so.home : null,
    awaySO: hasSO ? so.away : null,
    statusTag: hasSO ? 'FT (SO)' : 'FT',
    decisiveLine,
  }
}

// split draws evenly for knockout advance probability (Soccer.AI: k())
export function advanceSplit(reg) {
  return { home: reg.home + reg.draw / 2, away: reg.away + reg.draw / 2 }
}

// The core derive function (Soccer.AI: b())
// row = prediction record {p_home_win, p_draw, p_away_win, pick, pick_confidence}
export function derivePrediction({ match, row }) {
  const knockout = isKnockout(match)

  if (!row || row.p_home_win == null) {
    return {
      status: 'computing', isKnockout: knockout,
      reg: { home: 0, draw: 0, away: 0 },
      pick: null, confidence: 0, pickConfidencePct: 0,
    }
  }

  const h = Number(row.p_home_win)
  const d = Number(row.p_draw)
  const a = Number(row.p_away_win)
  const sum = h + d + a || 1
  const reg = { home: h / sum, draw: d / sum, away: a / sum }

  if (!knockout) {
    const pick =
      row.pick === 'HOME' || row.pick === 'H' ? 'HOME' :
      row.pick === 'AWAY' || row.pick === 'A' ? 'AWAY' :
      row.pick === 'DRAW' || row.pick === 'D' ? 'DRAW' :
      reg.home >= reg.draw && reg.home >= reg.away ? 'HOME' :
      reg.away >= reg.draw ? 'AWAY' : 'DRAW'
    const pickProb = pick === 'HOME' ? reg.home : pick === 'AWAY' ? reg.away : reg.draw
    const confidence = Number(row.pick_confidence ?? pickProb)
    return {
      status: 'ready', isKnockout: false, reg,
      pick, confidence, pickConfidencePct: Math.round(confidence * 100),
    }
  }

  // Knockout: someone must advance — draws resolve via shootout
  const adv = advanceSplit(reg)
  const pick = adv.home >= adv.away ? 'HOME' : 'AWAY'
  const confidence = pick === 'HOME' ? adv.home : adv.away
  return {
    status: 'ready', isKnockout: true, reg,
    advance: adv,
    paths: { regulation: 1 - reg.draw, shootout: reg.draw },
    pick, confidence, pickConfidencePct: Math.round(confidence * 100),
  }
}

// Grade a prediction against a finished match
export function gradePrediction(match, row) {
  if (!row || match.status !== 'completed') return 'pending'
  const res = matchResult(match)
  const derived = derivePrediction({ match, row })
  if (!derived.pick) return 'pending'
  if (res.winnerSide === 'D') return derived.pick === 'DRAW' ? 'correct' : 'wrong'
  if (res.winnerSide === 'H') return derived.pick === 'HOME' ? 'correct' : 'wrong'
  if (res.winnerSide === 'A') return derived.pick === 'AWAY' ? 'correct' : 'wrong'
  return 'pending'
}

// One active pick per match: a superseded row is a retained erratum (the
// pick was revised before push-back when its rank inputs were corrected) and
// must never be shown as current or graded.
export const activePredictions = predictions => predictions.filter(p => !p.superseded)

// Oracle running record across all predictions (header chip: 🏑 5/24 · 71%)
export function oracleRecord(matches, predictions) {
  const bySource = activePredictions(predictions).filter(p => p.source === 'oracle-v1' || !p.source)
  let graded = 0, correct = 0
  for (const p of bySource) {
    const m = matches.find(x => x.id === p.matchId)
    if (!m || m.status !== 'completed') continue
    graded++
    if (gradePrediction(m, p) === 'correct') correct++
  }
  return {
    graded, correct,
    total: bySource.length,
    accuracyPct: graded ? Math.round((correct / graded) * 100) : null,
  }
}
