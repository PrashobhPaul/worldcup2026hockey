import { useEffect, useState } from 'react'

// Page-level clock for anything derived from Date.now() — effective match
// status, section membership, counts. Dexie queries only re-render on data
// changes, so without this a page mounted before push-back would keep a
// started match under "Upcoming" until the next sync. 30s matches the
// per-card clock cadence.
export function useNowTick(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
