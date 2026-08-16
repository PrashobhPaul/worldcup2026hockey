import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// First-visit install banner, mirroring Soccer.AI's install nudge.
// Chrome/Edge/Android: captures beforeinstallprompt and triggers the native flow.
// iOS Safari (no beforeinstallprompt): shows the Share → "Add to Home Screen" hint.
const DISMISS_KEY = 'hockeyai.installPrompt.dismissed'

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return

    const onPrompt = (e) => {
      e.preventDefault()
      setDeferred(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS never fires beforeinstallprompt — show the manual hint after a beat
    let iosTimer
    if (isIos()) {
      iosTimer = setTimeout(() => { setIos(true); setShow(true) }, 4000)
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      clearTimeout(iosTimer)
    }
  }, [])

  if (!show) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-2xl border border-brand/30 bg-pitch-900/95 p-4 shadow-2xl backdrop-blur-xl md:bottom-6">
      <button onClick={dismiss} aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 text-pitch-400 hover:text-white">
        <X size={16} />
      </button>
      <div className="flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Install Hockey.AI</div>
          <p className="mt-0.5 text-[11px] leading-snug text-pitch-300">
            {ios
              ? <>Tap <span className="font-semibold text-white">Share</span> → <span className="font-semibold text-white">Add to Home Screen</span> for the full-screen offline app.</>
              : 'Full-screen, offline-first, live scores on your home screen.'}
          </p>
        </div>
        {!ios && (
          <button onClick={install}
            className="shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-pitch-950 transition-transform active:scale-95">
            Install
          </button>
        )}
      </div>
    </div>
  )
}
