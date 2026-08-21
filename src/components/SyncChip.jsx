import { useEffect, useState } from 'react'
import { getSyncStatus, subscribeSync, syncData } from '../sync'

// "Data as of v93 · 2m" — the engine already shows its work everywhere else;
// this shows its age. Tapping forces a resync, which is the honest answer to
// "is this current?": go and check, right now.
function age(at) {
  if (!at) return '…'
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const DOT = {
  fresh: 'bg-live', synced: 'bg-live',
  syncing: 'bg-brand animate-pulse', starting: 'bg-brand animate-pulse',
  offline: 'bg-amber-400', error: 'bg-red-400',
}

export default function SyncChip() {
  const [status, setStatus] = useState(getSyncStatus)
  const [, tick] = useState(0)

  useEffect(() => subscribeSync(setStatus), [])
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const busy = status.state === 'syncing' || status.state === 'starting'
  return (
    <button onClick={() => syncData({ force: true })} disabled={busy}
      title={status.error ?? 'Data snapshot version and last sync — tap to refresh'}
      aria-label="Refresh tournament data"
      className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md border border-white/5 bg-pitch-800 px-2 font-mono text-[10px] text-pitch-300 transition-colors hover:border-brand/25">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[status.state] ?? 'bg-pitch-500'}`} />
      <span>{status.version != null ? `v${status.version}` : 'sync'}</span>
      <span className="text-pitch-400">·</span>
      <span className="text-pitch-400">{busy ? '…' : age(status.at)}</span>
    </button>
  )
}
