# RTU QR Audit — Capacitor distribution

QuadReal industrial RTU QR tracker: one web app (`index.html`) wrapped with Capacitor for iOS/Android, plus a Cloudflare Worker for photo uploads.

## Day-to-day commands

| Command | What it does |
|---------|----------------|
| `npm run dev` | Live reload in a desktop browser |
| `npm run dev:android` | Live reload on a USB/Wi-Fi Android phone |
| `npm run dev:ios` | Live reload on iPhone (Mac + Xcode) |
| `npm run sync` | Build `www/`, sync version, `cap sync` |
| `npm run ship:android` | Signed APK → Firebase App Distribution |
| `npm run ship:ios` | Archive → TestFlight (paid Apple Developer) |
| `npm run ship:web` | Deploy tracker site to Cloudflare |
| `npm run ship:api` | Deploy `rtu-pictures-api` Worker |

## First-time setup

```bash
npm install
cp .env.example .env   # then fill secrets (keystore passwords already in local .env if generated)
npm run sync
```

See:

- [docs/github-remote.md](docs/github-remote.md) — private GitHub for Windows ↔ Mac
- [docs/ios-signing.md](docs/ios-signing.md) — free Apple ID + TestFlight
- [docs/ROLLOUT.md](docs/ROLLOUT.md) — **backup before upgrading** (origin change)
- [docs/PARITY_CHECKLIST.md](docs/PARITY_CHECKLIST.md) — device QA before removing `legacy-shells/`
- [cloudflare/rtu-pictures-api/README.md](cloudflare/rtu-pictures-api/README.md) — photo API

## Installing from a link (PWA)

Anyone sent the tracker URL can install it without an app store:

- **Chrome / Edge (Android, desktop)** — an "Install RTU Audit" bar appears at the bottom, and Settings has an **Install app** button. Both use the browser's own install prompt.
- **iPhone / iPad** — Safari has no install API, so the same bar reads "Tap Share, then Add to Home Screen".

`manifest.webmanifest` and `sw.js` live at the repo root and are copied into `www/` by `npm run build:web`, which also stamps `APP_VER` into the service worker's cache name so a deploy can never be served from a stale cache. Icons are generated from the iOS app icon by `scripts/make-pwa-icons.ps1`.

The service worker is network-first: online you always get the newest build, offline you get the last one that loaded. It only ever caches same-origin app files — audit rows, photos and tokens are cross-origin and pass straight through, so nothing sensitive lands in Cache Storage. It is skipped inside the Capacitor shells, which already ship the app.

## Versioning

Bump only in `index.html`:

```js
const APP_VER='vX.Y.Z';
const BUILD=N;
```

`npm run sync` / ship scripts push that into Android `versionName`/`versionCode` and iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`.
