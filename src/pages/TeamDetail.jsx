import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard from '../components/MatchCard'
import { Skeleton, TierBadge } from '../components/shared'
import { ArrowLeft } from 'lucide-react'

export default function TeamDetailPage() {
  const { teamCode } = useParams()
  const team = useLiveQuery(() => db.teams.get(teamCode), [teamCode])
  const players = useLiveQuery(() => db.players.where('team').equals(teamCode).toArray(), [teamCode], [])
  const matches = useLiveQuery(
    () => db.matches.orderBy('kickoffUtc').toArray()
      .then(all => all.filter(m => m.home === teamCode || m.away === teamCode)),
    [teamCode], [],
  )

  if (team === undefined) return <Skeleton h={400} />
  if (!team) return <div className="text-sm text-pitch-400">Team not found. <Link className="text-brand" to="/teams">← Teams</Link></div>

  return (
    <div className="space-y-6">
      <Link to="/teams" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
        <ArrowLeft size={14} /> All teams
      </Link>

      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-pitch-800 to-pitch-900 p-6">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: team.color }} />
        <div className="flex items-center gap-5">
          <span className="text-6xl">{team.flag}</span>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{team.name}</h1>
            <p className="font-mono text-xs text-pitch-300">{team.nickname} · FIH #{team.fihRank} · Pool {team.pool}{team.host ? ' · Host' : ''}</p>
            <div className="mt-2 flex items-center gap-2">
              <TierBadge tier={team.contender_tier} />
              <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-bold text-brand">{team.winProb}% title prob</span>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            ['Captain', team.captain],
            ['Coach', team.coach],
            ['World Cups', team.titles > 0 ? `${team.titles} (last ${team.last_title})` : '0'],
            ['Pool', team.pool],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-pitch-950/50 p-2.5">
              <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{k}</div>
              <div className="mt-0.5 truncate text-xs font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Squad Spotlight</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {players.map(p => (
            <div key={p.id} className="rounded-xl border border-white/5 bg-pitch-800 p-3.5">
              <div className="flex items-center gap-2.5">
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[10px] text-pitch-300">#{p.number}</span>
                <span className="text-sm font-bold">{p.name}</span>
                {p.is_captain && <span className="text-xs text-brand">Ⓒ</span>}
                {p.fih_star && <span className="text-xs">⭐</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded bg-pitch-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-pitch-300">{p.position}</span>
                <span className="font-mono text-[10px] text-pitch-400">⚡{p.goals}G · {p.assists}A · {p.pc_scored} PC</span>
              </div>
              {p.profile && <p className="mt-2 text-xs leading-relaxed text-pitch-300">{p.profile}</p>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Fixtures & Results</h2>
        <div className="space-y-2.5">
          {matches.map(m => <MatchCard key={m.id} match={m} />)}
        </div>
      </section>
    </div>
  )
}
