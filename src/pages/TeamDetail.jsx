import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard from '../components/MatchCard'
import { Skeleton, TierBadge } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability, toPercent } from '../engine/probability.js'
import { ArrowLeft } from 'lucide-react'
import { useFavourite, toggleFavourite } from '../hooks/useFavourite'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import BestElevenPitch, { RemainingSquad, TeamToppers, ScoreRow } from '../components/BestElevenPitch'
import { teamToppers, HOCKEY_FORMATION, isAtTournament } from '../engine/bestXI'
import { impactContext, teamKeyPlayers } from '../engine/impact'
import { KeyPlayerCard as KeyPlayerCards } from '../components/KeyPlayers'
import TeamRatingCard from '../components/TeamRatingCard'

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

/** Local, zero-backend: following drives the Home dashboard on this device. */
function FollowButton({ team }) {
  const favourite = useFavourite()
  const following = favourite === team.code
  return (
    <button onClick={() => toggleFavourite(team.code)} aria-pressed={following}
      className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
        following
          ? 'border-brand/40 bg-brand/10 text-brand'
          : 'border-white/10 bg-pitch-800 text-pitch-300 hover:border-brand/25 hover:text-white'
      }`}>
      <span className="text-sm leading-none">{following ? '★' : '☆'}</span>
      {following ? 'Following' : 'Follow'}
    </button>
  )
}

export default function TeamDetailPage() {
  const { teamCode } = useParams()
  const team = useLiveQuery(() => db.teams.get(teamCode), [teamCode])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const allMatches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
  const players = useLiveQuery(() => db.players.where('team').equals(teamCode).toArray(), [teamCode], [])
  // Every squad at the tournament, because a rating rank and a share of the
  // scoring are only meaningful against the whole field.
  const allPlayers = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  const matches = (allMatches ?? []).filter(m => m.home === teamCode || m.away === teamCode)
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))

  // One pass over this team's fixtures: what has been played, what is next,
  // and the record those results add up to. Every row deeplinks to its match.
  const played = matches.filter(m =>
    m.status === 'completed' && m.score && m.score.home != null && m.score.away != null)
  const results = [...played].reverse()   // most recent first
  const upcoming = matches.filter(m => m.status !== 'completed')
  const nextMatch = upcoming[0] ?? null
  const record = played.reduce((r, m) => {
    const home = m.home === teamCode
    const us = home ? m.score.home : m.score.away
    const them = home ? m.score.away : m.score.home
    return {
      w: r.w + (us > them ? 1 : 0),
      d: r.d + (us === them ? 1 : 0),
      l: r.l + (us < them ? 1 : 0),
      gf: r.gf + us,
      ga: r.ga + them,
    }
  }, { w: 0, d: 0, l: 0, gf: 0, ga: 0 })
  const captains = players.filter(p => p.is_captain && isAtTournament(p))
  const toppers = teamToppers(players, { matchesPlayed: played.length, goalsAgainst: record.ga })
  // Measured across the whole tournament: a share of the scoring only means
  // something against every side's scoring, and a rating rank only means
  // something against every player in that line.
  const impact = impactContext(allPlayers, allMatches)

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
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight">{team.name}</h1>
            <p className="font-mono text-xs text-pitch-300">{team.nickname} · FIH #{team.fihRank} · Pool {team.pool}{team.host ? ' · Host' : ''}</p>
            <TitleOdds team={team} teams={teams} matches={allMatches} />
          </div>
        </div>
        {/* Its own row: sharing the title row crushed long team names on phones. */}
        <div className="mt-3">
          <FollowButton team={team} />
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
            // Read off the squad, never off a second field on the team row.
            // teams.json carried its own `captain` string that nothing
            // reconciled against the entry list, so Australia's page named a
            // captain who is not at this tournament — he was a pre-tournament
            // seed the official list does not carry, and clearing his player
            // flag left the team row untouched. Hockey has co-captains, so
            // this prints however many the list marks.
            ['Captain', captains.length ? captains.map(p => p.name).join(' & ') : '—'],
            ['Coach', team.coach],
            ['World Cups', team.titles > 0 ? `${team.titles} (last ${team.last_title})` : '0'],
            ['Pool', team.pool],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-pitch-950/50 p-2.5">
              <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{k}</div>
              {/* Wraps rather than truncates: a side with two captains is two
                  names, and "Maico Casella & Matias …" named one of them. */}
              <div className="mt-0.5 text-xs font-semibold leading-tight">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <OracleSnapshot team={team} teams={teams} matches={allMatches} />

      <TeamRatingCard teamCode={team.code} />

      {/* Who decides matches for this nation, on the same measures the
          knockout pages use: share of the scoring, the corner routine, the
          positional rating and its rank in that line, and the keeper the coach
          actually plays. The departmental counts follow underneath. */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">{team.name} key players</h2>
          <span className="font-mono text-[10px] text-pitch-400">this tournament</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {teamKeyPlayers(players, impact).map(card => (
            <KeyPlayerCards key={card.key} card={card} flag={team.flag} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">{team.name} leaders</h2>
          <span className="font-mono text-[10px] text-pitch-400">this tournament</span>
        </div>
        <TeamToppers rows={toppers} teamFlag={team.flag} />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Best XI</h2>
          <span className="font-mono text-[10px] text-pitch-400">{HOCKEY_FORMATION}</span>
        </div>
        <BestElevenPitch squad={players} teamColor={team.color} />
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-pitch-400">
          Selected by position, not by rating alone. The FIH entry list states no outfield position and the
          TMS team-sheet pages are not served publicly, so where a role is not stated it is derived by
          Hockey.AI from how a player&apos;s goals were scored. This is Hockey.AI&apos;s XI, not an FIH team sheet.
        </p>
        {players.length > 11 && (
          <div className="mt-4">
            <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">
              Rest of the squad
            </h3>
            <RemainingSquad squad={players} teamCode={team.code} />
          </div>
        )}
      </section>

      {nextMatch && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Next match</h2>
          <MatchCard match={nextMatch} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Results</h2>
          <span className="font-mono text-[10px] text-pitch-400">
            {record.w}W · {record.d}D · {record.l}L · {record.gf}–{record.ga}
          </span>
        </div>
        {results.length ? (
          <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
            {results.map(m => <ScoreRow key={m.id} match={m} teamCode={team.code} byCode={byCode} />)}
          </ol>
        ) : (
          <p className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-xs text-pitch-400">
            No completed matches yet.
          </p>
        )}
      </section>

      {upcoming.length > 1 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold">Still to come</h2>
          <div className="space-y-2.5">
            {upcoming.slice(1).map(m => <MatchCard key={m.id} match={m} compact />)}
          </div>
        </section>
      )}
    </div>
  )
}
