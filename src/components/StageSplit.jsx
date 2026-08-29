import { stageRows } from '../engine/prediction'

// The published record, split the way the tournament is played: the pool
// round, the seeded second stage, and the knockouts as one stage of ten —
// the classification places, the semi-finals and the two medal finals.
//
// One component, used by every screen that shows the split, for the same
// reason publishedAccuracy is one function: this app has shipped two records
// of the same model on one screen before, and a breakdown is twice the
// opportunity. The denominators are matches PLAYED, so the knockouts read out
// of eight until the medal finals are played and it becomes ten.
//
// `variant`:
//   'chips'  — a row of bordered cells, for a page with room (Trust, Oracle)
//   'inline' — one line of text, for a header line already in flow (Matches)
export default function StageSplit({ stages, variant = 'chips', className = 'mt-2.5' }) {
  const rows = stageRows(stages)
  if (!rows.length) return null

  if (variant === 'inline') {
    return (
      <span className={className}>
        {rows.map((r, i) => (
          <span key={r.key}>
            {i > 0 && ' · '}
            {r.label} {r.correct}/{r.matches}
          </span>
        ))}
      </span>
    )
  }

  return (
    <div className={`grid gap-2 ${className}`}
         style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map(r => (
        <div key={r.key} className="rounded-lg border border-white/5 bg-pitch-900/40 px-2 py-1.5 text-center">
          <div className="font-mono text-base font-bold text-brand">
            {r.correct}<span className="text-pitch-400">/{r.matches}</span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-pitch-400">{r.label}</div>
        </div>
      ))}
    </div>
  )
}
