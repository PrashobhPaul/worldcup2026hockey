import { useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { HOF_AWARDS, AWARDS_STATE, AWARDS_DISCLAIMER, POTM_MODEL, potmScore } from '../content/awards'
import { liveAwardLeaders } from '../engine/awards'
import { isAtTournament } from '../engine/bestXI'
import { AwardIcon, DerivedBadge } from '../components/hockeyIcons'

const RING = {
  gold: 'ring-yellow-400/70 shadow-[0_0_14px_rgba(250,204,21,0.25)]',
  silver: 'ring-slate-300/60 shadow-[0_0_14px_rgba(203,213,225,0.2)]',
  bronze: 'ring-amber-600/60 shadow-[0_0_14px_rgba(217,119,6,0.2)]',
}

function GradeChip({ grade }) {
  if (grade === 'correct') return <span className="rounded bg-live/10 px-2 py-0.5 font-mono text-[10px] font-bold text-live">✓ Correct</span>
  if (grade === 'wrong') return <span className="rounded bg-red-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-red-400">✗ Missed</span>
  return <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-bold text-brand">⏳ Pending</span>
}

/** One line naming who leads this award right now. */
function LeadLine({ lead, award, byCode }) {
  if (!lead || lead.status !== 'leading') return null
  const name = lead.player?.name ?? byCode.get(lead.team?.code)?.name ?? lead.team?.code
  const code = lead.player?.team ?? lead.team?.code
  const onTrack = lead.player
    ? lead.player.name === award.oraclePick
    : code === award.oraclePickTeam
  return (
    <div className="mt-0.5 font-mono text-[10px] leading-snug">
      <span className={onTrack ? 'text-live' : 'text-brand'}>Leading: {name}</span>
      <span className="text-pitch-400"> · {lead.stat}</span>
    </div>
  )
}

/**
 * Who leads this award right now, and whether Oracle's frozen pick is the one
 * leading it. The pick itself is never rewritten — this sits beside it.
 */
function LeaderPanel({ award, lead, byCode }) {
  if (!lead || lead.status !== 'leading') {
    return (
      <div className="mt-3 rounded-lg border border-white/5 bg-pitch-800 p-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">Leading now</div>
        <p className="mt-1 text-xs text-pitch-300">Nothing on the record to rank yet.</p>
      </div>
    )
  }
  const name = lead.player?.name ?? byCode.get(lead.team?.code)?.name ?? lead.team?.code
  const code = lead.player?.team ?? lead.team?.code
  const onTrack = lead.player
    ? lead.player.name === award.oraclePick
    : code === award.oraclePickTeam
  return (
    <div className="mt-3 rounded-lg border border-white/5 bg-pitch-800 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">Leading now</span>
        <DerivedBadge derived />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-base leading-none">{byCode.get(code)?.flag ?? '🏑'}</span>
        <span className="text-sm font-bold">{name}</span>
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
          onTrack ? 'bg-live/10 text-live' : 'bg-pitch-700 text-pitch-300'
        }`}>
          {onTrack ? 'Oracle pick leads' : 'Oracle pick trails'}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-pitch-400">{lead.stat}</div>
      {lead.tied && (
        <div className="mt-1 font-mono text-[10px] text-pitch-400">
          Level on the same figure: {lead.tied.slice(1).map(p => p.name).join(', ')}
        </div>
      )}
      {lead.chasers?.length > 0 && (
        <div className="mt-1 font-mono text-[10px] text-pitch-400">
          Next: {lead.chasers.map(c => c.name ?? byCode.get(c.code)?.name ?? c.code).join(' · ')}
        </div>
      )}
    </div>
  )
}

function HallOfFame({ byCode, leaders }) {
  const [openKey, setOpenKey] = useState(null)
  const graded = HOF_AWARDS.filter(a => a.grade !== 'not_graded')
  const correct = graded.filter(a => a.grade === 'correct')

  const sections = []
  for (const a of HOF_AWARDS) {
    const s = sections.find(x => x.title === a.section)
    if (s) s.items.push(a)
    else sections.push({ title: a.section, items: [a] })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">Oracle Award Record</span>
          <span className="font-mono text-[11px] text-pitch-300">
            {graded.length ? `${correct.length} of ${graded.length} correct` : `${HOF_AWARDS.length} picks locked · graded after the Gold Final`}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-pitch-300">
          Picks were locked before the tournament began and are graded against the FIH's official
          awards, announced after the Gold Final on 30 August. No edits, no deletions — the git history is the ledger.
          Until the FIH announces, each award also shows who leads it on the match record so far; that figure is
          Hockey.AI's, recomputed after every completed match, and carries no official standing.
          {leaders?.matchesGraded ? ` Leaders reflect ${leaders.matchesGraded} completed matches.` : ''}
        </p>
      </div>

      {sections.map(sec => (
        <section key={sec.title}>
          <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">{sec.title}</h2>
          <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
            {sec.items.map(a => {
              const open = openKey === a.key
              const team = byCode.get(a.oraclePickTeam)
              return (
                <li key={a.key}>
                  <button onClick={() => setOpenKey(open ? null : a.key)}
                    className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-pitch-700/40">
                    <span className="shrink-0"><AwardIcon awardKey={a.key} size={28} /></span>
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl ring-2 ${RING[a.ringTone]}`}>
                      {team?.flag ?? '🏑'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{a.winner ?? a.oraclePick}</div>
                      <div className="font-mono text-[10px] text-pitch-400">
                        {a.label}{a.winner == null && ' · Oracle pick'}
                      </div>
                      {/* The live leader belongs on the face of the row, not
                          behind a tap: it is the half of this page that moves. */}
                      <LeadLine lead={leaders?.[a.key]} award={a} byCode={byCode} />
                    </div>
                    <GradeChip grade={a.grade} />
                    <span className={`text-pitch-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                  </button>
                  {open && (
                    <div className="border-t border-white/5 bg-pitch-950/30 p-3.5">
                      <div className="font-mono text-[11px] text-pitch-300">{a.statLine}</div>
                      <p className="mt-1.5 text-xs leading-relaxed text-pitch-300">{a.reason}</p>
                      <div className="mt-2 font-mono text-[10px] text-pitch-400">
                        Oracle pick: {a.oraclePick} ({team?.name ?? a.oraclePickTeam})
                        {a.winner && <> · Official winner: {a.winner}</>}
                      </div>
                      <LeaderPanel award={a} lead={leaders?.[a.key]} byCode={byCode} />
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}

      <p className="font-mono text-[10px] leading-relaxed text-pitch-400">{AWARDS_DISCLAIMER}</p>
    </div>
  )
}

/** The one place the race is scored, so every surface reads the same order. */
export function usePotmRace(players, bundle) {
  return useMemo(() => {
    if (!players?.length) return []
    const ctx = { championOf: code => bundle?.current.championOf(code) ?? 0 }
    const scored = players.map(p => ({ ...p, score: potmScore(p, ctx) }))
    const T = POTM_MODEL.softmaxT
    const maxScore = Math.max(...scored.map(p => p.score))
    let z = 0
    for (const p of scored) { p.exp = Math.exp((p.score - maxScore) / T); z += p.exp }
    return scored
      .map(p => ({ ...p, prob: (p.exp / z) * 100 }))
      .sort((a, b) => b.prob - a.prob || a.name.localeCompare(b.name))
  }, [players, bundle])
}

function PotmRace({ byCode, race, bundle }) {
  const [openId, setOpenId] = useState(null)
  const [showAll, setShowAll] = useState(false)

  if (!race.length) return <Skeleton h={400} />
  const top10 = race.slice(0, 10)
  const rest = race.slice(10, 30)

  const row = (p, i) => {
    const t = byCode.get(p.team)
    const open = openId === p.id
    return (
      <li key={p.id} className={i === 0 ? 'border-l-2 border-l-brand' : ''}>
        <button onClick={() => setOpenId(open ? null : p.id)}
          className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-pitch-700/40">
          <span className="w-5 text-center font-mono text-xs font-bold text-pitch-400">{i + 1}</span>
          <span className="text-lg">{t?.flag ?? '🏑'}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{p.name} {i === 0 && '🏆'}</div>
            <div className="font-mono text-[10px] uppercase text-pitch-400">{p.team} · {p.position}</div>
          </div>
          <span className="font-mono text-sm font-bold text-brand">{p.prob.toFixed(1)}%</span>
          <span className={`text-pitch-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        </button>
        {open && (
          <div className="border-t border-white/5 bg-pitch-950/30 p-3.5">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {[
                ['Goals', p.goals],
                ['PC goals', p.pc_scored],
                ['Team odds', formatProbability(bundle?.current.championOf(p.team) ?? 0)],
                ['Score', p.score.toFixed(2)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-pitch-800 p-2">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{k}</div>
                  <div className="mt-0.5 font-mono text-xs font-bold">{v}</div>
                </div>
              ))}
            </div>
            {p.profile && <p className="mt-2 text-xs leading-relaxed text-pitch-300">{p.profile}</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/10 to-pitch-900 p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">Oracle Prediction</p>
        <h2 className="mt-1 font-display text-xl font-bold">🏑 Player of the Tournament 2026</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-400">
            {AWARDS_STATE === 'speculated' ? 'Live race · not the official shortlist' : AWARDS_STATE}
          </span>
        </div>
      </div>

      <section>
        <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Oracle Top 10</h3>
        <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
          {top10.map(row)}
        </ol>
      </section>

      {rest.length > 0 && (
        <section>
          <button onClick={() => setShowAll(!showAll)}
            className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400 hover:text-brand">
            {showAll ? '▾' : '▸'} Ranks 11–{10 + rest.length}
          </button>
          {showAll && (
            <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
              {rest.map((p, i) => row(p, i + 10))}
            </ol>
          )}
        </section>
      )}

      <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">How Oracle scores this</h3>
        <ul className="space-y-1.5 text-xs leading-relaxed text-pitch-300">
          {POTM_MODEL.terms.map(t => (
            <li key={t.key}>
              <strong className="text-brand">{t.label}</strong>
              <span className="font-mono text-[11px] text-pitch-400"> ×{t.weight}</span> — {t.describe}
            </li>
          ))}
        </ul>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-pitch-400">{POTM_MODEL.note}</p>
      </section>
    </div>
  )
}

/**
 * Awards body — rendered inside the Tournament tab (?tab=awards). The old
 * /awards route redirects here so existing links keep working.
 */
export function AwardsView() {
  const [params, setParams] = useSearchParams()
  const view = params.get('awards') === 'potm' ? 'potm' : 'hall-of-fame'
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))
  const bundle = useOracleBundle(teams, matches)
  const race = usePotmRace(players, bundle)
  // The opening day of the tournament, read from the schedule — the junior
  // award is an age cut, and the age that matters is the one on that date.
  const tournamentStart = useMemo(
    () => matches.reduce((min, m) => (!min || m.date < min ? m.date : min), null),
    [matches],
  )
  const leaders = useMemo(
    () => liveAwardLeaders({ players, matches, potmRanked: race, tournamentStart }),
    [players, matches, race, tournamentStart],
  )

  const setView = v => {
    const next = new URLSearchParams(params)
    v === 'hall-of-fame' ? next.delete('awards') : next.set('awards', v)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <p className="mb-4 text-xs text-pitch-400">
        Official FIH awards graded against Oracle&apos;s pre-tournament picks, plus the live Player of the Tournament race.
      </p>

      <div className="mb-5 flex gap-1.5" role="tablist">
        {[['hall-of-fame', 'Hall of Fame'], ['potm', 'Player of the Tournament']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              view === id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {view === 'hall-of-fame'
        ? <HallOfFame byCode={byCode} leaders={leaders} />
        : <PotmRace byCode={byCode} race={race} bundle={bundle} />}

      <div className="mt-6">
        <Link to="/prediction-race" className="text-xs font-medium text-brand hover:underline">Oracle match record →</Link>
      </div>
    </div>
  )
}

/** /awards → the Tournament tab that now hosts it. */
export default function AwardsRedirect() {
  return <Navigate to="/tournament?tab=awards" replace />
}
