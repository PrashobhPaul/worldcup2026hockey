import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getSyncStatus, subscribeSync, syncData } from '../sync'

// A quiet refresh button. The version counter used to live here, but a build
// number means nothing to a reader — what they want is "make it current",
// which is one tap. The status dot still tells the truth at a glance (green
// fresh, amber offline, red failed), the icon spins while a sync runs, and
// the full detail — version, age, any error — stays on the accessible label.
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

  const busy = status.state === 'syncing' || status.state === 'starting'
  const trouble = status.state === 'error' || status.state === 'offline'
  // Tooltips never fire on touch, so a failed sync must be visible in the
  // button itself (red dot + red icon), and the aria-label carries the rest.
  const label = trouble
    ? `Data sync failed${status.error ? ` — ${status.error}` : ''}. Tap to retry.`
    : `Refresh data. Version ${status.version ?? 'unknown'}, synced ${age(status.at)}.`
  return (
    <button onClick={() => syncData({ force: true })} disabled={busy}
      title={label} aria-label={label}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-pitch-800 ${
        trouble ? 'text-red-400' : 'text-pitch-400 hover:text-pitch-200'
      }`}>
      <RefreshCw size={15} className={busy ? 'animate-spin' : undefined} />
      <span className={`absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full ${DOT[status.state] ?? 'bg-pitch-500'}`} />
    </button>
  )
}
