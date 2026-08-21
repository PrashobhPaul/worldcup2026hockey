import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard from '../components/MatchCard'
import { Skeleton, TierBadge } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability, toPercent } from '../engine/probability.js'
import { ArrowLeft } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

function OracleSnapshot({ team, teams, matches }) {
  const bundle = useOracleBundle(teams, matches)
  if (!bundle) return null
  const reach = bundle.current.get(team.code)
  if (!reach) return null
  const out = bundle.eliminationAt.has(team.code)
  const champion = out ? 0 : reach.champion

  const cut = bundle.eliminationAt.get(team.code)
  const series = bundle.snapshots.map(snap => ({
    match: snap.completedMatches,
    pct: cut && snap.completedMatches >= cut.finishedCount ? 0 : toPercent(snap.championOf(team.code), 1),
  }))
  const peak = Math.max(...series.map(s => s.pct))

  return (
    <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold">Oracle snapshot</h2>
        <Link to="/prediction-race" className="font-mono text-[11px] text-brand hover:underline">From Oracle ›</Link>
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`font-mono text-3xl font-bold ${out ? 'text-pitch-400' : 'text-brand'}`}>{formatProbability(champion)}</span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">
          Champion probability{out && ' · eliminated'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[['Last 8', reach.top8], ['Semis', reach.sf], ['Final', reach.final]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-pitch-950/50 p-2.5 text-center">
            <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{k}</div>
            <div className="mt-0.5 font-mono text-sm font-bold">{out ? '—' : `${Math.round(v * 100)}%`}</div>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-pitch-400">
            <span>Champion probability · this cup</span>
            <span>peak {peak.toFixed(1)}% · now {formatProbability(champion)}</span>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <XAxis dataKey="match" type="number" domain={['dataMin', 'dataMax']}
                tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 'auto']}
                tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#111f4d', border: '1px solid rgba(255,181,71,.2)', borderRadius: 8, fontSize: 11 }}
                formatter={v => [`${v}%`, 'Champion']} labelFormatter={l => `after match ${l}`} />
              <Line dataKey="pct" type="monotone" dot={false} isAnimationActive={false}
                stroke="var(--color-brand)" strokeWidth={2.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

// Header badges — canonical snapshot only. The seed file's pre-tournament
// win_prob is a model input, never a displayed "current" probability.
function TitleOdds({ team, teams, matches }) {
  const bundle = useOracleBundle(teams, matches)
  const entry = bundle?.current.get(team.code)
  const out = bundle?.eliminationAt.has(team.code)
  return (
    <div className="mt-2 flex items-center gap-2">
      <TierBadge tier={out ? 'out' : bundle?.tierOf(team.code)} />
      <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-bold text-brand">
        {entry ? formatProbability(out ? 0 : entry.champion) : '…'} title prob
      </span>
    </div>
  )
}

export default function TeamDetailPage() {
  const { teamCode } = useParams()
  const team = useLiveQuery(() => db.teams.get(teamCode), [teamCode])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const allMatches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
  const players = useLiveQuery(() => db.players.where('team').equals(teamCode).toArray(), [teamCode], [])
  const matches = (allMatches ?? []).filter(m => m.home === teamCode || m.away === teamCode)

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
            <TitleOdds team={team} teams={teams} matches={allMatches} />
          </div>
        </div>
        {team.intro && (
          <div className="mt-4 rounded-xl border-l-2 border-l-brand/60 border-white/5 bg-pitch-950/40 p-4">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
              Before the tournament
            </div>
            <p className="text-sm leading-relaxed text-pitch-300">{team.intro}</p>
          </div>
        )}

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

      <OracleSnapshot team={team} teams={teams} matches={allMatches} />

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
