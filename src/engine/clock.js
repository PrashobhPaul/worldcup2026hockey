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

// Main clock state derivation (Soccer.AI: w())
export function deriveClock(match, nowMs = Date.now()) {
  if (!match) return { phase: 'NS', minute: null, display: '–', kind: 'PRE' }

  let phase = match.livePhase
    ? normalizePhase(match.livePhase, match.liveMinute)
    : match.status === 'completed' ? 'FT'
    : match.status === 'live' ? 'Q1'
    : 'NS'

  if (phase === 'NS' && match.status !== 'completed' && typeof match.kickoffUtc === 'number' && nowMs >= match.kickoffUtc && match.status === 'live') {
    phase = 'Q1'
  }

  if (phase === 'NS')  return { phase, minute: null, display: '–', kind: 'PRE' }
  if (phase === 'QB1') return { phase, minute: 15, display: 'End Q1', kind: 'BREAK' }
  if (phase === 'HT')  return { phase, minute: 30, display: 'HT', kind: 'HT' }
  if (phase === 'QB3') return { phase, minute: 45, display: 'End Q3', kind: 'BREAK' }
  if (phase === 'SO')  return { phase, minute: null, display: 'SO', kind: 'SO' }
  if (phase === 'FT') {
    const hasSO = match.shootout && match.shootout.home !== match.shootout.away
    return { phase, minute: 60, display: hasSO ? 'FT (SO)' : 'FT', kind: hasSO ? 'FT_SO' : 'FT' }
  }

  // Playing quarter — derive from anchor
  const anchor = match[PHASES[phase].anchorKey]
  if (anchor == null) {
    // No anchor: fall back to provider minute if present
    if (match.liveMinute != null) {
      return { phase, minute: match.liveMinute, display: `${match.liveMinute}'`, kind: 'LIVE' }
    }
    return { phase, minute: null, display: phase, kind: 'RAW' }
  }
  const clock = minuteFromAnchor(phase, anchor, nowMs)
  return { phase, minute: clock.totalMinute, display: clock.display, kind: 'LIVE' }
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
