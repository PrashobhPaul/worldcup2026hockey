import { useMemo, useState } from 'react'
import { splitText } from '../engine/goalSplit.js'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import Pitch from '../components/Pitch'
import { db } from '../db'
import { computeStandings, computeStage2Standings } from '../engine/standings'
import { cardPoints } from '../engine/awards'
import { isAtTournament, roleOf, tournamentXI } from '../engine/bestXI'
import { AwardsView } from './Awards'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { StandingsTable, Skeleton } from '../components/shared'
import TournamentProgress from '../components/TournamentProgress'
import {
  GoldenStickIcon, CrossedSticksIcon, KeeperPadIcon, PenaltyCornerIcon,
  PlayerIndexIcon, FinalQuarterIcon, TalismanIcon, FairPlayIcon, PodiumIcon,
  DerivedBadge,
} from '../components/hockeyIcons'

// The bracket is NOT here on purpose: the Oracle owns the one bracket view
// (semis, medals, advance odds), and a second copy under the Cup confused
// readers about which one to trust. /tournament?tab=bracket redirects there.
const VIEWS = [
  { id: 'standings', label: 'Standings' },
  { id: 'stats', label: 'Stats' },
  { id: 'best', label: "Tournament's Best" },
  { id: 'awards', label: 'Awards' },
]

// The tournament-wide XI lives in the engine beside the per-team one, so
// there is one definition of a line and one gate over it.
function pickXI(players) {
  return tournamentXI(players).map(p => ({
    id: p.id,
    player: p.name,
    nat: p.team,
    rating: p.ai_rating,
    pos: { Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF' }[p.line.role] ?? 'FW',
    stat: [`${p.goals}G`, splitText(p)].filter(Boolean).join(' · '),
  }))
}

function BestXISpace({ players, byCode }) {
  const best = useMemo(() => pickXI(players), [players])
  const accent = 'var(--color-brand)'

  if (!best.length) {
    return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
      The XI appears once AI ratings land — after the first completed matches.
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-base font-semibold" style={{ color: accent }}>
            Tournament&apos;s Best XI
          </h2>
          <p className="mb-2 font-mono text-[10px] text-pitch-400">✨ Coach: Oracle · 1-4-3-3 · selected on AI positional ratings</p>
          <Pitch players={best} formation="4-3-3" byCode={byCode} accent={accent} />
        </div>
        <div>
          <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
            {best.map(p => (
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
            Oracle’s plan: the tournament’s highest-rated player in every line. A drag-flick battery
            in defence, total control through midfield, and the three most dangerous circle finishers up top.
          </p>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-pitch-400">
            Selected automatically from AI positional ratings — recomputed after every completed match. No editorial overrides.
          </p>
        </div>
      </div>
    </div>
  )
}

// Where a board's numbers come from. FIH boards count things the official
// record states; Hockey.AI boards are this app's own derivation from that
// record. The badge is on every board so a reader never has to guess which
// kind they are looking at. One badge, shared with every other surface.
function Board({ title, sub, rows, accent = 'text-brand', footnote, icon: Icon, derived = false }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        {Icon && <Icon size={26} />}
        <span className="flex-1">{title}</span>
        <DerivedBadge derived={derived} />
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
                {/* Name and detail stack. Sharing one row with the detail
                    text truncated every name on a phone — "Harmanpre…". */}
                <div className="min-w-0 flex-1">
                  {r.to
                    ? <Link to={r.to} className="block truncate text-sm font-semibold hover:text-brand">{r.name} {i === 0 && '🏆'}</Link>
                    : <span className="block truncate text-sm font-semibold">{r.name} {i === 0 && '🏆'}</span>}
                  {r.chip && <span className="block truncate font-mono text-[10px] text-pitch-400">{r.chip}</span>}
                </div>
                <div className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-pitch-600 sm:block">
                  <div className={`h-full rounded-full ${r.invert ? 'bg-sky-400' : 'bg-brand'}`}
                    style={{ width: `${Math.max(6, (r.invert ? 1 - r.value / (max + 1) : r.value / max) * 100)}%` }} />
                </div>
                <span className={`w-8 shrink-0 text-right font-mono text-sm font-bold ${accent}`}>{r.value}</span>
              </li>
            ))}
          </ol>
        )}
      {footnote && <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-pitch-400">{footnote}</p>}
    </div>
  )
}

function StatsView({ teams, matches, byCode }) {
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  const events = useLiveQuery(() => db.match_events.toArray(), [], [])

  const boards = useMemo(() => {
    const scorers = [...players]
      .filter(p => (p.goals ?? 0) > 0)
      .sort((a, b) => b.goals - a.goals || b.pc_scored - a.pc_scored || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(p => ({
        key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
        chip: splitText(p) ?? 'no goals on the record', value: p.goals,
      }))

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

    // One weighting for cards, shared with the fair-play award, and scored per
    // match played: a side that has played six matches is not punished for
    // having been on the pitch longer than one that played four. This board
    // used to ignore the green card, which in hockey is a suspension.
    const cards = new Map(teams.map(t => [t.code, { pts: 0, count: 0 }]))
    for (const e of events) {
      const pts = cardPoints(e.type)
      if (!pts || !cards.has(e.team)) continue
      const r = cards.get(e.team)
      r.pts += pts
      r.count += 1
    }
    const fairPlay = played
      .map(([code, row]) => {
        const c = cards.get(code) ?? { pts: 0, count: 0 }
        return { code, perMatch: row.played ? c.pts / row.played : 0, count: c.count, mp: row.played }
      })
      .sort((x, y) => x.perMatch - y.perMatch || x.count - y.count)
      .slice(0, 8)
      .map(r => ({
        key: r.code, name: byCode.get(r.code)?.name ?? r.code, flag: byCode.get(r.code)?.flag,
        to: `/teams/${r.code}`, value: r.perMatch.toFixed(1), invert: true,
        chip: `${r.count} card${r.count === 1 ? '' : 's'} in ${r.mp}`,
      }))

    // ── Hockey.AI derivations ──────────────────────────────────────────
    // Each of these is computed here from the official record — goals, their
    // method, their minute, and cards. None of it is an FIH statistic; all of
    // it is countable from FIH data, which is the line the badges draw.
    const teamGoals = new Map()
    for (const m of matches) {
      if (m.status !== 'completed' || m.score?.home == null) continue
      teamGoals.set(m.home, (teamGoals.get(m.home) ?? 0) + m.score.home)
      teamGoals.set(m.away, (teamGoals.get(m.away) ?? 0) + m.score.away)
    }

    // Final-quarter goals: minute 46 onwards, when a match is decided.
    const lateGoals = new Map()
    for (const e of events) {
      if (e.type !== 'goal' || !e.player || (e.minute ?? 0) < 46) continue
      lateGoals.set(e.player, (lateGoals.get(e.player) ?? 0) + 1)
    }
    const clutch = [...lateGoals.entries()]
      .map(([name, n]) => ({ name, n, p: players.find(x => x.name === name) }))
      .filter(r => r.p)
      .sort((a, b) => b.n - a.n || b.p.goals - a.p.goals || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(r => ({ key: r.p.id, name: r.name, flag: byCode.get(r.p.team)?.flag,
                   chip: `${r.p.goals} in all`, value: r.n }))

    // Share of a side's goals — who carries the scoring.
    const talisman = players
      .filter(p => (p.goals ?? 0) > 0 && (teamGoals.get(p.team) ?? 0) > 0)
      .map(p => ({ p, pct: Math.round((p.goals / teamGoals.get(p.team)) * 100) }))
      .sort((a, b) => b.pct - a.pct || b.p.goals - a.p.goals || a.p.name.localeCompare(b.p.name))
      .slice(0, 10)
      .map(r => ({ key: r.p.id, name: r.p.name, flag: byCode.get(r.p.team)?.flag,
                   chip: `${r.p.goals} of ${teamGoals.get(r.p.team)}`, value: r.pct }))

    // Penalty-corner goals: the set-piece specialists.
    const setPiece = players
      .filter(p => (p.pc_scored ?? 0) > 0)
      .sort((a, b) => b.pc_scored - a.pc_scored || b.goals - a.goals || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(p => ({ key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
                   chip: `${p.goals} goals in all`, value: p.pc_scored }))

    // The overall index, across every rated player.
    const index = players
      .filter(p => p.ai_rating != null)
      .sort((a, b) => b.ai_rating - a.ai_rating || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(p => ({ key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
                   chip: p.position && p.position !== 'Squad' ? p.position : `${p.goals}G`,
                   value: p.ai_rating }))

    // Ranked on the role each player is actually placed in — the FIH's where
    // it states one, Hockey.AI's derivation where it does not. Reading
    // `position` alone left the defenders' board with six names in a
    // tournament of sixteen squads, because the entry list states a position
    // for barely a fifth of the players.
    const performers = {}
    for (const pos of ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']) {
      performers[pos] = [...players]
        .filter(p => roleOf(p).role === pos && p.ai_rating != null)
        .sort((a, b) => b.ai_rating - a.ai_rating || a.name.localeCompare(b.name))
        .slice(0, 8)
        .map(p => ({
          key: p.id, name: p.name, flag: byCode.get(p.team)?.flag,
          chip: pos === 'Goalkeeper'
            ? (roleOf(p).source === 'FIH' ? 'keeper · FIH' : 'keeper')
            : `${p.goals}G · ${p.pc_scored} PC · ${roleOf(p).source === 'FIH' ? 'FIH' : 'derived'}`,
          value: p.ai_rating,
        }))
    }

    return { scorers, attackRows, defenseRows, fairPlay, performers, clutch, talisman, setPiece, index }
  }, [players, events, matches, teams, byCode])

  const hasRatings = Object.values(boards.performers).some(r => r.length > 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Board title="Golden Stick" icon={GoldenStickIcon} sub="Most goals in the tournament" rows={boards.scorers}
          footnote="Ranked by goals, then by how many came from penalty corners — set-piece goals at full value." />
        <Board title="Most Attacking" icon={CrossedSticksIcon} sub="Total goals scored" rows={boards.attackRows} accent="text-live" />
        <Board title="Strongest Defense" icon={KeeperPadIcon} sub="Fewest goals conceded" rows={boards.defenseRows} accent="text-sky-400" />
        <Board title="Set-Piece Specialists" icon={PenaltyCornerIcon} sub="Goals scored from penalty corners" rows={boards.setPiece}
          derived accent="text-brand"
          footnote="Counted from the goal method in the official record — the corner itself is not an FIH statistic, the goal is." />
        <Board title="Hockey.AI Player Index" icon={PlayerIndexIcon} sub="This app's rating, by position and output" rows={boards.index}
          derived accent="text-brand"
          footnote="Goalkeepers on clean sheets and goals against; defenders on the same plus drag-flick output; midfielders on scoring and share; forwards on goals, field goals weighted highest. Cards deduct. Scaled by matches played." />
        <Board title="Fourth-Quarter Goals" icon={FinalQuarterIcon} sub="Goals scored from the 46th minute on" rows={boards.clutch}
          derived accent="text-live"
          footnote="Derived from goal minutes in the official record." />
        <Board title="Talisman" icon={TalismanIcon} sub="Share of a side's goals, in per cent" rows={boards.talisman}
          derived accent="text-live"
          footnote="A player's goals as a percentage of everything their team has scored." />
        <Board title="Fair Play" icon={FairPlayIcon} sub="Disciplinary points per match — lower is cleaner" rows={boards.fairPlay} accent="text-live" derived
          footnote="Green 1 · yellow 2 · red 5, following the length of the suspension each card carries, divided by matches played. The same weighting decides the fair-play award." />
      </div>

      {hasRatings && (
        <>
          <div className="flex items-center gap-2.5 pt-2">
            <PodiumIcon size={34} />
            <div>
              <h2 className="font-display text-base font-semibold">Top Performers</h2>
              <p className="text-[11px] text-pitch-400">AI positional ratings · updated after every completed match</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Board title="Goalkeepers" sub="Clean sheets and goals conceded per match" derived rows={boards.performers.Goalkeeper} accent="text-sky-400" />
            <Board title="Defenders" sub="Goals conceded, plus drag-flick and field-goal output" derived rows={boards.performers.Defender} />
            <Board title="Midfielders" sub="Scoring, set-piece goals and share of the team's output" derived rows={boards.performers.Midfielder} />
            <Board title="Forwards" sub="Goals and set-piece threat" derived rows={boards.performers.Forward} accent="text-live" />
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

// The REAL Stage-2 tables, as FIH publishes them: played cross fixtures plus
// the carried Stage-1 result between the two teams that arrived from the same
// pool. Facts only — the projected finish (with pending matches folded in)
// lives on the Oracle bracket, so the two views never blur into each other.
function Stage2Standings({ matches }) {
  const tables = computeStage2Standings(matches ?? [])
  if (!tables.length) return null
  return (
    <div>
      <h2 className="mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Stage 2 · Group Phase</h2>
      <p className="mb-2.5 font-mono text-[10px] text-pitch-400">
        Teams that arrived from the same Stage-1 pool don&apos;t replay — that result is carried
        forward and already counts below. The top two of <b className="text-brand">Pools E &amp; F</b> reach the semi-finals.
      </p>
      <div className="space-y-5">
        {tables.map(pool => (
          <div key={pool.id} className={`rounded-xl border bg-pitch-800 p-4 ${'EF'.includes(pool.id) ? 'border-brand/25' : 'border-white/5'}`}>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-base font-semibold">
                Pool {pool.id} {'EF'.includes(pool.id) && <span className="font-mono text-[9px] text-brand">· top two → semi-finals</span>}
              </h3>
              <span className="font-mono text-[10px] text-pitch-400">
                {pool.crossPlayed}/{pool.crossTotal} played · carry-over included
              </span>
            </div>
            {/* The advance highlight only means something in the championship
                pools — G and H play for classification, nobody "goes through". */}
            <StandingsTable standings={pool.standings} highlight={'EF'.includes(pool.id) ? 2 : 0} />
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[11px] text-pitch-400">
        Projected finishes, semi-finals and medal matches live on the{' '}
        <Link to="/prediction-race?tab=bracket" className="text-brand hover:underline">Oracle bracket</Link> — one bracket, one home.
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
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])

  useSwipeTabs({
    count: VIEWS.length,
    index: VIEWS.findIndex(v => v.id === view),
    onChange: i => setView(VIEWS[i].id),
  })

  const setView = (v) => {
    const next = new URLSearchParams(params)
    v === 'standings' ? next.delete('tab') : next.set('tab', v)
    // ?xi=rising addressed the second XI, which no longer exists. Dropping it
    // keeps an old link working rather than landing on a dead parameter.
    next.delete('xi')
    setParams(next, { replace: true })
  }

  const loading = teams === undefined || matches === undefined
  const standings = computeStandings(teams ?? [], matches ?? [])
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  const poolMatchList = (matches ?? []).filter(m => m.phase === 'pool')
  const stage2Underway = poolMatchList.length > 0 && poolMatchList.every(m => m.status === 'completed')

  return (
    <div>
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
          <img src={`${import.meta.env.BASE_URL}emblem.png`} alt=""
            className="h-8 w-8 shrink-0 rounded-md object-contain" />
          Tournament
        </h1>
        <p className="mt-1 text-xs text-pitch-400">Standings, stat boards, Best XI and awards — computed live from completed matches</p>
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
      {requested === 'bracket' && <Navigate to="/prediction-race?tab=bracket" replace />}

      {loading ? <Skeleton h={500} /> : (
        <>
          {view === 'standings' && (
            <div className="space-y-6">
              {/* The shape of the tournament first, then the tables that
                  decide it. It states the record only — the Oracle keeps the
                  one bracket that carries odds. */}
              <TournamentProgress teams={teams} matches={matches} />
              {/* Once Stage 2 begins, its tables lead — the Stage 1 letters are history. */}
              <Stage2Standings matches={matches} />
              <div>
                {stage2Underway && (
                  <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Stage 1 · Final Tables</h2>
                )}
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
              </div>
            </div>
          )}

          {view === 'stats' && <StatsView teams={teams} matches={matches} byCode={byCode} />}

          {view === 'best' && <BestXISpace players={players} byCode={byCode} />}

          {view === 'awards' && <AwardsView />}
        </>
      )}
    </div>
  )
}
