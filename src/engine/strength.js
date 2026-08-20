// Hockey.AI — team strength & match probability model
// Client-side port of Soccer.AI's Elo + Poisson engine, tuned for FIH hockey:
// higher scoring (~5 goals/match), no extra time — level knockouts go straight
// to a shootout. Fully deterministic: same inputs always give the same numbers.

export const MODEL_PARAMS = {
  ratingBase: 1800,
  rankSlope: 28,        // rating points lost per FIH ranking place
  winProbSlope: 6,      // rating points per % of pre-tournament title probability
  hostBoost: 35,        // NED/BEL home-crowd bump
  supremacyDivisor: 150, // rating gap -> expected goal difference
  totalGoalsBase: 5.2,  // FIH World Cup average total goals
  maxGoals: 10,         // Poisson matrix cap per side
  shootoutSlope: 3000,  // rating gap -> shootout edge
  nSims: 4000,
  rngSeed: 20260815,
}

// How a side is playing in THIS tournament, as a rating adjustment.
//
// Mirrors form_delta() in scripts/update_data.py — same weights, same cap, same
// sample-size ramp — so the published pick and the simulation never disagree
// about what a team's week is worth. The pipeline writes the aggregates onto
// each team (`form`), rather than either side recomputing them, so there is one
// set of numbers to be wrong about.
//
// Expressed in FIH ranking points there, rating points here: the official table
// spans ~91 ranking points per place and this model uses `rankSlope` per place,
// so the two scales convert by that ratio.
const FORM = {
  ppmWeight: 60, gdWeight: 35, cap: 250, fullSample: 3,
  // ranking points -> rating points
  toRating: MODEL_PARAMS.rankSlope / 91,
}

export function formDelta(team) {
  const f = team?.form
  const n = f?.played ?? 0
  if (!n) return 0
  const ppm = ((f.wins ?? 0) * 3 + (f.draws ?? 0)) / n
  const gdpm = Math.max(-3, Math.min(3, ((f.gf ?? 0) - (f.ga ?? 0)) / n))
  const raw = FORM.ppmWeight * (ppm - 1.5) + FORM.gdWeight * gdpm
  const capped = Math.max(-FORM.cap, Math.min(FORM.cap, raw))
  return capped * (Math.min(n, FORM.fullSample) / FORM.fullSample) * FORM.toRating
}

export function teamRating(team) {
  if (!team) return MODEL_PARAMS.ratingBase - MODEL_PARAMS.rankSlope * 12
  const rank = team.fihRank ?? team.fih_rank ?? 12
  const winProb = team.winProb ?? team.win_prob ?? 0
  return MODEL_PARAMS.ratingBase
    - MODEL_PARAMS.rankSlope * rank
    + MODEL_PARAMS.winProbSlope * winProb
    + (team.host ? MODEL_PARAMS.hostBoost : 0)
    // Current ranking sets the base; this tournament moves it, bounded.
    + formDelta(team)
}

function poissonPmf(lambda, max) {
  const pmf = new Array(max + 1)
  let p = Math.exp(-lambda)
  pmf[0] = p
  for (let k = 1; k <= max; k++) { p *= lambda / k; pmf[k] = p }
  return pmf
}

export function goalRates(ratingH, ratingA) {
  const sup = (ratingH - ratingA) / MODEL_PARAMS.supremacyDivisor
  return {
    lambdaH: Math.max(0.4, (MODEL_PARAMS.totalGoalsBase + sup) / 2),
    lambdaA: Math.max(0.4, (MODEL_PARAMS.totalGoalsBase - sup) / 2),
  }
}

// Regulation (60') outcome probabilities from two team ratings.
export function matchProbabilities(ratingH, ratingA) {
  const { lambdaH, lambdaA } = goalRates(ratingH, ratingA)
  const max = MODEL_PARAMS.maxGoals
  const ph = poissonPmf(lambdaH, max)
  const pa = poissonPmf(lambdaA, max)
  let home = 0, draw = 0, away = 0
  let bestP = -1, projH = 0, projA = 0
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const p = ph[h] * pa[a]
      if (h > a) home += p
      else if (h < a) away += p
      else draw += p
      if (p > bestP) { bestP = p; projH = h; projA = a }
    }
  }
  const sum = home + draw + away
  return {
    home: home / sum, draw: draw / sum, away: away / sum,
    lambdaH, lambdaA, projHomeGoals: projH, projAwayGoals: projA,
  }
}

// Knockout resolution: FIH rules — level after 60' goes straight to shootout.
export function resolveKnockoutTie(ratingH, ratingA) {
  const reg = matchProbabilities(ratingH, ratingA)
  const edge = Math.max(-0.06, Math.min(0.06, (ratingH - ratingA) / MODEL_PARAMS.shootoutSlope))
  const soHome = 0.5 + edge
  const pHomeAdvance = reg.home + reg.draw * soHome
  return {
    reg,
    homeWinInReg: reg.home,
    homeWinOnShootout: reg.draw * soHome,
    awayWinInReg: reg.away,
    awayWinOnShootout: reg.draw * (1 - soHome),
    shootoutHomeEdge: soHome,
    pHomeAdvance,
    pAwayAdvance: 1 - pHomeAdvance,
  }
}

// Deterministic PRNG (mulberry32) — same seed, same tournament.
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function samplePoisson(lambda, rng) {
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rng() } while (p > L && k < 25)
  return k - 1
}
