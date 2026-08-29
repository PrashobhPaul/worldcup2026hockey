import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard, { formatDate, phaseTag } from '../components/MatchCard'
import { SectionHead, Skeleton, TierBadge } from '../components/shared'
import { derivePrediction, publishedAccuracy } from '../engine/prediction'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { SIM_ID } from '../content/sim'
import { useFavourite } from '../hooks/useFavourite'
import { useNowTick } from '../hooks/useNowTick'
import { effectiveStatus } from '../engine/clock'
import { alertsSupported, alertsEnabled, enableAlerts, disableAlerts } from '../notify'
import { FlaskConical, Trophy, BarChart3, Sparkles, ArrowUp, ArrowDown, Minus, Bell, BellOff } from 'lucide-react'

// Hero quick-access tiles: the race and the lab up top, stats and the
// simulation below. Championship Race lands on the Oracle's race graph;
// Stats lands on the Cup's stat boards.
const heroTiles = [
  { to: '/prediction-race', icon: Trophy, title: 'Championship Race' },
  { to: '/ai-lab', icon: FlaskConical, title: 'AI Lab' },
  { to: '/tournament?tab=stats', icon: BarChart3, title: 'Stats' },
  { to: `/match/sim/${SIM_ID}`, icon: Sparkles, title: 'AI Simulation' },
]

// The model's record, given the top line of the app: how many of the
// non-knockout matches it called. The denominator is on the badge, so the
// figure states its own scope and needs nothing added to it.
function ModelBadge() {
  const cal = useLiveQuery(() => db.meta.get('calibration'), [])
  const rec = publishedAccuracy(cal, null)
  if (!rec.pct || !rec.graded) return null
  return (
    <Link to="/trust" className="hero-accuracy">
      <span className="hero-accuracy-pct">{rec.pct}%</span>
      <span className="hero-accuracy-label">
        matches called
        <span className="hero-accuracy-sub">
          {rec.correct} of {rec.graded} matches
          {rec.drawsCalled ? ` · ${rec.drawsCalled}/${rec.draws} draws` : ''}
        </span>
      </span>
    </Link>
  )
}

function HeroCard({ liveNow }) {
  // Artwork is owner-supplied, verbatim: the emblem (public/emblem.png, cropped
  // by the pipeline from emblem-source.png) and the card background
  // (public/hero-bg.png — activates automatically once uploaded).
  const [emblem, setEmblem] = useState(false)

  return (
    <section className="hero-card"
      style={{ '--hero-bg': `url(${import.meta.env.BASE_URL}hero-bg.png)` }}>
      <div className="hero-layout">
        {/* 1 — World Cup emblem: the visual entry point on every device */}
        <div className={`hero-emblem-wrap ${emblem ? '' : 'hidden'}`}>
          <img src={`${import.meta.env.BASE_URL}emblem.png`} alt="FIH Hockey World Cup 2026"
            onLoad={() => setEmblem(true)} onError={e => { e.currentTarget.style.display = 'none' }}
            className="hero-emblem" />
        </div>

        {/* 2 — Tournament identity */}
        <h1 className="hero-caption font-display font-bold text-white">
          FIH MEN&apos;S HOCKEY WORLD CUP <span className="text-brand">2026</span>
        </h1>
        <p className="hero-hosts font-semibold text-pitch-300">15–30 August · Belgium &amp; Netherlands</p>

        {/* 3 — Tournament meta */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <span className="font-mono text-[11px] tracking-wide text-pitch-300">16 TEAMS · 50 MATCHES · 1 TROPHY</span>
          {liveNow && (
            <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-live">
              <span className="live-dot" /> Live Now
            </span>
          )}
        </div>

        {/* 4 — The model's record, ahead of everything else */}
        <ModelBadge />

        {/* 5 — Feature navigation */}
        <div className="hero-grid">
          {heroTiles.map(({ to, icon: Icon, title }) => (
            <Link key={to} to={to} className="hero-tile">
              <Icon size={18} className="hero-tile-icon text-brand" />
              <span className="hero-tile-label">{title}</span>
            </Link>
          ))}
        </div>

        {/* 6 — Hockey.AI positioning: the hero's conclusion */}
        <div className="mt-4">
          <p className="font-display text-sm font-bold">
            Hockey<span className="text-brand">.AI</span>
            <span className="font-sans font-normal text-pitch-300"> — your intelligent World Cup companion</span>
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-pitch-400">
            <span className="text-brand">Analyze.</span> <span className="text-red-400">Predict.</span> <span className="text-sky-400">Experience.</span>
          </p>
        </div>
      </div>
    </section>
  )
}

function Countdown({ kickoffUtc }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = kickoffUtc - now
  if (ms <= 0) return <span className="font-mono text-lg font-bold text-live">STARTING</span>
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = n => String(n).padStart(2, '0')
  return (
    <span className="font-mono text-xl font-bold tracking-wider text-brand">
      {d > 0 && `${d}d `}{pad(h)}:{pad(m)}:{pad(s)}
    </span>
  )
}

function NextMatchCard({ match, teams }) {
  const byCode = new Map(teams.map(t => [t.code, t]))
  const h = byCode.get(match.home), a = byCode.get(match.away)
  const prediction = useLiveQuery(
    () => db.predictions.where('matchId').equals(match.id).toArray()
      .then(rows => rows.find(p => !p.superseded) ?? null), [match.id])
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  return (
    <Link to={`/matches/${match.id}`}
      className="block rounded-2xl border border-brand/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-5 transition-colors hover:border-brand/40">
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-pitch-400">
        <span className="text-brand">Next Match · {phaseTag(match)}</span>
        <span>{formatDate(match.date)}, {match.time} CET</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-4xl">{h?.flag ?? '🏑'}</span>
          <span className="text-sm font-bold">{h?.name ?? match.home}</span>
          <span className="font-mono text-[10px] text-pitch-400">FIH #{h?.fihRank ?? '—'}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">starts in</span>
          <Countdown kickoffUtc={match.kickoffUtc} />
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-4xl">{a?.flag ?? '🏑'}</span>
          <span className="text-sm font-bold">{a?.name ?? match.away}</span>
          <span className="font-mono text-[10px] text-pitch-400">FIH #{a?.fihRank ?? '—'}</span>
        </div>
      </div>
      {pred?.status === 'ready' ? (
        <div className="mt-4">
          <div className="mb-1 flex h-1.5 overflow-hidden rounded-full">
            <div style={{ width: `${pred.reg.home * 100}%` }} className="bg-brand" />
            <div style={{ width: `${pred.reg.draw * 100}%` }} className="bg-pitch-600" />
            <div style={{ width: `${pred.reg.away * 100}%` }} className="bg-sky-400" />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-pitch-400">
            <span className="text-brand">{match.home} {Math.round(pred.reg.home * 100)}%</span>
            <span>Draw {Math.round(pred.reg.draw * 100)}%</span>
            <span className="text-sky-400">{Math.round(pred.reg.away * 100)}% {match.away}</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/10 py-2 text-center font-mono text-[10px] text-pitch-400">
          Computing prediction…
        </div>
      )}
    </Link>
  )
}

// Match alerts for the followed team — start-soon and full-time system
// notifications, raised by the data sync while the app is open or its tab is
// in the background. A static PWA has no push server, so a fully closed app
// stays silent; the tooltip says exactly that.
function AlertsBell() {
  const [on, setOn] = useState(alertsEnabled())
  const toggle = async () => {
    if (on) { disableAlerts(); setOn(false) }
    else setOn(await enableAlerts())
  }
  return (
    <button onClick={toggle} aria-pressed={on}
      title={on ? 'Match alerts on — start and full-time, while the app is open or in the background'
                : 'Notify me when my team plays (works while the app is open or in the background)'}
      className={`ml-1 flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        on ? 'border-brand/40 bg-brand/10 text-brand' : 'border-white/10 bg-pitch-800 text-pitch-400'
      }`}>
      {on ? <Bell size={12} /> : <BellOff size={12} />}
    </button>
  )
}

// The personalized band at the top of Home: your team's state at a glance —
// live now / next up, last-five form, champion probability — with everything a
// link out to its canonical page. When no team is followed yet, one dashed
// invitation and nothing else; when the reader has chosen, Home leads with it.
function FavouriteStrip({ teams, matches }) {
  const favourite = useFavourite()
  const bundle = useOracleBundle(teams, matches)
  if (favourite === null) {
    return (
      <Link to="/teams"
        className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-pitch-900/40 px-4 py-3 text-xs text-pitch-400 transition-colors hover:border-brand/30 hover:text-pitch-300">
        <span className="text-brand">★</span> Follow your team — open any team and tap Follow, and Home leads with them
      </Link>
    )
  }
  const team = teams.find(t => t.code === favourite)
  if (!team) return null

  const mine = matches.filter(m => m.home === favourite || m.away === favourite)
  const liveNow = mine.find(m => effectiveStatus(m) === 'live')
  const nextUp = mine.find(m => effectiveStatus(m) === 'scheduled' && m.home !== 'TBD' && m.away !== 'TBD')
  const played = mine.filter(m => m.status === 'completed' && m.score?.home != null)
  const form = played.slice(-5).map(m => {
    const gf = m.home === favourite ? m.score.home : m.score.away
    const ga = m.home === favourite ? m.score.away : m.score.home
    return gf > ga ? 'W' : gf === ga ? 'D' : 'L'
  })
  const entry = bundle?.current.get(favourite)
  const out = bundle?.eliminationAt.has(favourite)
  const spotlight = liveNow ?? nextUp
  const opponent = spotlight
    ? (spotlight.home === favourite ? spotlight.away : spotlight.home)
    : null

  return (
    <section className="rounded-2xl border border-brand/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-4">
      <div className="flex items-center gap-3">
        <Link to={`/teams/${favourite}`} className="flex min-w-0 items-center gap-2.5">
          <span className="text-3xl">{team.flag}</span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold">
              <span className="truncate">{team.name}</span>
              <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-brand">FOLLOWING</span>
            </div>
            <div className="font-mono text-[10px] text-pitch-400">
              {out ? 'Out of title contention' : entry ? `${formatProbability(entry.champion)} champion` : '…'}
            </div>
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {form.map((r, i) => (
            <span key={i} className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold ${
              r === 'W' ? 'bg-live/15 text-live' : r === 'D' ? 'bg-pitch-700 text-pitch-300' : 'bg-red-400/10 text-red-400'
            }`}>{r}</span>
          ))}
          {alertsSupported() && <AlertsBell />}
        </div>
      </div>
      {spotlight && (
        <Link to={`/matches/${spotlight.id}`}
          className="mt-3 flex min-h-[44px] items-center justify-between rounded-xl border border-white/5 bg-pitch-950/50 px-3.5 py-2.5 transition-colors hover:border-brand/25">
          <span className="flex items-center gap-2 text-xs font-semibold">
            {liveNow
              ? <span className="flex items-center gap-1.5 text-live"><span className="live-dot" /> LIVE</span>
              : <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">Next</span>}
            <span>vs {teams.find(t => t.code === opponent)?.name ?? opponent}</span>
          </span>
          <span className="font-mono text-[10px] text-pitch-400">
            {liveNow
              ? `${spotlight.score?.home ?? 0}–${spotlight.score?.away ?? 0}`
              : `${formatDate(spotlight.date)} · ${spotlight.time} CET`}
          </span>
        </Link>
      )}
    </section>
  )
}

// Home shows a result as a scorecard, nothing more — scorers, corners and the
// pick grade live on the match page a tap away.
function ResultRow({ match, teams }) {
  const byCode = new Map(teams.map(t => [t.code, t]))
  const h = byCode.get(match.home), a = byCode.get(match.away)
  // The final outcome, shoot-out included: a knockout tie level after sixty
  // has a winner, and this row bolds them like any other winner instead of
  // shrugging at the regulation draw.
  const so = match.shootout && match.shootout.home !== match.shootout.away ? match.shootout : null
  const win = match.score.home > match.score.away ? 'H'
    : match.score.home < match.score.away ? 'A'
    : so ? (so.home > so.away ? 'H' : 'A') : 'D'
  return (
    <Link to={`/matches/${match.id}`}
      className="flex min-h-[48px] items-center gap-3 rounded-xl border border-white/5 bg-pitch-800 px-3.5 py-2.5 transition-colors hover:border-brand/25">
      <span className="w-14 shrink-0 font-mono text-[9px] uppercase leading-tight text-pitch-400">{phaseTag(match)}</span>
      <span className={`flex min-w-0 flex-1 items-center justify-end gap-1.5 text-sm ${win === 'H' ? 'font-bold' : 'text-pitch-300'}`}>
        <span className="truncate">{h?.name ?? match.home}</span> <span>{h?.flag}</span>
      </span>
      <span className="shrink-0 rounded-md bg-pitch-950/60 px-2 py-1 font-mono text-sm font-bold tracking-wider">
        {match.score.home}{so && <span className="text-[11px] text-brand"> ({so.home})</span>}
        –
        {so && <span className="text-[11px] text-brand">({so.away}) </span>}{match.score.away}
      </span>
      <span className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm ${win === 'A' ? 'font-bold' : 'text-pitch-300'}`}>
        <span>{a?.flag}</span> <span className="truncate">{a?.name ?? match.away}</span>
      </span>
      <span className="shrink-0 rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[9px] font-bold text-pitch-300">{so ? 'FT (SO)' : 'FT'}</span>
    </Link>
  )
}

function TrendingTeams({ teams, matches }) {
  const bundle = useOracleBundle(teams, matches)
  const cards = useMemo(() => {
    if (!bundle || bundle.snapshots.length < 2) return []
    // Both ends of the delta come from the canonical snapshot series, so
    // `now` is exactly what the Tournament tab and Oracle odds display.
    const last = bundle.current
    const prev = bundle.snapshots[bundle.snapshots.length - 2]
    return teams
      .map(t => ({
        team: t,
        entry: last.get(t.code),
        now: last.championOf(t.code) * 100,
        delta: (last.championOf(t.code) - prev.championOf(t.code)) * 100,
        out: bundle.eliminationAt.has(t.code),
      }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || y.now - x.now)
      .slice(0, 3)
  }, [bundle, teams])

  if (!cards.length) return null
  return (
    <section>
      <SectionHead title="📈 Trending Teams" to="/prediction-race" toLabel="Full race →" />
      <div className="grid gap-2.5 sm:grid-cols-3">
        {cards.map(({ team, entry, now, delta, out }) => (
          <Link key={team.code} to={`/teams/${team.code}`}
            className="rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-colors hover:border-brand/25"
            style={{ background: `linear-gradient(135deg, ${team.color}14, var(--color-pitch-800))` }}>
            <div className="flex items-center gap-2">
              <span className="text-xl">{team.flag}</span>
              <span className="text-sm font-bold">{team.name}</span>
              {out && <span className="rounded bg-red-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-red-400">OUT</span>}
              <span className={`ml-auto flex items-center gap-0.5 font-mono text-[11px] font-bold ${
                delta > 0.05 ? 'text-live' : delta < -0.05 ? 'text-red-400' : 'text-pitch-400'
              }`}>
                {delta > 0.05 ? <ArrowUp size={12} /> : delta < -0.05 ? <ArrowDown size={12} /> : <Minus size={12} />}
                {Math.abs(delta).toFixed(1)}pp
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <TierBadge tier={out ? 'out' : bundle?.tierOf(entry?.teamId)} />
              <span className="font-mono text-[11px] text-brand">{formatProbability(entry?.champion ?? 0)} champion</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

// Home is a glance page: hero, the next (or live) match, the last two
// results, the three biggest movers. Everything deeper lives in its own tab.
export default function HomePage() {
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])

  const loading = teams === undefined || matches === undefined
  // The clock decides what "now" looks like: a match past push-back leads the
  // page as Live (running clock, 0-0 until the first feed update) even before
  // the data cron flips its status. The tick moves the boundary while open.
  const nowTick = useNowTick()
  const live = (matches ?? []).filter(m => effectiveStatus(m, nowTick) === 'live')
  const liveNow = live.length > 0
  const nextUp = (matches ?? []).find(m => effectiveStatus(m, nowTick) === 'scheduled' && m.home !== 'TBD')
  const lastTwo = (matches ?? [])
    .filter(m => m.status === 'completed' && m.score?.home != null)
    .slice(-2)
    .reverse()

  return (
    <div className="space-y-8">
      <HeroCard liveNow={liveNow} />

      {/* What's happening now leads; the personalised strip follows it. */}
      {loading ? <Skeleton h={220} /> : liveNow ? (
        <section>
          <SectionHead title="🔴 Live Now" to="/matches?tab=live" toLabel="Match centre →" />
          <div className="space-y-2.5">
            {live.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      ) : nextUp ? (
        <NextMatchCard match={nextUp} teams={teams ?? []} />
      ) : null}

      {!loading && <FavouriteStrip teams={teams} matches={matches} />}

      {!loading && lastTwo.length > 0 && (
        <section>
          <SectionHead title="⚡ Latest Results" to="/matches?tab=results" toLabel="All results →" />
          <div className="space-y-2">
            {lastTwo.map(m => <ResultRow key={m.id} match={m} teams={teams ?? []} />)}
          </div>
        </section>
      )}

      {!loading && <TrendingTeams teams={teams} matches={matches} />}
    </div>
  )
}
