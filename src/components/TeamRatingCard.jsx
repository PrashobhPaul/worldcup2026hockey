import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { DerivedBadge } from './hockeyIcons'

// Hockey.AI — a team's rating, and the components it is made of.
//
// Every figure is a rate per match, never a total: sides reach this stage
// having played different numbers of matches, and a total rewards survival
// rather than performance. The percentile beside each figure is the team's
// rank against the other fifteen on that component.

export function useTeamRatings() {
  return useLiveQuery(() => db.meta.get('teamRatings').catch(() => null), [], null)
}

function Row({ c }) {
  const tone = c.score >= 80 ? 'bg-live' : c.score >= 55 ? 'bg-brand' : 'bg-pitch-500'
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5">
      <span className="truncate text-[11px] text-pitch-300" title={c.unit}>{c.label}</span>
      <span className="font-mono text-[10px] text-pitch-400">
        {c.figure}
        <span className="text-pitch-600"> · {Math.round(c.score)}th</span>
      </span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-pitch-700">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(3, c.score)}%` }} />
      </div>
    </li>
  )
}

export default function TeamRatingCard({ teamCode }) {
  const doc = useTeamRatings()
  const entry = doc?.teams?.[teamCode]
  if (!entry) return null
  const rows = Object.values(entry.components ?? {})

  return (
    <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Team rating</h2>
        <DerivedBadge derived />
      </div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold text-brand">{entry.rating}</span>
        <span className="font-mono text-[10px] text-pitch-400">
          of 100 · {entry.matches} match{entry.matches === 1 ? '' : 'es'}
        </span>
      </div>
      <ul className="space-y-1.5">{rows.map(c => <Row key={c.label} c={c} />)}</ul>
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-pitch-400">
        Hockey.AI&apos;s rating, not an FIH one — a rate per match, ranked against the other fifteen sides.
      </p>
    </section>
  )
}

/**
 * What this tournament says separates two sides — ranked by how much each
 * component actually moves the rating, not by the widest raw gap. A fifty-point
 * gap on a component carrying eight per cent separates two teams less than a
 * twenty-point gap on one carrying a fifth.
 */
export function MatchupEdge({ home, away, byCode }) {
  const doc = useTeamRatings()
  const a = doc?.teams?.[home]
  const b = doc?.teams?.[away]
  if (!a || !b) return null

  const gaps = Object.entries(a.components)
    .map(([key, ca]) => {
      const cb = b.components[key]
      if (!cb) return null
      const gap = Math.abs(ca.score - cb.score)
      return {
        key, label: ca.label, unit: ca.unit,
        homeFigure: ca.figure, awayFigure: cb.figure,
        favours: ca.score > cb.score ? home : cb.score > ca.score ? away : null,
        swing: gap * ca.weight,
      }
    })
    .filter(Boolean)
    .sort((x, y) => y.swing - x.swing)
    .slice(0, 3)

  if (!gaps.length) return null

  return (
    <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold">What separates them</h2>
        <DerivedBadge derived />
      </div>
      <p className="mb-3 font-mono text-[10px] text-pitch-400">
        This tournament only · {a.matches} and {b.matches} matches played
      </p>
      <ul className="space-y-2.5">
        {gaps.map(g => (
          <li key={g.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-pitch-200">{g.label}</span>
              <span className="font-mono text-[10px] text-pitch-400">{g.unit}</span>
            </div>
            <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-[11px]">
              <span className={`text-right ${g.favours === home ? 'font-bold text-live' : 'text-pitch-400'}`}>
                {byCode?.get(home)?.flag ?? home} {g.homeFigure}
              </span>
              <span className="text-pitch-600">vs</span>
              <span className={g.favours === away ? 'font-bold text-live' : 'text-pitch-400'}>
                {g.awayFigure} {byCode?.get(away)?.flag ?? away}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
