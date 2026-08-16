import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard, { formatDate, phaseTag } from '../components/MatchCard'
import { SectionHead, Skeleton, TierBadge } from '../components/shared'
import { derivePrediction } from '../engine/prediction'
import { useOracleBundle } from '../engine/oracleBundle'
import { SIM_ID } from '../content/sim'
import { FlaskConical, Trophy, Award, Sparkles, ArrowUp, ArrowDown, Minus } from 'lucide-react'

// Hero quick-access tiles — same four destinations as Soccer.AI's hero card
const heroTiles = [
  { to: '/ai-lab', icon: FlaskConical, title: 'AI Lab' },
  { to: '/tournament?tab=best', icon: Trophy, title: "Tournament's Best" },
  { to: '/awards', icon: Award, title: 'Awards' },
  { to: `/match/sim/${SIM_ID}`, icon: Sparkles, title: 'AI Simulation' },
]

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
          FIH HOCKEY WORLD CUP <span className="text-brand">2026</span>
        </h1>
        <p className="hero-hosts font-semibold text-pitch-300">Belgium &amp; Netherlands</p>

        {/* 3 — Tournament meta */}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <span className="font-mono text-[11px] text-pitch-300">Aug 15 – 30 · 16 Nations</span>
          {liveNow && (
            <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-live">
              <span className="live-dot" /> Live Now
            </span>
          )}
        </div>

        {/* 4 — Feature navigation */}
        <div className="hero-grid">
          {heroTiles.map(({ to, icon: Icon, title }) => (
            <Link key={to} to={to} className="hero-tile">
              <Icon size={18} className="hero-tile-icon text-brand" />
              <span className="hero-tile-label">{title}</span>
            </Link>
          ))}
        </div>

        {/* 5 — Hockey.AI positioning: the hero's conclusion */}
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
  if (ms <= 0) return <span className="font-mono text-lg font-bold text-live">PUSHING BACK</span>
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
    () => db.predictions.where('matchId').equals(match.id).first(), [match.id])
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
          <Countdown kickoffUtc={match.kickoffUtc} />
          <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">to push-back</span>
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

function TrendingTeams({ teams, matches }) {
  const bundle = useOracleBundle(teams, matches)
  const cards = useMemo(() => {
    if (!bundle || bundle.progression.length < 2) return []
    const last = bundle.progression[bundle.progression.length - 1].champion
    const prev = bundle.progression[bundle.progression.length - 2].champion
    return teams
      .map(t => ({
        team: t,
        now: (last[t.code] ?? 0) * 100,
        delta: ((last[t.code] ?? 0) - (prev[t.code] ?? 0)) * 100,
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
        {cards.map(({ team, now, delta, out }) => (
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
              <TierBadge tier={team.contender_tier} />
              <span className="font-mono text-[11px] text-brand">{now.toFixed(1)}% champion</span>
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
  const live = (matches ?? []).filter(m => m.status === 'live')
  const liveNow = live.length > 0
  const nextUp = (matches ?? []).find(m => m.status === 'scheduled' && m.home !== 'TBD')
  const lastTwo = (matches ?? [])
    .filter(m => m.status === 'completed' && m.score?.home != null)
    .slice(-2)
    .reverse()

  return (
    <div className="space-y-8">
      <HeroCard liveNow={liveNow} />

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

      {!loading && lastTwo.length > 0 && (
        <section>
          <SectionHead title="⚡ Latest Results" to="/matches?tab=completed" toLabel="All results →" />
          <div className="space-y-2.5">
            {lastTwo.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {!loading && <TrendingTeams teams={teams} matches={matches} />}
    </div>
  )
}
