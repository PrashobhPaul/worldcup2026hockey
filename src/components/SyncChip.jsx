import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getSyncStatus, subscribeSync, syncData } from '../sync'

// The top-right stats box: tournament progress with the refresh built in —
// "28/50 ↻" — because the count is exactly the thing a refresh updates. The
// status dot tells the sync truth at a glance (green fresh, amber offline,
// red failed), the icon spins while a sync runs, and the full detail —
// completed matches, data version, age, any error — rides the accessible
// label. One tap anywhere on the box refreshes.
function age(at) {
  if (!at) return 'unknown'
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

const DOT = {
  fresh: 'bg-live', synced: 'bg-live',
  syncing: 'bg-brand animate-pulse', starting: 'bg-brand animate-pulse',
  offline: 'bg-amber-400', error: 'bg-red-400',
}

export default function SyncChip() {
  const [status, setStatus] = useState(getSyncStatus)
  useEffect(() => subscribeSync(setStatus), [])

  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const done = matches.filter(m => m.status === 'completed' && m.score?.home != null).length
  const total = matches.length || 50

  const busy = status.state === 'syncing' || status.state === 'starting'
  const trouble = status.state === 'error' || status.state === 'offline'
  // Tooltips never fire on touch, so a failed sync must be visible in the
  // chip itself (red dot + red icon), and the aria-label carries the rest.
  const label = trouble
    ? `Data sync failed${status.error ? ` — ${status.error}` : ''}. Tap to retry.`
    : `${done} of ${total} matches completed. Refresh data — version ${status.version ?? 'unknown'}, synced ${age(status.at)}.`
  return (
    <button onClick={() => syncData({ force: true })} disabled={busy}
      title={label} aria-label={label}
      className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 font-mono text-xs transition-colors ${
        trouble ? 'border-red-400/30 bg-red-400/10 text-red-400'
                : 'border-brand/20 bg-brand/10 text-brand hover:border-brand/40'
      }`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[status.state] ?? 'bg-pitch-500'}`} />
      <span>{done}/{total}</span>
      <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} />
    </button>
  )
}
