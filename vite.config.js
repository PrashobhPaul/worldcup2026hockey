import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages project sites serve from /<repo>/ — the deploy workflow passes
// BASE_PATH from actions/configure-pages; Cloudflare/custom-domain builds get "/".
//
// A CNAME settles it on its own, and has to: actions/configure-pages reports
// the repo's *current* Pages setting, so on the very deploy that introduces
// the domain it still answers /worldcup2026hockey/ — baking that prefix into
// every asset URL of a build about to be served from the domain root, which
// loads nothing at all. The file in the artifact is what decides where the
// site lands, so it decides the base too.
const base = existsSync(new URL('./public/CNAME', import.meta.url))
  ? '/'
  : `${process.env.BASE_PATH || ''}/`

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          db: ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'og.png', 'logo.png'],
      manifest: {
        name: 'Hockey.AI',
        short_name: 'Hockey.AI',
        description: 'AI stories, match intelligence, simulations and visual analytics for the FIH Hockey World Cup 2026.',
        id: `${base}?v=1`,
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#0b1736',
        background_color: '#0b1736',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // A new deploy must take over immediately, not sit behind the old
        // worker until every tab closes — that stickiness is what left
        // installed apps showing stale results. clientsClaim + skipWaiting
        // hand control to the fresh worker on first load; cleanupOutdatedCaches
        // evicts the previous precache so no stale shell lingers.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/data/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hockeyai-data',
              // The app aborts its own fetch at 12s, so the handler needs room
              // to answer from cache before the caller gives up. Six was short
              // enough that an ordinary slow mobile response counted as a
              // failure and lit the OFFLINE chip on a working phone.
              networkTimeoutSeconds: 10,
              // The feed is a fixed set of files, and sync.js no longer appends
              // a unique `?t=` to every request. ignoreSearch keeps a stray
              // query string from hiding the cached copy the fallback needs.
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 50, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'hockeyai-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 31536000 }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'hockeyai-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 2592000 }
            }
          }
        ]
      }
    })
  ]
})
