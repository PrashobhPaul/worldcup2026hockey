import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getSyncStatus, subscribeSync, syncData } from '../sync'

// Top-right of the header, no box, two quiet rows:
//   ● LIVE          — sync health as a light: green live, amber offline,
//   28/50 ↻            red failed, pulsing while a sync runs
// The count is tournament matches completed; the whole stack is one tap
// target that refreshes, and the full detail (version, age, any error)
// rides the accessible label.
function age(at) {
  if (!at) return 'unknown'
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

const STATE = {
  fresh:    { dot: 'bg-live', text: 'text-live', word: 'LIVE' },
  synced:   { dot: 'bg-live', text: 'text-live', word: 'LIVE' },
  syncing:  { dot: 'bg-brand animate-pulse', text: 'text-brand', word: 'SYNCING' },
  starting: { dot: 'bg-brand animate-pulse', text: 'text-brand', word: 'SYNCING' },
  offline:  { dot: 'bg-amber-400', text: 'text-amber-400', word: 'OFFLINE' },
  error:    { dot: 'bg-red-400', text: 'text-red-400', word: 'RETRY' },
}

export default function SyncChip() {
  const [status, setStatus] = useState(getSyncStatus)
  useEffect(() => subscribeSync(setStatus), [])

  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const done = matches.filter(m => m.status === 'completed' && m.score?.home != null).length
  const total = matches.length || 50

  const s = STATE[status.state] ?? { dot: 'bg-pitch-500', text: 'text-pitch-400', word: 'SYNC' }
  const busy = status.state === 'syncing' || status.state === 'starting'
  const trouble = status.state === 'error' || status.state === 'offline'
  const label = trouble
    ? `Data sync ${status.state}${status.error ? ` — ${status.error}` : ''}. ${done} of ${total} matches completed. Tap to retry.`
    : `${done} of ${total} matches completed. Refresh data — version ${status.version ?? 'unknown'}, synced ${age(status.at)}.`
  return (
    <button onClick={() => syncData({ force: true })} disabled={busy}
      title={label} aria-label={label}
      className="flex min-h-[44px] shrink-0 flex-col items-end justify-center gap-0.5 px-1 font-mono">
      <span className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest ${s.text}`}>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {s.word}
      </span>
      <span className="flex items-center gap-1 text-xs text-pitch-300">
        {done}/{total}
        <RefreshCw size={11} className={busy ? 'animate-spin' : undefined} />
      </span>
    </button>
  )
}
