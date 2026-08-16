// Hockey.AI — frozen AI simulation content
// Port of Soccer.AI's wc26_sim_* operator tables: an Oracle-simulated
// exhibition, not a fixture. Presentation-only — no clock, no live state.

export const SIM_ID = 'sim_best_xi_vs_rising_xi'

export const SIM_MATCH = {
  simId: SIM_ID,
  statusChip: 'AI SIM',
  venueLabel: 'Wagener Stadion, Amstelveen (simulated)',
  homeLabel: "Tournament's Best XI",
  homeShort: 'BEST',
  homeFormation: '4-3-3',
  homeCoach: 'Oracle',
  awayLabel: 'Rising Stars XI',
  awayShort: 'RISE',
  awayFormation: '3-4-3',
  awayCoach: 'Oracle',
  result: { home: 3, away: 2, decider: 'FT', note: 'Best XI 3–2 · decided in regulation' },
}

// pos: GK | DF | MF | FW · nat = team code for the flag
export const SIM_LINEUPS = {
  home: [
    { pos: 'GK', player: 'Vincent Vanasch', nat: 'BEL' },
    { pos: 'DF', player: 'Harmanpreet Singh', nat: 'IND' },
    { pos: 'DF', player: 'Alexander Hendrickx', nat: 'BEL' },
    { pos: 'DF', player: 'Jeremy Hayward', nat: 'AUS' },
    { pos: 'DF', player: 'Victor Charlet', nat: 'FRA' },
    { pos: 'MF', player: 'Aran Zalewski', nat: 'AUS' },
    { pos: 'MF', player: 'Manpreet Singh', nat: 'IND' },
    { pos: 'MF', player: 'Florent van Aubel', nat: 'NED' },
    { pos: 'FW', player: 'Blake Govers', nat: 'AUS' },
    { pos: 'FW', player: 'Thierry Brinkman', nat: 'NED' },
    { pos: 'FW', player: 'Christopher Rühr', nat: 'GER' },
  ],
  away: [
    { pos: 'GK', player: 'Krishan Pathak', nat: 'IND' },
    { pos: 'DF', player: 'Arthur de Sloover', nat: 'BEL' },
    { pos: 'DF', player: 'Cian Doyle', nat: 'IRL' },
    { pos: 'DF', player: 'Adrian Albert', nat: 'MAS' },
    { pos: 'MF', player: 'Lee Morton', nat: 'ENG' },
    { pos: 'MF', player: 'Kosuke Yamada', nat: 'JPN' },
    { pos: 'MF', player: 'Pierre Brichard', nat: 'FRA' },
    { pos: 'MF', player: 'Muhammad Umar Bhutta', nat: 'PAK' },
    { pos: 'FW', player: 'Brad Read', nat: 'NZL' },
    { pos: 'FW', player: 'Ryan Julius', nat: 'RSA' },
    { pos: 'FW', player: 'Rupert Shipperley', nat: 'WAL' },
  ],
}

export const SIM_CARDS = [
  {
    key: 'confidence',
    title: "Tournament's Best XI win",
    value: 71,
    detail: 'Across 4,000 simulated exhibitions the Best XI wins 71% — set-piece superiority ' +
      '(Harmanpreet, Hendrickx and Govers on one battery) overwhelms the Rising Stars’ press in the last twenty minutes.',
  },
  {
    key: 'driver',
    title: 'Penalty-corner battery',
    detail: 'Three of the world’s top five drag flickers in one lineup: the Best XI projects a corner conversion rate no defensive unit in the field survives.',
  },
  {
    key: 'driver',
    title: 'Midfield control',
    detail: 'Zalewski and Manpreet own the outletting lanes; the Rising Stars’ 3-4-3 wins turnovers high but concedes the long transfer behind the wings.',
  },
  {
    key: 'driver',
    title: 'Goalkeeping ceiling',
    detail: 'Vanasch vs Pathak is closer than the field expects — shootout scenarios flip toward the Rising Stars in 44% of level simulations.',
  },
  {
    key: 'insight',
    detail: 'The Rising Stars’ best path is chaos: early green-card pressure, fast re-starts and keeping the corner count under six.',
  },
  {
    key: 'insight',
    detail: 'Expect the Best XI to sit deep for the first quarter — the model has them scoring 62% of their goals after half-time.',
  },
  {
    key: 'disclosure',
    detail: 'This is an Oracle-simulated exhibition, not a real fixture. Lineups are model selections from ' +
      'tournament data; the scoreline is the modal result of 4,000 seeded simulations. No FIH endorsement implied.',
  },
]
