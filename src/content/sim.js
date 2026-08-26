// Hockey.AI — the AI simulation's fixed labels.
//
// Everything that used to live here — two hand-written team sheets, a chosen
// scoreline, and four cards of prose about the players in them — is now
// computed in `src/engine/sim.js` from the tournament's own record. What is
// left is what a model cannot derive: where the exhibition is imagined to be
// played, and what the two sides are called.

export const SIM_ID = 'sim_best_xi_vs_rising_xi'

export const SIM_MATCH = {
  simId: SIM_ID,
  statusChip: 'AI SIM',
  venueLabel: 'Wagener Stadion, Amstelveen (simulated)',
  homeLabel: "Tournament's Best XI",
  homeShort: 'BEST',
  homeCoach: 'Oracle',
  awayLabel: 'Rising Stars XI',
  awayShort: 'RISE',
  awayCoach: 'Oracle',
}
