import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from './shared'
import { editions, honours } from '../engine/worldCupHistory.js'

// Every Men's World Cup, and where this one sits in that line.
//
// Two things on this page come from different places and the page says which:
// the fifteen past editions are a static record assembled from public sources,
// and 2026 is derived live from this app's own fifty match records. The second
// is the only edition this app can speak for first-hand, so it is the only one
// not stored — see engine/worldCupHistory.js.
//
// The honours table is counted from the rows above it, never kept alongside
// them. A stored tally is one edition away from disagreeing with the table a
// reader can see, and that disagreement is exactly the kind this app exists to
// not have.

function MedalRow({ e, byCode }) {
  const flag = code => byCode.get(code)?.flag ?? ''
  return (
    <tr className={e.current ? 'bg-brand/5' : undefined}>
      <td className="py-2 pr-2 font-mono text-xs font-bold text-pitch-300">
        {e.year}
        {e.current && <span className="ml-1 text-brand">•</span>}
      </td>
      <td className="py-2 pr-2">
        <div className="truncate text-xs text-pitch-300">{e.city}</div>
        <div className="font-mono text-[10px] text-pitch-500">{e.country}</div>
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          <span>{flag(e.championCode)}</span>
          <span className="truncate text-xs font-bold">{e.champion}</span>
        </div>
        {e.final && <div className="font-mono text-[10px] text-pitch-500">{e.final}</div>}
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          <span>{flag(e.runnerUpCode)}</span>
          <span className="truncate text-xs text-pitch-300">{e.runnerUp}</span>
        </div>
      </td>
      <td className="py-2">
        <div className="flex items-center gap-1.5">
          <span>{flag(e.thirdCode)}</span>
          <span className="truncate text-xs text-pitch-300">{e.third}</span>
        </div>
      </td>
    </tr>
  )
}

export default function HistoryView({ byCode }) {
  const doc = useLiveQuery(() => db.meta.get('history'), [])
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])

  const rows = useMemo(() => {
    if (!doc) return []
    const nameOf = code => teams.find(t => t.code === code)?.name ?? code
    return editions(doc, matches, {
      year: 2026, city: 'Wavre & Amstelveen', country: 'Belgium & Netherlands', nameOf,
    }).slice().reverse()
  }, [doc, matches, teams])

  const table = useMemo(() => honours(rows), [rows])

  if (doc === undefined) return <Skeleton h={400} />
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
        The roll of past World Cups is not available in this build.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/10 to-pitch-900 p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">
          History · {rows.length} editions
        </p>
        <h2 className="mt-1 font-display text-xl font-bold">🏆 Every World Cup</h2>
        <p className="mt-2 text-xs leading-relaxed text-pitch-300">
          Newest first. The 2026 row is marked <span className="text-brand">•</span> and is not
          stored anywhere — it is read from this app&apos;s own match record, the one edition it
          holds first-hand.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/5 bg-pitch-800 p-4">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-white/5 text-left font-mono text-[10px] uppercase tracking-widest text-pitch-400">
              <th className="pb-2 pr-2 font-semibold">Year</th>
              <th className="pb-2 pr-2 font-semibold">Host</th>
              <th className="pb-2 pr-2 font-semibold">🥇 Champion</th>
              <th className="pb-2 pr-2 font-semibold">🥈 Runner-up</th>
              <th className="pb-2 font-semibold">🥉 Third</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map(e => <MedalRow key={e.year} e={e} byCode={byCode} />)}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-1 font-display text-base font-semibold">Honours</h3>
        <p className="mb-3 text-[11px] text-pitch-400">
          Counted from the table above, including 2026 — never kept separately.
        </p>
        <ol className="space-y-1.5">
          {table.map((r, i) => (
            <li key={r.name} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-brand/5' : ''}`}>
              <span className="w-5 text-center font-mono text-xs font-bold text-pitch-400">{i + 1}</span>
              <span className="text-base">{byCode.get(r.code)?.flag ?? '🏑'}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
              <span className="font-mono text-xs text-pitch-300">
                <span className="font-bold text-brand">{r.gold}</span>
                <span className="text-pitch-500"> · {r.silver} · {r.bronze}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 font-mono text-[10px] text-pitch-500">gold · silver · bronze</p>
      </div>

      {/* Where this came from, in the app and not only in the repository. The
          rest of this app cites the FIH because it read the FIH; these fifteen
          rows did not, and a reader is entitled to know which is which. */}
      {doc.provenance?.note && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3.5 text-[11px] leading-relaxed text-pitch-300">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-amber-400">
            On sourcing ·{' '}
          </span>
          {doc.provenance.note}
        </p>
      )}
    </div>
  )
}
