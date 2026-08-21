// Hockey.AI — Live match clock
// Hockey adaptation of Soccer.AI's anchor-based minute engine.
// FIH format: 4 quarters × 15', 2' breaks after Q1/Q3, 10' half-time, shootout if level (KO).

export const PHASES = {
  Q1: { start: 0,  cap: 15, anchorKey: 'q1StartUtc' },
  Q2: { start: 15, cap: 30, anchorKey: 'q2StartUtc' },
  Q3: { start: 30, cap: 45, anchorKey: 'q3StartUtc' },
  Q4: { start: 45, cap: 60, anchorKey: 'q4StartUtc' },
}

const PHASE_ORDER = { NS: 0, Q1: 1, QB1: 2, Q2: 3, HT: 4, Q3: 5, QB3: 6, Q4: 7, SO: 8, FT: 9 }

// Same window the data pipeline uses (MATCH_DURATION_MIN): push-back to the
// point where any hockey match is over, breaks and stoppages included.
export const MATCH_WINDOW_MIN = 105

export function isPlayingPhase(p) {
  return p === 'Q1' || p === 'Q2' || p === 'Q3' || p === 'Q4'
}

export function phaseForMinute(min) {
  if (min > 45) return 'Q4'
  if (min > 30) return 'Q3'
  if (min > 15) return 'Q2'
  return 'Q1'
}

// Normalize provider status strings to our phases
export function normalizePhase(raw, minute) {
  const s = String(raw ?? '').toUpperCase()
  if (s === 'Q1' || s === '1Q') return 'Q1'
  if (s === 'Q2' || s === '2Q') return 'Q2'
  if (s === 'Q3' || s === '3Q') return 'Q3'
  if (s === 'Q4' || s === '4Q') return 'Q4'
  if (s === 'QB1' || s === 'QT1') return 'QB1'
  if (s === 'HT' || s === 'PAUSED') return 'HT'
  if (s === 'QB3' || s === 'QT3') return 'QB3'
  if (s === 'SO' || s === 'SHOOTOUT' || s === 'PENS') return 'SO'
  if (s === 'FT' || s === 'FINISHED' || s === 'COMPLETED') return 'FT'
  if (s === 'LIVE' || s === 'IN_PLAY') return minute == null ? 'Q1' : phaseForMinute(minute)
  return 'NS'
}

function minuteFromAnchor(phase, anchorMs, nowMs) {
  const cfg = PHASES[phase]
  const elapsedSec = Math.max(0, Math.floor((nowMs - anchorMs) / 1000))
  const totalSec = cfg.start * 60 + elapsedSec
  const capSec = cfg.cap * 60
  if (totalSec <= capSec) {
    const m = Math.floor(totalSec / 60)
    return { totalMinute: m, display: `${m}'`, clamped: false }
  }
  const over = Math.floor((totalSec - capSec) / 60)
  return { totalMinute: cfg.cap + over, display: `${cfg.cap}+${over}'`, clamped: true }
}

function ftState(match) {
  const hasSO = match.shootout && match.shootout.home !== match.shootout.away
  return { phase: 'FT', minute: 60, display: hasSO ? 'FT (SO)' : 'FT', kind: hasSO ? 'FT_SO' : 'FT' }
}

// The FIH match-day script, in wall-clock minutes from push-back:
// Q1 0–15, 2' break, Q2 17–32, 10' half-time, Q3 42–57, 2' break, Q4 from 59.
// [phase, wallFrom, wallTo, gameMinuteAtWallFrom] — null base = a break.
const EST_SEGMENTS = [
  ['Q1',  0,  15, 0],
  ['QB1', 15, 17, null],
  ['Q2',  17, 32, 15],
  ['HT',  32, 42, null],
  ['Q3',  42, 57, 30],
  ['QB3', 57, 59, null],
  ['Q4',  59, MATCH_WINDOW_MIN, 45],
]

function estimateFromKickoff(elapsedMin) {
  for (const [phase, from, to, base] of EST_SEGMENTS) {
    if (elapsedMin >= to) continue
    if (base == null) {
      if (phase === 'HT') return { phase, minute: 30, display: 'HT', kind: 'HT', estimated: true }
      const minute = phase === 'QB1' ? 15 : 45
      return { phase, minute, display: phase === 'QB1' ? 'End Q1' : 'End Q3', kind: 'BREAK', estimated: true }
    }
    // Q4 runs long in wall time (stoppages, referrals) — the game minute caps at 60.
    const minute = Math.min(60, Math.floor(base + (elapsedMin - from)))
    return { phase, minute, display: `~${minute}'`, kind: 'EST', estimated: true }
  }
  return { phase: 'FT', minute: 60, display: 'FT', kind: 'FT_WAIT', estimated: true }
}

// Main clock state derivation (Soccer.AI: w())
export function deriveClock(match, nowMs = Date.now()) {
  if (!match) return { phase: 'NS', minute: null, display: '–', kind: 'PRE' }

  if (match.status === 'completed') return ftState(match)

  // A provider phase, when we have one, always outranks the estimate.
  if (match.livePhase) {
    const phase = normalizePhase(match.livePhase, match.liveMinute)
    if (phase === 'QB1') return { phase, minute: 15, display: 'End Q1', kind: 'BREAK' }
    if (phase === 'HT')  return { phase, minute: 30, display: 'HT', kind: 'HT' }
    if (phase === 'QB3') return { phase, minute: 45, display: 'End Q3', kind: 'BREAK' }
    if (phase === 'SO')  return { phase, minute: null, display: 'SO', kind: 'SO' }
    if (phase === 'FT')  return ftState(match)
    if (isPlayingPhase(phase)) {
      const anchor = match[PHASES[phase].anchorKey]
      if (anchor != null) {
        const clock = minuteFromAnchor(phase, anchor, nowMs)
        return { phase, minute: clock.totalMinute, display: clock.display, kind: 'LIVE' }
      }
      if (match.liveMinute != null) {
        return { phase, minute: match.liveMinute, display: `${match.liveMinute}'`, kind: 'LIVE' }
      }
      return { phase, minute: null, display: phase, kind: 'RAW' }
    }
  }

  // No provider clock at all — but the push-back time is known, so the
  // schedule estimates the quarter. Shown with a ~ so it never reads as an
  // official clock, and past the window it says FT and waits for the score
  // instead of pretending Q1 forever.
  const ko = typeof match.kickoffUtc === 'number' ? match.kickoffUtc : null
  const underway = match.status === 'live' || (ko != null && nowMs >= ko)
  if (!underway) return { phase: 'NS', minute: null, display: '–', kind: 'PRE' }
  if (ko == null || nowMs < ko) return { phase: 'Q1', minute: null, display: 'LIVE', kind: 'RAW' }
  return estimateFromKickoff((nowMs - ko) / 60000)
}

// True while the match is actually in progress (estimated or provider-fed).
// FT_WAIT is not live: the game is over, only the official score is missing.
export function isLiveClock(clock) {
  return clock.kind === 'LIVE' || clock.kind === 'EST' || clock.kind === 'BREAK'
      || clock.kind === 'HT' || clock.kind === 'SO' || clock.kind === 'RAW'
}

export function phaseLabel(phase) {
  switch (phase) {
    case 'NS': return 'Push-back'
    case 'Q1': return '1st quarter'
    case 'QB1': return 'Quarter break'
    case 'Q2': return '2nd quarter'
    case 'HT': return 'Half-time'
    case 'Q3': return '3rd quarter'
    case 'QB3': return 'Quarter break'
    case 'Q4': return '4th quarter'
    case 'SO': return 'Shootout'
    case 'FT': return 'Full-time'
    default: return phase
  }
}

export { PHASE_ORDER }
