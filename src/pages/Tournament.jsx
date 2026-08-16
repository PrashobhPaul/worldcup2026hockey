import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { computeStandings } from '../engine/standings'
import { useOracleBundle } from '../engine/oracleBundle'
import { StandingsTable, Skeleton, WinProbBar } from '../components/shared'
import { formatDate } from '../components/MatchCard'

const VIEWS = [
  { id: 'standings', label: 'Pool Standings' },
  { id: 'stats', label: 'Stats' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'probability', label: 'Win Probability' },
]

function Board({ title, sub, rows, accent = 'text-brand', footnote }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h2 className="font-display text-base font-semibold">{title}</h2>
      <p className="mb-3 mt-0.5 text-[11px] text-pitch-400">{sub}</p>
      {rows.length === 0
        ? <p className="text-xs text-pitch-400">No data yet — boards fill as matches complete.</p>
        : (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={r.key} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-brand/5' : ''}`}>
                <span className="w-5 text-center font-mono text-xs font-bold text-pitch-400">{i + 1}</span>
                <span className="text-base">{r.flag}</span>
                {r.to
                  ? <Link to={r.to} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-brand">{r.name} {i === 0 && '🏆'}</Link>
                  : <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name} {i === 0 && '🏆'}</span>}
                <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-pitch-600 sm:block">
                  <div className={`h-full rounded-full ${r.invert ? 'bg-sky-400' : 'bg-brand'}`}
                    style={{ width: `${Math.max(6, (r.invert ? 1 - r.value / (max + 1) : r.value / max) * 100)}%` }} />
                </div>
                {r.chip && <span className="font-mono text-[10px] text-pitch-400">{r.chip}</span>}
                <span className={`w-8 text-right font-mono text-sm font-bold ${accent}`}>{r.value}</span>
              </li>
            ))}
          </ol>
        )}
      {footnote && <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-pitch-400">{footnote}</p>}
    </div>
  )
}

function StatsView({ teams, matches, byCode }) {
  const players = useLiveQuery(() => db.players.toArray(), [], [])
  const events = useLiveQuery(() => db.match_events.toArray(), [], [])

  const boards = useMemo(() => {
    const scorers = [...players]
      .filter(p => (p.goals ?? 0) > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(p => ({
        key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
        chip: `${p.assists}A · ${p.pc_scored} PC`, value: p.goals,
      }))

    const assists = [...players]
      .filter(p => (p.assists ?? 0) > 0)
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(p => ({ key: p.id, name: p.name, flag: byCode.get(p.team)?.flag, chip: `${p.goals}G`, value: p.assists }))

    const attack = new Map(teams.map(t => [t.code, { gf: 0, ga: 0, played: 0 }]))
    for (const m of matches) {
      if (m.status !== 'completed' || m.score?.home == null) continue
      const h = attack.get(m.home), a = attack.get(m.away)
      if (h) { h.gf += m.score.home; h.ga += m.score.away; h.played++ }
      if (a) { a.gf += m.score.away; a.ga += m.score.home; a.played++ }
    }
    const played = [...attack.entries()].filter(([, v]) => v.played > 0)
    const attackRows = played
      .sort((x, y) => y[1].gf - x[1].gf || x[1].ga - y[1].ga)
      .slice(0, 8)
      .map(([code, v]) => ({
        key: code, name: byCode.get(code)?.name ?? code, flag: byCode.get(code)?.flag,
        to: `/teams/${code}`, chip: `${v.played} played`, value: v.gf,
      }))
    const defenseRows = played
      .sort((x, y) => x[1].ga - y[1].ga || y[1].gf - x[1].gf)
      .slice(0, 8)
      .map(([code, v]) => ({
        key: code, name: byCode.get(code)?.name ?? code, flag: byCode.get(code)?.flag,
        to: `/teams/${code}`, chip: `${v.played} played`, value: v.ga, invert: true,
      }))

    const cards = new Map(teams.map(t => [t.code, 0]))
    for (const e of events) {
      const pts = e.type === 'yellow_card' ? 1 : e.type === 'red_card' ? 3 : 0
      if (pts && cards.has(e.team)) cards.set(e.team, cards.get(e.team) + pts)
    }
    const fairPlay = played
      .map(([code]) => ({ code, pts: cards.get(code) ?? 0 }))
      .sort((x, y) => x.pts - y.pts)
      .slice(0, 8)
      .map(r => ({
        key: r.code, name: byCode.get(r.code)?.name ?? r.code, flag: byCode.get(r.code)?.flag,
        to: `/teams/${r.code}`, value: r.pts, invert: true,
      }))

    return { scorers, assists, attackRows, defenseRows, fairPlay }
  }, [players, events, matches, teams, byCode])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Board title="🥇 Golden Stick" sub="Most goals in the tournament" rows={boards.scorers}
        footnote="Ranked by goals, then assists — penalty-corner goals at full value." />
      <Board title="🎯 Top Assists" sub="Most assists in the tournament" rows={boards.assists} />
      <Board title="⚡ Most Attacking" sub="Total goals scored" rows={boards.attackRows} accent="text-live" />
      <Board title="🛡 Strongest Defense" sub="Fewest goals conceded" rows={boards.defenseRows} accent="text-sky-400" />
      <Board title="🤝 Fair Play" sub="Lowest disciplinary points (yellow 1 · red 3) — lower is better" rows={boards.fairPlay} accent="text-live"
        footnote="Totals grow with matches played, so deep runs carry more bookings." />
    </div>
  )
}

function BracketView({ bundle, byCode, matches }) {
  const groups = [
    ['Quarter-Finals', bundle.bracket.ties.filter(t => t.id.startsWith('QF'))],
    ['Semi-Finals', bundle.bracket.ties.filter(t => t.id.startsWith('SF'))],
    ['Medal Matches', bundle.bracket.ties.filter(t => t.id === 'BRZ' || t.id === 'GOLD')],
  ]
  const koById = new Map(matches.filter(m => m.phase !== 'pool').map(m => [m.id, m]))
  return (
    <div className="space-y-6">
      {groups.map(([label, ties]) => (
        <div key={label}>
          <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">{label}</h2>
          <div className="space-y-2">
            {ties.map(tie => {
              const m = koById.get(tie.id)
              const h = byCode.get(tie.home), a = byCode.get(tie.away)
              const pH = tie.pHomeAdvance
              return (
                <div key={tie.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-white/5 bg-pitch-800 px-3.5 py-2.5 text-sm">
                  <span className={`font-medium ${tie.predicted === tie.home ? 'font-bold' : ''}`}>
                    {h ? `${h.flag} ${h.name}` : '❓ TBD'}
                  </span>
                  {pH != null && tie.home && !tie.played && (
                    <span className="font-mono text-[10px] text-brand">{Math.round(pH * 100)}%</span>
                  )}
                  <span className="font-mono text-xs text-pitch-400">vs</span>
                  <span className={`font-medium ${tie.predicted === tie.away ? 'font-bold' : ''}`}>
                    {a ? `${a.flag} ${a.name}` : 'TBD'}
                  </span>
                  {pH != null && tie.away && !tie.played && (
                    <span className="font-mono text-[10px] text-brand">{Math.round((1 - pH) * 100)}%</span>
                  )}
                  {tie.played && tie.winner && (
                    <span className="font-mono text-[10px] font-bold text-live">→ {tie.winner}</span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-pitch-400">
                    {!tie.locked && '○ projected · '}
                    {m && <>{m.label} · {formatDate(m.date)} · {m.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}</>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <p className="font-mono text-[11px] text-pitch-400">
        Slots marked ○ are engine projections from current pool standings — they lock as pools complete (Aug 20).
        Full candidate math on the <Link to="/prediction-race" className="text-brand hover:underline">Oracle bracket</Link>.
      </p>
    </div>
  )
}

export default function TournamentPage() {
  const [view, setView] = useState('standings')
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const bundle = useOracleBundle(teams ?? [], matches ?? [])

  const loading = teams === undefined || matches === undefined
  const standings = computeStandings(teams ?? [], matches ?? [])
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  const sorted = [...(teams ?? [])].sort((a, b) => b.winProb - a.winProb)

  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">📊 Tournament</h1>
        <p className="mt-1 text-xs text-pitch-400">Standings, stat boards and bracket — computed live from completed matches</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              view === v.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton h={500} /> : (
        <>
          {view === 'standings' && (
            <div className="space-y-5">
              {standings.map(pool => {
                const poolMatches = (matches ?? []).filter(m => m.pool === pool.id && m.phase === 'pool')
                const played = poolMatches.filter(m => m.status === 'completed' && m.score?.home != null).length
                return (
                  <div key={pool.id} className="rounded-xl border border-white/5 bg-pitch-800 p-4">
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="font-display text-base font-semibold">Pool {pool.id}</h2>
                      <span className="font-mono text-[10px] text-pitch-400">{played}/{poolMatches.length} played</span>
                    </div>
                    <StandingsTable standings={pool.standings} />
                  </div>
                )
              })}
            </div>
          )}

          {view === 'stats' && <StatsView teams={teams} matches={matches} byCode={byCode} />}

          {view === 'bracket' && (bundle
            ? <BracketView bundle={bundle} byCode={byCode} matches={matches} />
            : <Skeleton h={400} />)}

          {view === 'probability' && (
            <div className="space-y-2">
              <p className="mb-3 text-xs text-pitch-400">All 16 teams ranked by AI tournament win probability. Recalibrated after every completed match.</p>
              {sorted.map(t => <WinProbBar key={t.code} team={t} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
