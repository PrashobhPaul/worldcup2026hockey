import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { Skeleton } from '../components/shared'

const POSITIONS = ['all', 'Forward', 'Midfielder', 'Defender', 'Goalkeeper']

export default function PlayersPage() {
  const [pos, setPos] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const players = useLiveQuery(() => db.players.toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))

  if (players === undefined) return <Skeleton h={500} />

  const filtered = players.filter(p =>
    (pos === 'all' || p.position === pos) &&
    (teamFilter === 'all' || p.team === teamFilter)
  )

  const scorers = [...players].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals || b.assists - a.assists).slice(0, 5)

  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">👤 Players</h1>
        <p className="mt-1 text-xs text-pitch-400">{players.length} key players tracked · goals, assists, penalty corners, cards</p>
      </div>

      {scorers.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">🥇 Top Scorers</h2>
          <div className="space-y-1.5">
            {scorers.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-pitch-800 px-3.5 py-2.5">
                <span className="w-5 text-center font-mono text-xs font-bold text-brand">{i + 1}</span>
                <span className="text-lg">{byCode.get(p.team)?.flag ?? '🏑'}</span>
                <span className="flex-1 text-sm font-semibold">{p.name}</span>
                <span className="font-mono text-xs text-pitch-300">{p.goals}G · {p.pc_scored} PC</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {POSITIONS.map(p => (
          <button key={p} onClick={() => setPos(p)}
            className={`rounded-md border px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              pos === p ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {p === 'all' ? 'All positions' : p + 's'}
          </button>
        ))}
      </div>
      <div className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setTeamFilter('all')}
          className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold ${teamFilter === 'all' ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'}`}>
          All teams
        </button>
        {teams.sort((a, b) => a.fihRank - b.fihRank).map(t => (
          <button key={t.code} onClick={() => setTeamFilter(t.code)}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-sm ${teamFilter === t.code ? 'border-brand/30 bg-brand/10' : 'border-white/5 bg-pitch-800'}`}>
            {t.flag}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(p => {
          const t = byCode.get(p.team)
          return (
            <div key={p.id} className="rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-colors hover:border-brand/20">
              <div className="flex items-center gap-2">
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[10px] text-pitch-300">#{p.number}</span>
                <span className="flex-1 truncate text-sm font-bold">{p.name}</span>
                {p.is_captain && <span className="text-xs text-brand">Ⓒ</span>}
                {p.fih_star && <span className="text-xs">⭐</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Link to={`/teams/${p.team}`} className="text-base">{t?.flag ?? '🏑'}</Link>
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-pitch-300">{p.position}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[10px]">
                {p.ai_rating != null && (
                  <span className="rounded bg-live/10 px-1.5 py-0.5 font-bold text-live">AI {p.ai_rating}</span>
                )}
                <span className={`rounded px-1.5 py-0.5 ${p.goals > 0 ? 'bg-brand/10 text-brand' : 'bg-pitch-700 text-pitch-300'}`}>⚡ {p.goals}G</span>
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-pitch-300">{p.assists}A</span>
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-pitch-300">🔴 {p.pc_scored} PC</span>
                {p.yellow_cards > 0 && <span className="rounded bg-yellow-400/10 px-1.5 py-0.5 text-yellow-400">🟨 {p.yellow_cards}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
