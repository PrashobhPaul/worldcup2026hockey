import { useState } from 'react'
import LineupSheet from '../components/LineupSheet'
import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { preTournamentHistory } from '../engine/history'
import { db } from '../db'
import { useTeam, phaseTag, formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'
import { deriveClock, effectiveStatus, isLiveClock, phaseLabel } from '../engine/clock'
import { useClockTick } from '../hooks/useClockTick'
import { derivePrediction, gradePrediction, resultDisplay } from '../engine/prediction'
import { buildPreview, h2hKey } from '../engine/preview'
import { impactContext } from '../engine/impact'
import { isAtTournament } from '../engine/bestXI'
import KeyPlayers from '../components/KeyPlayers'
import { ArrowLeft } from 'lucide-react'
import { EventIcon } from '../components/eventIcons'
import MatchIntelligence from '../components/MatchIntelligence'
import { MatchupEdge } from '../components/TeamRatingCard'

function EventRow({ ev, homeCode, homeFlag, awayFlag }) {
  const isHome = ev.team === homeCode
  return (
    <div className={`flex items-center gap-2.5 ${isHome ? 'flex-row' : 'flex-row-reverse text-right'}`}>
      <span className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md bg-pitch-950/60 font-mono text-[11px] font-bold text-brand">
        {ev.minute}'
      </span>
      <EventIcon ev={ev} />
      <div className={isHome ? '' : 'text-right'}>
        <div className="text-sm font-medium">
          {ev.player}
          {ev.type === 'goal' && <span className="ml-1.5 rounded bg-pitch-700 px-1 py-0.5 font-mono text-[9px] font-bold text-pitch-300">{ev.via}</span>}
        </div>
        {ev.assist && <div className="font-mono text-[10px] text-pitch-400">assist: {ev.assist}</div>}
      </div>
      {ev.type === 'goal' && ev._score && (
        <span className={`rounded-md bg-pitch-950/60 px-1.5 py-1 font-mono text-[10px] font-bold text-pitch-300 ${isHome ? 'ml-auto' : 'mr-auto'}`}>
          {homeFlag} {ev._score.h}–{ev._score.a} {awayFlag}
        </span>
      )}
    </div>
  )
}

function StatBar({ label, home, away, asPercent }) {
  if (home == null || away == null) return null
  const total = asPercent ? 100 : (home + away) || 1
  return (
    <div className="mb-2.5">
      <div className="mb-1 grid grid-cols-[2.5rem_1fr_2.5rem] items-baseline gap-2 font-mono text-xs">
        <span className="font-bold text-brand">{home}{asPercent && '%'}</span>
        <span className="text-center text-[10px] uppercase tracking-wider text-pitch-400">{label}</span>
        <span className="text-right font-bold text-sky-400">{away}{asPercent && '%'}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-l-full bg-brand" style={{ width: `${(home / total) * 100}%` }} />
        <div className="flex-1 rounded-r-full bg-sky-400/70" />
      </div>
    </div>
  )
}

function MatchStatsPanel({ match, live }) {
  const s = match.stats
  if (!s?.home || !s?.away) {
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-1 font-display text-sm font-semibold">Match stats</h3>
        <p className="text-xs text-pitch-400">Stats land with the next data update after full-time.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
        Match stats
        <span className="font-mono text-[10px] font-normal text-pitch-400">
          {live ? 'Live · refreshes 60s' : 'Final'}{match.enrichment === 'official' ? ' · FIH' : match.enrichment === 'estimated' ? ' · est.' : ''}
        </span>
      </h3>
      <StatBar label="Goals" home={s.home.goals} away={s.away.goals} />
      <StatBar label="From open play" home={s.home.field_goals} away={s.away.field_goals} />
      <StatBar label="From penalty corners" home={s.home.pc_goals} away={s.away.pc_goals} />
      {(s.home.ps_goals > 0 || s.away.ps_goals > 0) && (
        <StatBar label="From penalty strokes" home={s.home.ps_goals} away={s.away.ps_goals} />
      )}
      <div className="mt-3 flex justify-between border-t border-white/5 pt-2.5 font-mono text-[11px] text-pitch-300">
        <span>🟩 {s.home.green_cards} · 🟨 {s.home.yellow_cards} · 🟥 {s.home.red_cards}</span>
        <span className="text-[10px] uppercase tracking-wider text-pitch-400">Cards</span>
        <span>🟩 {s.away.green_cards} · 🟨 {s.away.yellow_cards} · 🟥 {s.away.red_cards}</span>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-pitch-400">
        Every figure here comes from the FIH match record. Possession, shots and circle
        entries are not part of it — FIH does not publish them, so neither do we.
      </p>
    </div>
  )
}

function CommentaryFeed({ match, home, away }) {
  const [showAll, setShowAll] = useState(false)
  const beats = [...(match.commentary ?? [])].sort((x, y) => y.minute - x.minute || y.seq - x.seq)
  if (!beats.length) return null
  const visible = showAll ? beats : beats.slice(0, 10)
  const colorOf = code => code === match.home ? home?.color : code === match.away ? away?.color : null
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
        Running commentary
        <span className="font-mono text-[10px] font-normal text-pitch-400">
          {match.status === 'live' ? 'Live · running' : 'Full match'} · {beats.length} beats
        </span>
      </h3>
      <div className="space-y-2">
        {visible.map((b, i) => (
          <div key={`${b.seq}-${i}`} className="flex items-start gap-2.5">
            <span className="mt-0.5 w-8 shrink-0 rounded bg-pitch-950/60 py-0.5 text-center font-mono text-[10px] font-bold text-pitch-300">
              {b.minute}'
            </span>
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorOf(b.team) ?? 'var(--color-pitch-600)' }} />
            <p className="text-xs leading-relaxed text-pitch-300">{b.text}</p>
          </div>
        ))}
      </div>
      {beats.length > 10 && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2.5 font-mono text-[11px] text-brand hover:underline">
          {showAll ? 'Show less' : `Show all ${beats.length} beats`}
        </button>
      )}
    </div>
  )
}

function quarterOf(minute) {
  if (minute > 45) return 'Q4'
  if (minute > 30) return 'Q3'
  if (minute > 15) return 'Q2'
  return 'Q1'
}

function AlsoLiveStrip({ currentId }) {
  const all = useLiveQuery(() => db.matches.toArray(), [], [])
  const others = all.filter(m => m.id !== currentId && effectiveStatus(m) === 'live')
  if (!others.length) return null
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {others.map(m => (
        <Link key={m.id} to={`/matches/${m.id}`}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-live/30 bg-pitch-800 px-3 py-1.5 font-mono text-xs">
          <span className="live-dot" />
          <span className="font-bold">{m.home} {m.score?.home ?? 0}–{m.score?.away ?? 0} {m.away}</span>
        </Link>
      ))}
    </div>
  )
}

function tournamentForm(matches, code) {
  return matches
    .filter(m => m.status === 'completed' && m.score?.home != null && (m.home === code || m.away === code))
    .map(m => {
      const gf = m.home === code ? m.score.home : m.score.away
      const ga = m.home === code ? m.score.away : m.score.home
      const opp = m.home === code ? m.away : m.home
      return { id: m.id, result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', gf, ga, opp, home: m.home === code }
    })
}

function FormRow({ name, form }) {
  return (
    <div>
      <div className="text-xs font-semibold">{name}</div>
      <div className="mt-1 font-mono text-[10px] text-pitch-400">
        {form.length
          ? `${form.filter(f => f.result === 'W').length}W ${form.filter(f => f.result === 'D').length}D ${form.filter(f => f.result === 'L').length}L this tournament`
          : 'No completed matches yet'}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {[...form].reverse().map(f => (
          <span key={f.id} title={`${f.home ? 'vs' : '@'} ${f.opp} ${f.gf}-${f.ga}`}
            className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold ${
              f.result === 'W' ? 'bg-live/15 text-live' : f.result === 'L' ? 'bg-red-400/15 text-red-400' : 'bg-pitch-700 text-pitch-300'
            }`}>
            {f.result}
          </span>
        ))}
      </div>
    </div>
  )
}

// One evidence card. The number leads, because the number is the point — the
// prose underneath says where it came from and what it means for this fixture.
const CARD_TONE = {
  brand: 'border-brand/25 text-brand',
  warn: 'border-amber-400/25 text-amber-400',
  pos: 'border-live/25 text-live',
  neutral: 'border-white/10 text-pitch-300',
}

function PreviewCard({ card }) {
  const tone = CARD_TONE[card.tone] ?? CARD_TONE.neutral
  const [border, text] = tone.split(' ')
  return (
    <div className={`rounded-xl border ${border} bg-pitch-800 p-4`}>
      <div className={`mb-3 font-mono text-[10px] font-bold uppercase tracking-widest ${text}`}>
        {card.label}
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`font-mono text-3xl font-bold leading-none ${text}`}>{card.stat}</span>
        <span className="font-mono text-[10px] uppercase leading-tight tracking-wide text-pitch-400">
          {card.statLabel}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold leading-snug">{card.headline}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-pitch-300">{card.text}</p>
      {card.form?.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-pitch-400">Last {card.form.length}</span>
          {card.form.map((r, i) => (
            <span key={i} className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold ${
              r === 'W' ? 'bg-live/15 text-live' : r === 'L' ? 'bg-red-400/15 text-red-400' : 'bg-pitch-700 text-pitch-300'
            }`}>{r}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// Earlier meetings, shown as a record and labelled as one. The pick above is
// argued from this tournament alone, so this block states plainly that it took
// no part in it — otherwise a reader reasonably assumes everything on the page
// fed the prediction.
//
// "Not retrieved" and "no meetings on record" are different claims. h2h.json
// carries only the pairings that existed as fixtures when it last ran, so a
// knockout tie is routinely absent until the pipeline catches up, and printing
// "they have never met" in that gap would be inventing a fact.
function HistoryFacts({ row, home, away, homeName, awayName }) {
  const h = preTournamentHistory(row, home, away)
  if (h.status === 'not-retrieved') return null
  return (
    <div id="sec-history" className="scroll-mt-28 rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-1 flex items-baseline justify-between font-display text-sm font-semibold">
        Before this tournament
        <span className="font-mono text-[10px] font-normal text-pitch-400">record only</span>
      </h3>
      <p className="mb-3 text-[11px] leading-relaxed text-pitch-400">
        Meetings before the 2025-26 Pro League, from the FIH record.
        <span className="text-pitch-300"> Not used in the pick above</span>, which is argued
        from this tournament only.
      </p>
      {h.status === 'none-on-record' ? (
        <p className="font-mono text-xs text-pitch-300">
          No meeting on record before the 2025-26 Pro League.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3 font-mono text-xs">
            <span className="text-pitch-300">{h.played} played</span>
            <span className="text-pitch-600">|</span>
            <span>{homeName} {h.wins[home]}</span>
            <span className="text-pitch-600">|</span>
            <span>{awayName} {h.wins[away]}</span>
            <span className="text-pitch-600">|</span>
            <span className="text-pitch-400">drawn {h.wins.drawn}</span>
          </div>
          <ul className="space-y-1.5">
            {h.meetings.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
                <span className="text-pitch-400">{m.date}</span>
                <span className="flex-1 truncate text-pitch-300">
                  {m.home} {m.score[0]}&ndash;{m.score[1]} {m.away}
                </span>
                <span className="max-w-[45%] truncate text-right text-pitch-500">{m.competition}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default function MatchDetailPage() {
  const { matchId } = useParams()
  const match = useLiveQuery(() => db.matches.get(matchId), [matchId])
  const events = useLiveQuery(
    () => db.match_events.where('matchId').equals(matchId).sortBy('seq'),
    [matchId], [],
  )
  const prediction = useLiveQuery(
    () => db.predictions.where('matchId').equals(matchId).toArray()
      .then(rows => rows.find(p => !p.superseded) ?? null),
    [matchId],
  )
  const story = useLiveQuery(() => db.ai_stories.get(matchId), [matchId])
  const allMatches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
  // Every event in the tournament — the preview deck reasons over all of them,
  // not just this fixture's.
  const allEvents = useLiveQuery(() => db.match_events.toArray(), [], [])
  // Squads, for the key-player cards. Only the players actually at the
  // tournament; the store also holds pre-tournament rows for players who did
  // not travel.
  const allPlayers = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  // The official meeting record for this pair, harvested from TMS.
  const h2hRow = useLiveQuery(
    () => (match?.home && match?.away && match.home !== 'TBD'
      ? db.h2h.get(h2hKey(match.home, match.away)) : undefined),
    [match?.home, match?.away],
  )
  const home = useTeam(match?.home)
  const away = useTeam(match?.away)
  useClockTick(match)

  if (match === undefined) return <Skeleton h={400} />
  if (!match) return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
      Match not found. <Link to="/matches" className="text-brand">← All matches</Link>
    </div>
  )

  const clock = deriveClock(match)
  const done = match.status === 'completed'
  // The clock decides what the header shows: past push-back is live even
  // before the data cron flips the status, and past the match window it is
  // full-time awaiting the official score — never a Q1 that lasts all day.
  const waiting = !done && clock.kind === 'FT_WAIT'
  const live = !done && !waiting && isLiveClock(clock)
  const hasScore = match.score?.home != null && match.score?.away != null
  const res = done ? resultDisplay(match, home, away) : null
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  const grade = prediction ? gradePrediction(match, prediction) : null
  const pc = match.penalty_corners

  // Progressive scoreboard: annotate each goal with the score at that moment
  let _h = 0, _a = 0
  const annotated = (events ?? []).map(ev => {
    if (ev.type !== 'goal') return ev
    if (ev.team === match.home) _h++
    else _a++
    return { ...ev, _score: { h: _h, a: _a } }
  })
  const byQuarter = { Q1: [], Q2: [], Q3: [], Q4: [] }
  for (const ev of annotated) byQuarter[quarterOf(ev.minute)]?.push(ev)

  const preview = buildPreview({ match, home, away, matches: allMatches, events: allEvents, pred, h2h: h2hRow?.meetings })

  // Key players. Past the pools every fixture is a knockout in effect — a
  // semi-final, a medal match or a classification place — and the question a
  // reader arrives with is who decides it. The cards are measured against the
  // whole tournament, so the context is built from every match rather than
  // this one.
  const knockout = match.phase !== 'pool' && match.phase !== 'stage2'
  const keyPlayersShown = knockout && match.home !== 'TBD' && match.away !== 'TBD'
    && allPlayers.length > 0
  // Plain calls, not memos: this sits below the early returns above, and a
  // hook after a conditional return is a hook that sometimes does not run.
  const impact = keyPlayersShown ? impactContext(allPlayers, allMatches) : null
  const byCode = new Map([home, away].filter(Boolean).map(t => [t.code, t]))

  const homeForm = tournamentForm(allMatches, match.home).filter(f => f.id !== match.id)
  const awayForm = tournamentForm(allMatches, match.away).filter(f => f.id !== match.id)
  const h2h = allMatches.filter(m =>
    m.id !== match.id && m.status === 'completed' && m.score?.home != null &&
    ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home)))

  const historyShown = match && match.home !== 'TBD'
    && preTournamentHistory(h2hRow, match.home, match.away).status !== 'not-retrieved'

  // Match Center pills (the Cricbuzz pattern): one sticky row that jumps to a
  // section instead of a scroll hunt. Built from the match's state, so a pill
  // never points at a section that is not on the page.
  // Listed in the page's own render order, so tapping pills left-to-right
  // always moves down the page — a row that jumps backwards reads as broken.
  const pills = [
    pred?.status === 'ready' && { id: 'sec-pick', label: '🎯 Pick' },
    preview.length > 0 && { id: 'sec-preview', label: 'Preview' },
    keyPlayersShown && { id: 'sec-key', label: 'Key players' },
    { id: 'sec-form', label: 'Form' },
    (done || live) && (events?.length ?? 0) > 0 && { id: 'sec-timeline', label: 'Timeline' },
    { id: 'sec-lineups', label: 'Line-ups' },
    (done || live) && { id: 'sec-stats', label: 'Stats' },
    { id: 'sec-intel', label: '🧠 Match Intelligence' },
    story && { id: 'sec-story', label: 'Story' },
    historyShown && { id: 'sec-history', label: 'History' },
  ].filter(Boolean)
  const jumpTo = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
          <ArrowLeft size={14} /> All matches
        </Link>
        <button onClick={() => document.getElementById('sec-intel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="text-xs font-medium text-brand hover:underline">
          🧠 Match Intelligence ↓
        </button>
      </div>

      <AlsoLiveStrip currentId={match.id} />

      {/* Score header */}
      <div className={`rounded-2xl border p-6 ${live ? 'border-live/40' : 'border-white/5'} bg-gradient-to-br from-pitch-800 to-pitch-900`}>
        <div className="mb-4 flex items-center justify-center gap-2 text-center">
          <span className="rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">{phaseTag(match)}</span>
          <span className="font-mono text-[10px] text-pitch-400">
            {formatDate(match.date)} · {match.time} CET · {match.venue === 'AMV' ? 'Wagener Stadion, Amstelveen' : 'Belfius Hockey Arena, Belgium'}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Link to={`/teams/${match.home}`} className="flex flex-col items-center gap-1 text-center">
            <span className="text-5xl">{home?.flag ?? '🏑'}</span>
            <span className="text-sm font-bold">{home?.name ?? match.home}</span>
            <span className="font-mono text-[10px] text-pitch-400">FIH #{home?.fihRank ?? '—'}</span>
          </Link>
          <div className="flex flex-col items-center">
            {(done || live || waiting) ? (
              <>
                <div className={`font-mono text-4xl font-bold tracking-widest ${live ? 'text-live' : ''}`}>
                  {/* In play, the board holds the last value the feed confirmed
                      — 0-0 from push-back until the first update lands. */}
                  {match.score?.home ?? 0}–{match.score?.away ?? 0}
                </div>
                <span className={`mt-1 rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                  live ? 'border border-live/30 bg-live/10 text-live' : 'bg-pitch-700 text-pitch-300'
                }`}>
                  {live && <span className="live-dot mr-1.5 inline-block" />}
                  {live && clock.estimated ? `${phaseLabel(clock.phase)} · ${clock.display}` : clock.display}
                </span>
                {res?.decisiveLine && <span className="mt-1 font-mono text-[11px] text-brand">{res.decisiveLine}</span>}
              </>
            ) : (
              <div className="font-mono text-xl text-pitch-300">{match.time}</div>
            )}
          </div>
          <Link to={`/teams/${match.away}`} className="flex flex-col items-center gap-1 text-center">
            <span className="text-5xl">{away?.flag ?? '🏑'}</span>
            <span className="text-sm font-bold">{away?.name ?? match.away}</span>
            <span className="font-mono text-[10px] text-pitch-400">FIH #{away?.fihRank ?? '—'}</span>
          </Link>
        </div>
        {(live || waiting) && (!hasScore || match.liveScoreAt) && (
          <p className="mt-4 border-t border-white/5 pt-2.5 text-center font-mono text-[10px] leading-relaxed text-pitch-400 opacity-60">
            {waiting
              ? 'Full-time · syncing the official result from FIH'
              : match.liveScoreAt
                ? 'Live score · refreshes periodically · official result confirmed at full-time'
                : 'In progress · syncing with FIH · clock estimated from the official start time'}
          </p>
        )}
        {(done || live) && pc?.home != null && (
          <div className="mt-4 flex justify-center gap-6 border-t border-white/5 pt-3 font-mono text-xs text-pitch-300">
            <span>Penalty corners: <strong className="text-white">{pc.home}</strong> – <strong className="text-white">{pc.away}</strong></span>
          </div>
        )}
      </div>

      {/* Match Center pills */}
      {pills.length > 1 && (
        <div className="no-scrollbar sticky top-14 z-30 -mx-4 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl">
          {pills.map(pill => (
            <button key={pill.id} onClick={() => jumpTo(pill.id)}
              className="min-h-[44px] shrink-0 rounded-md border border-white/5 bg-pitch-800 px-3.5 text-xs font-semibold text-pitch-300 transition-colors hover:border-brand/30 hover:text-brand">
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {/* Oracle panel */}
      {pred?.status === 'ready' && (
        <div id="sec-pick" className="scroll-mt-28 rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🎯 Oracle Pick</span>
            {grade === 'correct' && <span className="rounded bg-live/10 px-2 py-0.5 font-mono text-[10px] font-bold text-live">CORRECT ✓</span>}
            {grade === 'wrong' && <span className="rounded bg-red-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-red-400">WRONG ✗</span>}
            {grade === 'pending' && <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-bold text-brand">PENDING</span>}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold text-brand"
              style={{ background: `conic-gradient(var(--color-brand) ${pred.pickConfidencePct}%, var(--color-pitch-600) 0)` }}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pitch-800">{pred.pickConfidencePct}%</span>
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold">
                {pred.pick === 'HOME' ? home?.name : pred.pick === 'AWAY' ? away?.name : 'Draw'}
                {pred.isKnockout ? ' to advance' : ' to win'}
              </div>
              {prediction.reason && <p className="mt-1 text-xs leading-relaxed text-pitch-300">{prediction.reason}</p>}
              <div className="mt-2 flex gap-3 font-mono text-[10px] text-pitch-400">
                <span>{home?.code} {Math.round(pred.reg.home * 100)}%</span>
                <span>Draw {Math.round(pred.reg.draw * 100)}%</span>
                <span>{away?.code} {Math.round(pred.reg.away * 100)}%</span>
                {pred.isKnockout && <span className="text-brand">SO path {Math.round(pred.paths.shootout * 100)}%</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview: what this tournament's own record says about the fixture */}
      {preview.length > 0 && (
        <div id="sec-preview" className="scroll-mt-28">
          <h3 className="mb-2.5 flex items-baseline justify-between font-display text-sm font-semibold">
            Match preview
            <span className="font-mono text-[10px] font-normal text-pitch-400">from this World Cup only</span>
          </h3>
          <div className="space-y-2.5">
            {preview.map(c => <PreviewCard key={c.kind} card={c} />)}
          </div>
        </div>
      )}

      {keyPlayersShown && (
        <div id="sec-key" className="scroll-mt-28">
          <KeyPlayers home={match.home} away={match.away} players={allPlayers}
            ctx={impact} byCode={byCode} />
        </div>
      )}

      {/* Tournament form */}
      <div id="sec-form" className="scroll-mt-28 rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
          Recent form <span className="font-mono text-[10px] font-normal text-pitch-400">this tournament</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <FormRow name={home?.name ?? match.home} form={homeForm} />
          <FormRow name={away?.name ?? match.away} form={awayForm} />
        </div>
      </div>

      {/* What this tournament's own numbers say separates the two sides —
          the evidence a pick should be able to point at. */}
      <MatchupEdge home={match.home} away={match.away}
        byCode={new Map([[match.home, home], [match.away, away]].filter(([, t]) => t))} />

      <HistoryFacts row={h2hRow} home={match.home} away={match.away}
        homeName={home?.name ?? match.home} awayName={away?.name ?? match.away} />

      {/* Head to head */}
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-2 flex items-baseline justify-between font-display text-sm font-semibold">
          Head to head <span className="font-mono text-[10px] font-normal text-pitch-400">in tournament</span>
        </h3>
        {h2h.length ? (
          <div className="space-y-1.5">
            {h2h.map(m => (
              <Link key={m.id} to={`/matches/${m.id}`}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-pitch-950/40 px-3 py-2 font-mono text-xs transition-colors hover:border-brand/20">
                <span className="font-bold">{m.home} {m.score.home} – {m.score.away} {m.away}</span>
                <span className="text-[10px] text-pitch-400">{phaseTag(m)} · {formatDate(m.date)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-pitch-400">No prior meeting in this tournament yet.</p>
        )}
      </div>

      {/* Quarter timeline */}
      {(done || live) && (events?.length ?? 0) > 0 && (
        <div id="sec-timeline" className="scroll-mt-28 rounded-xl border border-white/5 bg-pitch-800 p-4">
          <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
            Match Timeline
            <span className="font-mono text-[10px] font-normal text-pitch-400">
              scorers + minutes{match.enrichment === 'official' ? ' · official FIH report' : match.enrichment === 'estimated' ? ' · est. from final score' : ''}
            </span>
          </h3>
          <div className="space-y-4">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => byQuarter[q].length > 0 && (
              <div key={q}>
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
                  <span className="h-px w-4 bg-white/10" />{q}
                </div>
                <div className="space-y-2">
                  {byQuarter[q].map((ev, i) => (
                    <EventRow key={i} ev={ev} homeCode={match.home}
                      homeFlag={home?.flag} awayFlag={away?.flag} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Line-ups */}
      <div id="sec-lineups" className="scroll-mt-28">
        <LineupSheet match={match} events={events ?? []} home={home} away={away} />
      </div>

      {/* Match stats */}
      {(done || live) && (
        <div id="sec-stats" className="scroll-mt-28">
          <MatchStatsPanel match={match} live={live} />
        </div>
      )}

      {/* The same intelligence the AI Lab's live tab computes for this match,
          living where the match lives — one component, two homes. */}
      <div id="sec-intel" className="scroll-mt-28">
        <MatchIntelligence match={match} matches={allMatches}
          byCode={new Map([[match.home, home], [match.away, away]])} linkToMatch={false} />
      </div>

      {/* Running commentary */}
      {(done || live) && <CommentaryFeed match={match} home={home} away={away} />}

      {/* AI story */}
      {story && (
        <div id="sec-story" className="scroll-mt-28 rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🧠 AI Match Story</div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-pitch-300">{story.story}</p>
          {/* When it was written is worth knowing. HOW it was written — which
              generator, which model, which pipeline stage — is our plumbing,
              and means nothing to someone reading about the match. */}
          <div className="mt-3 border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
            Updated {new Date(story.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
