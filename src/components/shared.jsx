import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { formatProbability } from '../engine/probability.js'

export function Skeleton({ h = 100, className = '' }) {
  return <div className={`skeleton ${className}`} style={{ height: h }} />
}

export function SectionHead({ title, sub, to, toLabel = 'View all →' }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      {sub && <span className="text-xs text-pitch-400">{sub}</span>}
      {to && <Link to={to} className="text-xs font-medium text-brand hover:underline">{toLabel}</Link>}
    </div>
  )
}

// Only three labels exist, and only six teams carry one — see engine/tiers.js.
// A tag on every crest labels nothing, and "outsider" beside a team is a
// judgement we have no need to publish.
const TIERS = {
  favourite:  { label: '⭐ Favourite',  cls: 'bg-brand/15 text-brand' },
  dark_horse: { label: '♞ Dark Horse',  cls: 'bg-violet-400/10 text-violet-400' },
  underdog:   { label: '⚡ Underdog',   cls: 'bg-amber-400/10 text-amber-400' },
  out:        { label: 'Eliminated',    cls: 'bg-pitch-700 text-pitch-400' },
}

/** Renders nothing when a team has not earned a label. */
export function TierBadge({ tier }) {
  const t = TIERS[tier]
  if (!t) return null
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.cls}`}>
      {t.label}
    </span>
  )
}

export function StandingsTable({ standings, highlight = 2 }) {
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/5 font-mono text-[10px] uppercase tracking-wider text-pitch-400">
            <th className="py-2 pl-2 text-left">Team</th>
            <th className="px-1.5 py-2 text-center">P</th>
            <th className="px-1.5 py-2 text-center">W</th>
            <th className="px-1.5 py-2 text-center">D</th>
            <th className="px-1.5 py-2 text-center">L</th>
            <th className="px-1.5 py-2 text-center">GF</th>
            <th className="px-1.5 py-2 text-center">GA</th>
            <th className="px-1.5 py-2 text-center">GD</th>
            <th className="px-1.5 py-2 text-center">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((r, i) => {
            const t = byCode.get(r.team)
            return (
              <tr key={r.team}
                className={`border-b border-white/5 last:border-0 ${i < highlight ? 'border-l-2 border-l-live' : ''}`}>
                <td className="py-2.5 pl-2">
                  <Link to={`/teams/${r.team}`} className="flex items-center gap-2 hover:text-brand">
                    <span className="w-4 text-center font-mono text-[10px] text-pitch-400">{i + 1}</span>
                    <span className="text-base">{t?.flag ?? '🏑'}</span>
                    <span className="font-semibold">{t?.name ?? r.team}</span>
                    {t?.host && <span className="text-[10px] text-pitch-400">(H)</span>}
                  </Link>
                </td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.played}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.w}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.d}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.l}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.gf}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.ga}</td>
                <td className="px-1.5 text-center font-mono text-pitch-300">{r.gd >= 0 ? `+${r.gd}` : r.gd}</td>
                <td className="px-1.5 text-center font-mono font-bold text-brand">{r.pts}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-pitch-400">
        <span className="inline-block h-2 w-2 rounded-sm bg-live" /> Top 2 into the Stage-2 championship pools (E/F)
      </div>
    </div>
  )
}

/**
 * Champion-probability row. `entry` is a canonical snapshot entry from
 * engine/probability.js — this component never computes or rounds a
 * probability of its own. `lead` is the leader's probability, used only to
 * scale the bar.
 */
export function WinProbBar({ team, entry, lead, out, tierOf }) {
  const champion = entry?.champion ?? 0
  const width = lead > 0 ? Math.max(champion > 0 ? 2 : 0, (champion / lead) * 100) : 0
  return (
    <Link to={`/teams/${team.code}`}
      className={`flex items-center gap-3 rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-colors hover:border-brand/20 ${out ? 'opacity-60' : ''}`}>
      <span className="shrink-0 text-2xl">{team.flag}</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-bold ${out ? 'line-through' : ''}`}>{team.name}</div>
        <div className="font-mono text-[10px] text-pitch-400">FIH #{team.fihRank} · Pool {team.pool}</div>
        <TierBadge tier={out ? 'out' : tierOf?.(entry?.teamId)} />
      </div>
      <div className="w-28 shrink-0 sm:w-40">
        <div className="h-1.5 overflow-hidden rounded-full bg-pitch-600">
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-deep transition-all duration-700"
            style={{ width: `${width}%` }} />
        </div>
        <div className={`mt-1 text-right font-mono text-xs font-bold ${out ? 'text-pitch-400' : 'text-brand'}`}>
          {formatProbability(champion)}
        </div>
      </div>
    </Link>
  )
}
