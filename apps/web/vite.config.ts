import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content Security Policy, served as a header.
 *
 * Dev and production differ, and the difference is only what Vite's dev server
 * needs: it injects an inline module preamble for React Fast Refresh, opens an
 * HMR WebSocket, and uses inline styles. Production allows none of that.
 *
 * This is a header rather than a `<meta>` tag because a meta CSP applies only
 * from the parser position onward — and Vite's preamble is emitted above where
 * the tag sat, so the policy silently failed to cover the one inline script in
 * the document. On a stricter browser the preamble was blocked, the React
 * plugin could not detect it, and the app rendered a blank page with no error.
 * A meta CSP also cannot express frame-ancestors.
 *
 * NOTE: the production copy of this policy lives in `firebase.json` hosting
 * headers, because Firebase Hosting serves it and JSON cannot import from here.
 * The two must be changed together. `firebase.json` is the one that actually
 * protects users; this one only covers `pnpm dev`.
 *
 * connect-src is the interesting directive: Google identity and Firestore, and
 * nothing else. No analytics, no ad networks, no third-party font or script
 * CDN. jsDelivr appears in img-src only — it serves exercise media (ADR-0007)
 * and must never serve script.
 */
const cspDirectives = (dev: boolean) => ({
  'default-src': "'self'",
  'script-src': dev ? "'self' 'unsafe-inline'" : "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob: https://cdn.jsdelivr.net",
  'font-src': "'self'",
  'connect-src': dev
    ? "'self' ws: wss:"
    : "'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://securetoken.googleapis.com",
  'media-src': "'self' blob:",
  'worker-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  // 'self' in dev only, so the app can be framed at an exact device viewport
  // (e.g. 412x915 for a Pixel 8a) for layout inspection. jsdom has no layout
  // engine, so a real framed viewport is the only way to check a phone layout
  // without a phone. Production stays 'none'.
  'frame-ancestors': dev ? "'self'" : "'none'",
});

const csp = (dev: boolean) =>
  Object.entries(cspDirectives(dev))
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');

export default defineConfig({
  server: {
    headers: { 'Content-Security-Policy': csp(true) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // `prompt`, not `autoUpdate`: a silent swap mid-workout can drop entered
      // sets. The user is told an update is ready and takes it between sessions.
      workbox: {
        // Precache the shell so a cold start in a basement gym works offline.
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
        // The recording harnesses are built into dist but excluded from the
        // deploy by firebase.json's `ignore`. Without this they land in the
        // precache manifest, and because hosting rewrites `**` to /index.html
        // they would resolve to the app's HTML cached under a harness URL, with
        // a revision hash computed from a different file — so both entries get
        // re-fetched on every worker update, forever, for nothing.
        globIgnores: ['pixel8a.html', 'demo.html'],
        // Never cache Firestore or auth traffic — the SDK owns its own
        // offline persistence, and a stale cached response would fight it.
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            // The food index. Version-stamped filenames, so CacheFirst is safe
            // and a new index arrives as a new URL rather than a stale hit.
            //
            // This is not an optimisation. ADR-0030 rule 2 makes local-first
            // non-negotiable and the design context is a basement gym; without
            // this rule the 4.2 MB index is simply absent offline, which is the
            // one situation the bundled index exists for. It also stops the
            // same 4.2 MB being re-fetched on Hosting's default hour-long
            // freshness — the per-user egress ADR-0031 is about.
            urlPattern: /\/data\/.*\.bin\.gz$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'food-index',
              // Two index versions' worth of shards, so an update does not
              // evict the copy currently in use before the swap completes.
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The manifest names the versioned shards, so it must be allowed to
            // change — but it has to work offline too, hence NetworkFirst
            // rather than CacheFirst or nothing.
            urlPattern: /\/data\/.*manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'food-index-manifest',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Exercise media from jsDelivr (ADR-0007), immutable and versioned.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-media',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'TheFreeForeverFitnessApp',
        short_name: 'Free Forever',
        description:
          'Free workout and food logging. Track lifts, scan barcodes, see progress. No account, no subscription, works offline.',
        /*
         * This array did not exist, which is the whole reason an installed app
         * showed a generic tile — a manifest with no icons gives the platform
         * nothing to use, and it falls back to a screenshot or the first letter.
         *
         * `any` and `maskable` are separate entries on purpose. A maskable icon
         * is cropped to whatever shape the platform likes, usually a circle
         * inscribed in ~80% of the tile, so it needs its own generous padding —
         * and if the same rounded artwork is offered for both, the tile's
         * corners show up as notches inside the circle.
         *
         * Regenerate with `node scripts/build-icons.mjs`, which runs on build.
         */
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        theme_color: '#0A1119',
        background_color: '#0A1119',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
      },
    }),
  ],
});
