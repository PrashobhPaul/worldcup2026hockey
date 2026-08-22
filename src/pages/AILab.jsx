import { useMemo, useState } from 'react'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { derivePrediction } from '../engine/prediction'
import { deriveClock } from '../engine/clock'
import { formatDate, phaseTag } from '../components/MatchCard'
import SiblingNav from '../components/SiblingNav'
import MatchIntelligence from '../components/MatchIntelligence'

const TABS = [
  { id: 'live', label: 'live' },
  { id: 'previews', label: 'previews' },
  { id: 'stories', label: 'stories' },
]

function LivePanel({ matches, teams, byCode, initialMatchId, onSelectMatch }) {
  const [localId, setLocalId] = useState(null)
  const selectedId = localId ?? initialMatchId
  const setSelectedId = (id) => { setLocalId(id); onSelectMatch?.(id) }

  const candidates = useMemo(() => {
    const all = (matches ?? []).filter(m => m.home !== 'TBD')
    const live = all.filter(m => m.status === 'live')
    const done = all.filter(m => m.status === 'completed')
    const next = all.filter(m => m.status === 'scheduled')
    return [...live, ...done.slice(-3).reverse(), ...next.slice(0, 4)]
  }, [matches])

  const match = useMemo(() => {
    if (selectedId) return matches.find(m => m.id === selectedId)
    return candidates.find(m => m.status === 'live') ?? candidates[0]
  }, [selectedId, candidates, matches])

  if (!match) return <div className="text-sm text-pitch-400">Intelligence will appear once fixtures load.</div>

  const clock = deriveClock(match)
  const live = match.status === 'live'
  const done = match.status === 'completed'

  return (
    <div>
      {/* Status banner + match selector */}
      <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[11px] ${
        live ? 'border-live/30 bg-live/5 text-live' : 'border-white/5 bg-pitch-800 text-pitch-400'
      }`}>
        {live ? <><span className="live-dot" /> {clock.kind === 'FT_WAIT'
            ? 'Full-time · awaiting the official score' : `Live · ${clock.display}`}</>
          : done ? <>No match live · showing a recent result</>
          : <>No match live · next match starts {formatDate(match.date)}, {match.time} CET</>}
      </div>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {candidates.map(m => {
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const active = m.id === match.id
          return (
            <button key={m.id} onClick={() => setSelectedId(m.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                active ? 'border-brand/40 bg-brand/10' : 'border-white/5 bg-pitch-800'
              }`}>
              <div className="flex items-center gap-1.5 text-sm font-bold">
                {h?.flag} {m.home} <span className="text-[10px] text-pitch-400">vs</span> {a?.flag} {m.away}
                {m.status === 'live' && <span className="live-dot ml-1" />}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-pitch-400">{phaseTag(m)} · {formatDate(m.date)}</div>
            </button>
          )
        })}
      </div>

      <MatchIntelligence match={match} matches={matches} byCode={byCode} />
    </div>
  )
}

function PreviewsPanel({ matches, teams, byCode }) {
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const byMatch = new Map(predictions.map(p => [p.matchId, p]))

  const upcoming = (matches ?? [])
    .filter(m => m.status !== 'completed' && m.home !== 'TBD')
    .sort((a, b) => (a.status === 'live' ? -1 : b.status === 'live' ? 1 : a.kickoffUtc - b.kickoffUtc))
    .slice(0, 5)

  if (!upcoming.length) return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">No upcoming matches to analyse.</div>

  return (
    <div>
      <div className="mb-4 rounded-xl border border-brand/20 bg-gradient-to-r from-brand/10 to-pitch-800 p-4">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-brand">📡 Next {upcoming.length} fixtures · engine forecast</div>
        <div className="mt-1 font-mono text-[10px] text-pitch-400">FIH-rank Elo + Poisson · picks frozen before the match starts</div>
      </div>
      <div className="space-y-2.5">
        {upcoming.map(m => {
          const row = byMatch.get(m.id)
          const d = row ? derivePrediction({ match: m, row }) : null
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const conf = d?.status === 'ready' ? d.confidence : null
          const tier = conf == null ? null : conf >= 0.55 ? ['high', 'text-live'] : conf >= 0.42 ? ['medium', 'text-sky-400'] : ['low', 'text-pitch-300']
          return (
            <div key={m.id} className="rounded-xl border border-white/5 bg-pitch-800 p-4">
              <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-pitch-400">
                <span className="uppercase tracking-wider">{phaseTag(m)} · {formatDate(m.date)}, {m.time} CET</span>
                {tier && <span className={`rounded bg-pitch-700 px-1.5 py-0.5 font-bold uppercase ${tier[1]}`}>{tier[0]}</span>}
              </div>
              <div className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                <Link to={`/teams/${m.home}`} className="hover:text-brand">{h?.flag} {h?.name ?? m.home}</Link>
                <span className="text-[10px] font-normal text-pitch-400">vs</span>
                <Link to={`/teams/${m.away}`} className="hover:text-brand">{a?.flag} {a?.name ?? m.away}</Link>
              </div>
              {d?.status === 'ready' ? (
                <>
                  <div className="mb-1 flex h-2 overflow-hidden rounded-full">
                    <div style={{ width: `${d.reg.home * 100}%` }} className="bg-brand" />
                    <div style={{ width: `${d.reg.draw * 100}%` }} className="bg-pitch-600" />
                    <div style={{ width: `${d.reg.away * 100}%` }} className="bg-sky-400" />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-pitch-400">
                    <span className="text-brand">{m.home} {Math.round(d.reg.home * 100)}%</span>
                    <span>Draw {Math.round(d.reg.draw * 100)}%</span>
                    <span className="text-sky-400">{Math.round(d.reg.away * 100)}% {m.away}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-xs">
                      Pick: <span className="font-bold text-brand">
                        {d.pick === 'HOME' ? h?.name : d.pick === 'AWAY' ? a?.name : 'Draw'} ({d.pickConfidencePct}%)
                      </span>
                    </span>
                    <Link to={`/matches/${m.id}`} className="font-mono text-[11px] text-brand hover:underline">Open match →</Link>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 py-3 text-center font-mono text-[11px] text-pitch-400">
                  Computing prediction…
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StoriesPanel({ matches, byCode }) {
  const stories = useLiveQuery(() => db.ai_stories.toArray(), [], [])
  const [openId, setOpenId] = useState(null)
  const byMatch = new Map(stories.map(s => [s.matchId, s]))

  const finished = (matches ?? [])
    .filter(m => m.status === 'completed' && m.score?.home != null)
    .sort((a, b) => b.kickoffUtc - a.kickoffUtc)

  if (!finished.length) {
    return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
      No matches have finished yet. Stories appear here automatically after full-time.
    </div>
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">🧠 Post-match stories</h2>
        <span className="font-mono text-[10px] text-pitch-400">{finished.length} finished</span>
      </div>
      <div className="space-y-2">
        {finished.map(m => {
          const s = byMatch.get(m.id)
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const open = openId === m.id
          return (
            <div key={m.id} className="rounded-xl border border-white/5 bg-pitch-800">
              <button onClick={() => setOpenId(open ? null : m.id)} className="flex w-full items-center gap-3 p-3.5 text-left">
                <span className="text-sm font-bold">{h?.flag} {m.home} {m.score.home} – {m.score.away} {m.away} {a?.flag}</span>
                <span className="ml-auto font-mono text-[10px] text-pitch-400">{formatDate(m.date)} · AI Story {s ? '✨' : '⏳'}</span>
              </button>
              {open && (
                <div className="border-t border-white/5 p-3.5">
                  {s ? (
                    <>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-pitch-300">{s.story}</p>
                      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
                        <span>Updated {new Date(s.generatedAt).toLocaleString()}</span>
                        <Link to={`/matches/${m.id}`} className="text-brand hover:underline">Open match →</Link>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-pitch-400">
                      The story for this match isn’t ready yet — it lands shortly after full time.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AILabPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'live'
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))

  const setTab = (t) => {
    const next = new URLSearchParams(params)
    t === 'live' ? next.delete('tab') : next.set('tab', t)
    setParams(next, { replace: true })
  }
  useSwipeTabs({
    count: TABS.length,
    index: TABS.findIndex(t => t.id === tab),
    onChange: i => setTab(TABS[i].id),
  })

  const setMatchParam = (id) => {
    const next = new URLSearchParams(params)
    id ? next.set('match', id) : next.delete('match')
    next.delete('tab')
    setParams(next, { replace: true })
  }

  if (matches === undefined) return <Skeleton h={500} />

  return (
    <div>
      <SiblingNav items={[
        { to: '/prediction-race', label: '🎯 Oracle' },
        { to: '/ai-lab', label: '🧠 AI Lab' },
      ]} />
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🧠 AI Lab</h1>
        <p className="mt-1 text-xs text-pitch-400">
          Per-match AI insight — live momentum, upcoming-fixture previews and post-match stories, recalibrated after every completed match.
        </p>
      </div>

      <div className="sticky top-14 z-30 -mx-4 mb-5 flex gap-1.5 border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`rounded-md border px-3.5 py-1.5 font-mono text-xs font-semibold lowercase transition-colors ${
              tab === t.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <LivePanel matches={matches} teams={teams} byCode={byCode}
          initialMatchId={params.get('match')} onSelectMatch={setMatchParam} />
      )}
      {tab === 'previews' && <PreviewsPanel matches={matches} teams={teams} byCode={byCode} />}
      {tab === 'stories' && <StoriesPanel matches={matches} byCode={byCode} />}
    </div>
  )
}
