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

## Versioning

Bump only in `index.html`:

```js
const APP_VER='vX.Y.Z';
const BUILD=N;
```

`npm run sync` / ship scripts push that into Android `versionName`/`versionCode` and iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`.
