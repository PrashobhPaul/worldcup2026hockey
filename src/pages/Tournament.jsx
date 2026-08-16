import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import Pitch from '../components/Pitch'
import { db } from '../db'
import { computeStandings } from '../engine/standings'
import { useOracleBundle } from '../engine/oracleBundle'
import { AwardsView } from './Awards'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { formatProbability } from '../engine/probability.js'
import { StandingsTable, Skeleton, WinProbBar } from '../components/shared'
import { formatDate } from '../components/MatchCard'
import iconGoldenStick from '../assets/boards/icon-golden-boot.png'
import iconAssists from '../assets/boards/icon-top-assists.png'
import iconAttacking from '../assets/boards/icon-most-attacking.png'
import iconDefense from '../assets/boards/icon-strongest-defense.png'
import iconStandings from '../assets/boards/icon-standings.png'
import iconPerformers from '../assets/boards/icon-attack-defense.png'

const VIEWS = [
  { id: 'standings', label: 'Pool Standings' },
  { id: 'stats', label: 'Stats' },
  { id: 'best', label: "Tournament's Best" },
  { id: 'bracket', label: 'Bracket' },
  { id: 'awards', label: 'Awards' },
]

// Best XI selection: top AI ratings per position line, 4-3-3.
// Rising Stars XI: same rule restricted to nations outside the FIH top 6.
function pickXI(players, byCode, { risingOnly = false, exclude = new Set() } = {}) {
  const eligible = players.filter(p =>
    p.ai_rating != null && !exclude.has(p.id) &&
    (!risingOnly || (byCode.get(p.team)?.fihRank ?? 99) > 6))
  const byPos = pos => eligible
    .filter(p => p.position === pos)
    .sort((a, b) => b.ai_rating - a.ai_rating || a.name.localeCompare(b.name))
  const xi = [
    ...byPos('Goalkeeper').slice(0, 1),
    ...byPos('Defender').slice(0, 4),
    ...byPos('Midfielder').slice(0, 3),
    ...byPos('Forward').slice(0, 3),
  ]
  return xi.map(p => ({
    id: p.id,
    player: p.name,
    nat: p.team,
    rating: p.ai_rating,
    pos: p.position === 'Goalkeeper' ? 'GK' : p.position === 'Defender' ? 'DF' : p.position === 'Midfielder' ? 'MF' : 'FW',
    stat: `${p.goals}G · ${p.assists}A · ${p.pc_scored} PC`,
  }))
}

function BestXISpace({ players, byCode, xi, setXi }) {
  const best = useMemo(() => pickXI(players, byCode), [players, byCode])
  const rising = useMemo(
    () => pickXI(players, byCode, { risingOnly: true, exclude: new Set(best.map(p => p.id)) }),
    [players, byCode, best])
  const active = xi === 'rising' ? rising : best
  const accent = xi === 'rising' ? '#34d399' : 'var(--color-brand)'

  if (!best.length) {
    return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
      The XI appears once AI ratings land — after the first completed matches.
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[['best', 'Best XI'], ['rising', 'Rising Stars XI']].map(([id, label]) => (
          <button key={id} onClick={() => setXi(id)}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              xi === id || (id === 'best' && xi !== 'rising')
                ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-base font-semibold" style={{ color: accent }}>
            {xi === 'rising' ? 'Rising Stars XI' : "Tournament's Best XI"}
          </h2>
          <p className="mb-2 font-mono text-[10px] text-pitch-400">✨ Coach: Oracle · 1-4-3-3 · selected on AI positional ratings</p>
          <Pitch players={active} formation="4-3-3" byCode={byCode} accent={accent} />
        </div>
        <div>
          <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
            {active.map(p => (
              <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <span className="w-7 rounded bg-pitch-700 px-1 text-center font-mono text-[9px] font-bold text-pitch-300">{p.pos}</span>
                <span>{byCode.get(p.nat)?.flag}</span>
                <Link to={`/teams/${p.nat}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-brand">{p.player}</Link>
                <span className="font-mono text-[10px] text-pitch-400">{p.stat}</span>
                <span className="font-mono text-sm font-bold text-live">{p.rating}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-xl border-l-2 border-white/5 bg-pitch-800 p-3.5 text-xs leading-relaxed text-pitch-300"
            style={{ borderLeftColor: accent }}>
            {xi === 'rising'
              ? 'Oracle’s plan: the best-rated players from nations outside the FIH top six — the names this World Cup introduces to the world. High press, fast transfers, nothing to lose.'
              : 'Oracle’s plan: the tournament’s highest-rated player in every line. A drag-flick battery in defence, total control through midfield, and the three most dangerous circle finishers up top.'}
          </p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-pitch-400">
            Selected automatically from AI positional ratings — recomputed after every completed match. No editorial overrides.
          </p>
        </div>
      </div>
    </div>
  )
}

function Board({ title, sub, rows, accent = 'text-brand', footnote, icon }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        {icon && <img src={icon} alt="" className="h-6 w-6 rounded" />}
        {title}
      </h2>
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

    const performers = {}
    for (const pos of ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']) {
      performers[pos] = [...players]
        .filter(p => p.position === pos && p.ai_rating != null)
        .sort((a, b) => b.ai_rating - a.ai_rating || a.name.localeCompare(b.name))
        .slice(0, 8)
        .map(p => ({
          key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
          chip: pos === 'Goalkeeper' ? `${p.matches_played ?? 0} MP` : `${p.goals}G · ${p.assists}A`,
          value: p.ai_rating,
        }))
    }

    return { scorers, assists, attackRows, defenseRows, fairPlay, performers }
  }, [players, events, matches, teams, byCode])

  const hasRatings = Object.values(boards.performers).some(r => r.length > 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Board title="Golden Stick" icon={iconGoldenStick} sub="Most goals in the tournament" rows={boards.scorers}
          footnote="Ranked by goals, then assists — penalty-corner goals at full value." />
        <Board title="Top Assists" icon={iconAssists} sub="Most assists in the tournament" rows={boards.assists} />
        <Board title="Most Attacking" icon={iconAttacking} sub="Total goals scored" rows={boards.attackRows} accent="text-live" />
        <Board title="Strongest Defense" icon={iconDefense} sub="Fewest goals conceded" rows={boards.defenseRows} accent="text-sky-400" />
        <Board title="Fair Play" icon={iconStandings} sub="Lowest disciplinary points (yellow 1 · red 3) — lower is better" rows={boards.fairPlay} accent="text-live"
          footnote="Totals grow with matches played, so deep runs carry more bookings." />
      </div>

      {hasRatings && (
        <>
          <div className="flex items-center gap-2.5 pt-2">
            <img src={iconPerformers} alt="" className="h-8 w-8 rounded" />
            <div>
              <h2 className="font-display text-base font-semibold">Top Performers</h2>
              <p className="text-[11px] text-pitch-400">AI positional ratings · updated after every completed match</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Board title="Goalkeepers" sub="Save reliability × clean sheets" rows={boards.performers.Goalkeeper} accent="text-sky-400" />
            <Board title="Defenders" sub="Drag-flick threat, outletting, goals conceded" rows={boards.performers.Defender} />
            <Board title="Midfielders" sub="Goal involvement + penalty-corner build-up" rows={boards.performers.Midfielder} />
            <Board title="Forwards" sub="Goals, assists and circle threat" rows={boards.performers.Forward} accent="text-live" />
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-pitch-400">
            Rule-based Hockey.AI positional model on the match event ledger. Volume-weighted, so pitch time
            matters — a one-match cameo cannot outrank a tournament-long starter on the same rating.
          </p>
        </>
      )}
    </div>
  )
}

// Win Probability reads the canonical current snapshot — the identical object
// the Oracle race chart ends on. No simulation, sorting rule or rounding of
// its own lives here.
function WinProbabilityView({ bundle, byCode }) {
  const snap = bundle.current
  const lead = snap.probabilities[0]?.champion ?? 0

  return (
    <div className="space-y-2">
      <div className="mb-3 rounded-xl border border-white/5 bg-pitch-800 p-3.5">
        <p className="text-xs text-pitch-400">
          All 16 teams ranked by AI tournament win probability — {snap.simulationCount.toLocaleString()} simulated
          tournaments from the state after {snap.completedMatches} completed {snap.completedMatches === 1 ? 'match' : 'matches'}.
        </p>
        <p className="mt-1.5 font-mono text-[10px] text-pitch-400">
          Snapshot <span className="text-pitch-300">{snap.snapshotId}</span> · model {snap.modelVersion} ·
          the same snapshot powers the <Link to="/prediction-race" className="text-brand hover:underline">Oracle race</Link> endpoint,
          odds table and bracket.
        </p>
      </div>
      {snap.probabilities.map(entry => {
        const team = byCode.get(entry.teamId)
        if (!team) return null
        return (
          <WinProbBar key={entry.teamId} team={team} entry={entry} lead={lead}
            out={bundle.eliminationAt.has(entry.teamId)} />
        )
      })}
      <p className="pt-1 font-mono text-[10px] text-pitch-400">
        Champion column sums to {formatProbability(snap.probabilities.reduce((s, p) => s + p.champion, 0), 0)} across all 16 teams.
      </p>
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
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  // Win Probability moved to the Oracle, where the same canonical snapshot
  // powers the race and the odds table — one home for one number.
  const view = VIEWS.some(v => v.id === requested) ? requested : 'standings'
  const xi = params.get('xi') === 'rising' ? 'rising' : 'best'
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const players = useLiveQuery(() => db.players.toArray(), [], [])
  const bundle = useOracleBundle(teams ?? [], matches ?? [])

  useSwipeTabs({
    count: VIEWS.length,
    index: VIEWS.findIndex(v => v.id === view),
    onChange: i => setView(VIEWS[i].id),
  })

  const setView = (v) => {
    const next = new URLSearchParams(params)
    v === 'standings' ? next.delete('tab') : next.set('tab', v)
    if (v !== 'best') next.delete('xi')
    setParams(next, { replace: true })
  }
  const setXi = (v) => {
    const next = new URLSearchParams(params)
    next.set('tab', 'best')
    v === 'best' ? next.delete('xi') : next.set('xi', v)
    setParams(next, { replace: true })
  }

  const loading = teams === undefined || matches === undefined
  const standings = computeStandings(teams ?? [], matches ?? [])
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))

  return (
    <div>
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <img src={`${import.meta.env.BASE_URL}emblem.png`} alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain" />
          Tournament
        </h1>
        <p className="mt-1 text-xs text-pitch-400">Standings, stat boards, Best XI and bracket — computed live from completed matches</p>
      </div>

      <div className="no-scrollbar sticky top-14 z-30 -mx-4 mb-5 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl" role="tablist">
        {VIEWS.map(v => (
          <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
            className={`shrink-0 rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              view === v.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {requested === 'probability' && <Navigate to="/prediction-race?tab=odds" replace />}

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

          {view === 'best' && <BestXISpace players={players} byCode={byCode} xi={xi} setXi={setXi} />}

          {view === 'bracket' && (bundle
            ? <BracketView bundle={bundle} byCode={byCode} matches={matches} />
            : <Skeleton h={400} />)}

          {view === 'awards' && <AwardsView />}
        </>
      )}
    </div>
  )
}
