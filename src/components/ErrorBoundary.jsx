import { Component } from 'react'
import { resetLocalData } from '../db'

// The app used to have no boundary at all: any render error blanked the entire
// page, and a reader had no way to tell a crash from a slow load, nor any way
// back short of clearing site data by hand. A cache-only app can always offer
// the way back, so it should.
async function hardReset() {
  try { await resetLocalData() } catch { /* keep going — the reload matters more */ }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map(r => r.unregister()))
  } catch { /* no worker to clear */ }
  try {
    const keys = (await window.caches?.keys?.()) ?? []
    await Promise.all(keys.map(k => caches.delete(k)))
  } catch { /* no cache storage */ }
  window.location.reload()
}

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    // Keep it in the console for a real diagnosis, and on screen for the reader.
    console.error('Hockey.AI crashed while rendering', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-2xl border border-red-400/25 bg-pitch-800 p-5">
          <h1 className="font-display text-lg font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm leading-relaxed text-pitch-300">
            Hockey.AI hit an error while drawing this page. Everything it stores is a copy of
            public tournament data, so resetting is safe — it refetches in a few seconds.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-pitch-950/60 p-3 font-mono text-[10px] text-pitch-400">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => window.location.reload()}
              className="rounded-md border border-white/10 bg-pitch-700 px-3.5 py-1.5 text-xs font-semibold">
              Reload
            </button>
            <button onClick={hardReset}
              className="rounded-md border border-brand/30 bg-brand/10 px-3.5 py-1.5 text-xs font-semibold text-brand">
              Reset app data &amp; reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export { hardReset }
