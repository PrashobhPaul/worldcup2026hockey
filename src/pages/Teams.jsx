import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton, TierBadge } from '../components/shared'

export default function TeamsPage() {
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  if (teams === undefined) return <Skeleton h={500} />

  const pools = ['A', 'B', 'C', 'D']
  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🌍 Teams</h1>
        <p className="mt-1 text-xs text-pitch-400">16 nations · 4 pools · FIH World Rankings</p>
      </div>
      {pools.map(pool => (
        <section key={pool} className="mb-7">
          <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Pool {pool}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {teams.filter(t => t.pool === pool).sort((a, b) => a.fihRank - b.fihRank).map(t => (
              <Link key={t.code} to={`/teams/${t.code}`}
                className="relative overflow-hidden rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/25">
                <div className="absolute inset-x-0 top-0 h-0.5 opacity-80" style={{ background: t.color }} />
                <span className="absolute right-2.5 top-2.5 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">#{t.fihRank}</span>
                <div className="mb-1.5 text-4xl">{t.flag}</div>
                <div className="text-sm font-bold">{t.name}</div>
                <div className="font-mono text-[10px] text-pitch-400">{t.nickname}</div>
                <div className="mt-2"><TierBadge tier={t.contender_tier} /></div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
