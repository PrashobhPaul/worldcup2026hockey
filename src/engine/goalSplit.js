// Hockey.AI — how a player's goals were scored.
//
// The FIH splits a goal three ways for this competition — field, penalty
// corner, penalty stroke — and publishes the split per player. Every surface
// here used to read "goals minus corners" as open play, which counted the
// tournament's eleven strokes as field goals and told a drag flicker who
// converted a stroke that he had scored from open play.
//
// The record carries all three. `fg_scored` is the field goals; the fallback
// exists only for a record written before the split was published, and it
// subtracts the stroke as well.
export function fieldGoals(p) {
  if (p?.fg_scored != null) return p.fg_scored
  return Math.max(0, (p?.goals ?? 0) - (p?.pc_scored ?? 0) - (p?.ps_scored ?? 0))
}

export const GOAL_METHODS = [
  { key: 'field', short: 'F', label: 'Field goals', of: fieldGoals },
  { key: 'corner', short: 'PC', label: 'Penalty corners', of: p => p?.pc_scored ?? 0 },
  { key: 'stroke', short: 'PS', label: 'Penalty strokes', of: p => p?.ps_scored ?? 0 },
]

// Only the methods a player actually scored by: "6 PC" says more about
// Harmanpreet Singh than "0F · 6PC · 0PS" does.
export function goalSplit(p) {
  return GOAL_METHODS.map(m => ({ ...m, value: m.of(p) })).filter(m => m.value > 0)
}

export function splitText(p) {
  const parts = goalSplit(p)
  return parts.length ? parts.map(m => `${m.value} ${m.short}`).join(' · ') : null
}
