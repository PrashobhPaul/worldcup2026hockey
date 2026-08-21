import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, onDbBlocked } from '../db'
import { getSyncStatus, subscribeSync, syncData } from '../sync'
import { hardReset } from './ErrorBoundary'

// An app with an empty cache renders a shell full of empty tabs. That is not a
// state to leave unexplained: say what happened, and offer the two ways out.
export default function DataBanner() {
  const [status, setStatus] = useState(getSyncStatus)
  const [blocked, setBlocked] = useState(false)
  const teams = useLiveQuery(() => db.teams.count().catch(() => 0), [], null)
  const matches = useLiveQuery(() => db.matches.count().catch(() => 0), [], null)

  useEffect(() => subscribeSync(setStatus), [])
  useEffect(() => onDbBlocked(setBlocked), [])

  const counted = teams != null && matches != null
  const empty = counted && (teams === 0 || matches === 0)
  // Don't flash during the first load: only speak once a sync has settled.
  const settled = ['fresh', 'synced', 'error', 'offline'].includes(status.state)
  if (!blocked && !(empty && settled)) return null

  const message = blocked
    ? 'Another tab has an older version of Hockey.AI open, which is holding the local database. Close it, or reload this page.'
    : status.state === 'offline'
      ? 'No tournament data yet, and the data feed is unreachable. It will keep retrying.'
      : status.error
        ? `No tournament data loaded — ${status.error}`
        : 'No tournament data loaded yet.'

  return (
    <div className="mx-auto max-w-5xl px-4 pt-3">
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3.5">
        <p className="text-xs leading-relaxed text-pitch-200">{message}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button onClick={() => syncData({ force: true })}
            className="rounded-md border border-white/10 bg-pitch-700 px-3 py-1 font-mono text-[11px] font-semibold">
            Retry now
          </button>
          <button onClick={() => window.location.reload()}
            className="rounded-md border border-white/10 bg-pitch-700 px-3 py-1 font-mono text-[11px] font-semibold">
            Reload
          </button>
          <button onClick={hardReset}
            className="rounded-md border border-brand/30 bg-brand/10 px-3 py-1 font-mono text-[11px] font-semibold text-brand">
            Reset app data
          </button>
        </div>
      </div>
    </div>
  )
}
