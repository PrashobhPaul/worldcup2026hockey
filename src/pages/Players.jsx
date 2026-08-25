import { useState } from 'react'
import { goalSplit, splitText } from '../engine/goalSplit.js'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import RatingBreakdown from '../components/RatingBreakdown'
import { isAtTournament } from '../engine/bestXI'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import SiblingNav from '../components/SiblingNav'

const POSITIONS = ['all', 'Forward', 'Midfielder', 'Defender', 'Goalkeeper']

export default function PlayersPage() {
  const [pos, setPos] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  // Which player's rating breakdown is open. The number means nothing on its
  // own; the components behind it are the point.
  const [openId, setOpenId] = useState(null)
  // Only the players the official FIH team list carries. The store also holds
  // pre-tournament entries for players who were expected and did not travel;
  // a page about this tournament must not list them.
  const all = useLiveQuery(() => db.players.toArray(), [])
  const players = all?.filter(isAtTournament)
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))

  if (all === undefined) return <Skeleton h={500} />

  const filtered = players.filter(p =>
    (pos === 'all' || p.position === pos) &&
    (teamFilter === 'all' || p.team === teamFilter)
  )

  const scorers = [...players].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals || b.pc_scored - a.pc_scored).slice(0, 5)

  return (
    <div>
      <SiblingNav items={[
        { to: '/teams', label: '🌍 Teams', end: true },
        { to: '/players', label: '👤 Players' },
      ]} />
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">👤 Players</h1>
        <p className="mt-1 text-xs text-pitch-400">{players.length} key players tracked · goals, penalty-corner goals, cards</p>
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
                <span className="font-mono text-xs text-pitch-300">{p.goals}G{splitText(p) ? ` · ${splitText(p)}` : ''}</span>
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
          const open = openId === p.id
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
                  <button onClick={() => setOpenId(open ? null : p.id)}
                    className="rounded bg-live/10 px-1.5 py-0.5 font-bold text-live hover:bg-live/20">
                    AI {p.ai_rating} {open ? '▾' : '▸'}
                  </button>
                )}
                {p.world_rank != null && (
                  <span className="rounded bg-sky-400/10 px-1.5 py-0.5 font-bold text-sky-300" title="FIH player world ranking">World #{p.world_rank}</span>
                )}
                <span className={`rounded px-1.5 py-0.5 ${p.goals > 0 ? 'bg-brand/10 text-brand' : 'bg-pitch-700 text-pitch-300'}`}>⚡ {p.goals}G</span>
                {/* How they were scored, the way the FIH splits them, and only
                    the methods he actually scored by. */}
                {goalSplit(p).map(m => (
                  <span key={m.key} title={m.label}
                    className="rounded bg-pitch-700 px-1.5 py-0.5 text-pitch-300">{m.value} {m.short}</span>
                ))}
                {p.yellow_cards > 0 && <span className="rounded bg-yellow-400/10 px-1.5 py-0.5 text-yellow-400" title="Yellow cards">🟨 {p.yellow_cards}</span>}
                {p.green_cards > 0 && <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-emerald-300" title="Green cards">🟩 {p.green_cards}</span>}
                {p.red_cards > 0 && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-400" title="Red cards">🟥 {p.red_cards}</span>}
              </div>
              {open && (
                <div className="mt-2.5">
                  <RatingBreakdown player={p} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
