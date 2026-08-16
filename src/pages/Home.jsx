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
  // When the banner artwork (public/banner.png) is present it IS the card —
  // branding and copy live in the artwork, we only overlay the access tiles.
  // Until the file exists, a text lockup on a banner-palette gradient stands in.
  const [bannerLoaded, setBannerLoaded] = useState(false)

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-pitch-800 to-pitch-900">
      <div className="pointer-events-none absolute inset-0">
        {!bannerLoaded && (
          <>
            <div className="absolute -right-24 top-0 h-full w-2/3 rotate-12 bg-gradient-to-l from-brand/25 via-red-500/15 to-transparent blur-2xl" />
            <div className="absolute -right-10 bottom-0 h-1/2 w-1/2 rotate-45 bg-gradient-to-tl from-sky-500/15 to-transparent blur-3xl" />
          </>
        )}
      </div>
      {bannerLoaded ? (
        <div className="relative">
          <img src={`${import.meta.env.BASE_URL}banner.png`} alt="Hockey.AI — FIH Hockey World Cup 2026"
            className="w-full object-cover" />
          {liveNow && (
            <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-live/40 bg-pitch-950/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-live backdrop-blur">
              <span className="live-dot" /> Live Now
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-pitch-950/95 via-pitch-950/60 to-transparent p-4 pt-10">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {heroTiles.map(({ to, icon: Icon, title }) => (
                <Link key={to} to={to}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-pitch-950/70 px-3 py-2.5 backdrop-blur transition-all hover:border-brand/50 active:scale-[0.98]">
                  <Icon size={16} className="shrink-0 text-brand" />
                  <span className="text-xs font-bold leading-tight">{title}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative p-6 sm:p-8">
          <div className="mb-3 flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-14 w-14 rounded-2xl shadow-[0_0_28px_rgba(255,181,71,0.35)]" />
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Hockey<span className="text-brand">.AI</span>
            </h1>
          </div>
          <p className="max-w-md text-sm text-pitch-300">
            One game. Countless stories. <span className="font-semibold text-white">Stay informed. Stay ahead.</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest text-brand">
              🏑 FIH Hockey World Cup 2026
            </span>
            <span className="font-mono text-[11px] text-pitch-300">Aug 15 – 30 · 16 Nations</span>
            {liveNow && (
              <span className="flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-live">
                <span className="live-dot" /> Live Now
              </span>
            )}
          </div>
          <div className="mt-5 grid max-w-md grid-cols-2 gap-2.5">
            {heroTiles.map(({ to, icon: Icon, title }) => (
              <Link key={to} to={to}
                className="flex min-h-16 items-center gap-2.5 rounded-xl border border-white/10 bg-pitch-950/60 px-3.5 py-3 backdrop-blur transition-all hover:border-brand/40 active:scale-[0.98]">
                <Icon size={18} className="shrink-0 text-brand" />
                <span className="text-sm font-bold leading-tight">{title}</span>
              </Link>
            ))}
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-pitch-400">
            Your World Cup companion · <span className="text-brand">Analyze.</span> <span className="text-red-400">Predict.</span> <span className="text-sky-400">Experience.</span>
          </p>
        </div>
      )}
      {/* Probe the banner asset once; flips the card into artwork mode when it exists */}
      <img src={`${import.meta.env.BASE_URL}banner.png`} alt="" className="hidden"
        onLoad={() => setBannerLoaded(true)} />
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
