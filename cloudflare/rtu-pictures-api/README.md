# rtu-pictures-api

Cloudflare Worker that authenticates field staff, uploads RTU audit photos to R2 bucket
**`rtu-pictures`**, and syncs shared audit progress into Supabase.

- Cloudflare account: **quadreal.rpiwin@gmail.com** (`ed62b8514615e386084ffd47455ec775`), pinned as `account_id` in `wrangler.jsonc`
- URL: https://rtu-pictures-api.quadreal-rpiwin.workers.dev
- Login: `POST /api/login` `{ "password": "..." }` → `{ token, expiresInHours }` (8h TTL)
- Session check: `GET /api/me` with `Authorization: Bearer <token>`
- Upload: `PUT /api/upload/:filename` with `Authorization: Bearer <token>` and raw JPEG/PNG body (max 12 MB)
- Download: `GET /api/photo/:filename` with `Authorization: Bearer <token>` → the JPEG bytes
- Pull progress: `GET /api/audit-state?since=<ISO>` → `{ rows, more, syncedAt }`
- Push progress: `POST /api/audit-state` `{ changes: [...], deviceId }` → `{ rows, accepted, syncedAt }`

## Shared audit progress

Field devices are offline-first: every edit lands in `localStorage` first and syncs later.
This Worker is the only thing that holds Supabase credentials — a phone never talks to
PostgREST, so the anon key is nowhere in the app and `public.rtu_audit_state` has no write
policy at all.

Conflicts resolve **newest edit wins**, decided in Postgres by
`public.rtu_audit_state_sync(jsonb)` rather than in the client, so two devices that were
both offline converge on the same answer. A client timestamp in the future is clamped to
`now()` so a phone with a bad clock cannot pin a row permanently. Rows the caller lost the
race on come back at their stored value, letting the device correct itself in the same
round trip.

Each change is rebuilt from an allowlist (`buildingSlug`, `rtuKey`, `started`, `complete`,
`photosDone`, `note`, `updatedAt`, `photoFiles`) before it reaches Postgres: unknown keys
are dropped, slugs and RTU keys must match a conservative pattern, and notes are capped at
4,000 chars. Batches are capped at 500 changes and 1 MB.

## Photos across devices

The JPEGs never go through Supabase. What travels is `photoFiles`: up to four R2 object
keys, one per photo slot, `null` where the slot is empty. Each name is held to the same
audit-photo pattern the upload route enforces, so sync cannot be used to point a device at
an arbitrary object in a bucket shared with QR East Industrial.

The flow is upload-then-publish, fetch-on-demand:

1. The device that takes a photo queues it and uploads to `PUT /api/upload/:filename` in
   the background, retrying until it lands.
2. Only on success does it record the key and push it through sync. A key in the table
   therefore means the object really exists, so no other device chases a missing file.
3. Another device shows the slot as filled and calls `GET /api/photo/:filename` the first
   time someone actually looks at that RTU, then caches the blob in IndexedDB. Nothing is
   pre-fetched — a technician on cellular does not pay for photos nobody opened.

Deleting a photo clears the slot everywhere, because the published key becomes `null` and
newest-wins carries that to the other devices. **The R2 object itself is left in place**;
the bucket is the audit record of what was shot, and downstream consumers may already have
read it. A retake reuses the same key and overwrites it.

Schema lives in `supabase/migrations/` (`20260727000000_rtu_audit_state.sql`, then
`20260727010000_rtu_audit_photo_files.sql`).

## Object keys and metadata (for downstream consumers)

Objects are written **flat at the bucket root**, using the filename the app generates:

```
2320-RTU-14 (3) (Audit-2026).jpg
```

This matches the existing RTU inventory that QR East Industrial already ingests, so a photo
re-uploaded by "Upload all pictures" **replaces** the previous copy in place rather than
accumulating duplicates. Uploading is therefore idempotent per RTU photo slot.

Because the client chooses the key, the Worker only accepts names matching
`<code>-<RTU label> (<slot>) (Audit-<year>).<jpg|jpeg|png>` and rejects anything else with
`400`. Without that check, an authenticated caller could overwrite unrelated objects in a
bucket shared with another system.

Each object carries custom metadata so **QR East Industrial** can map a photo to an RTU
without parsing the filename:

| Field | Source | Example |
| --- | --- | --- |
| `originalName` | Filename the app generated (same as the object key) | `2320-RTU-14 (3) (Audit-2026).jpg` |
| `uploadedAt` | Server time at upload | `2026-07-26T22:31:04.512Z` |
| `buildingId` | Stable building ID (`X-Building-Id`) | `bldg-12a` |
| `rtuKey` | Stable RTU key (`X-Rtu-Key`) | `RTU_3` |
| `slot` | Photo slot, 1-based (`X-Photo-Slot`) | `1` |
| `auditYear` | Audit year (`X-Audit-Year`) | `2026` |

The four `X-*` headers are client-supplied and therefore untrusted: each is trimmed, reduced
to `[A-Za-z0-9_.-]`, capped at 64 characters, and omitted entirely when empty. Photos also
retain capture EXIF (GPS, `DateTimeOriginal`, `Software`).

## Security behavior

| Control | Detail |
| --- | --- |
| Rate limits | Login: 8 req / 60s per `CF-Connecting-IP`. Upload: 60 req / 60s per SHA-256 of bearer token. Audit sync: 120 req / 60s per SHA-256 of bearer token. Download: 300 req / 60s per SHA-256 of bearer token, since opening one building can request a screenful of photos at once. Exceeded → `429` + `Retry-After: 60`. |
| Auth | Constant-time password compare. `AUTH_SECRET` is **required** (no fallback to `AUTH_PASSWORD`). Tokens include `iat`, `jti`, and `TOKEN_EPOCH`; bumping the epoch revokes all sessions. TTL: **8 hours**. |
| CORS | Allowlist only: `https://rtu-qr-tracker.quadreal-rpiwin.workers.dev` and `https://quadreal-r.github.io` (desktop browsers), `capacitor://localhost` (iOS shell), `https://localhost` (Android shell, per `androidScheme: 'https'`), plus the legacy shells' `https://appassets.androidplatform.net` and `rtuapp://app`. Desktop origins are easy to forget because every surface loads the same `index.html` and differs only in where it is served from — leave one out and sign-in fails at the preflight, before the password is checked, which looks exactly like a wrong password. Note `quadreal-r.github.io` is shared by every Pages site on that account. Responses include `Vary: Origin` (no `*`). Live reload (`npm run dev:ios`) serves from a LAN address that is deliberately **not** allowlisted — sign-in and upload only work in a normal build. |
| Uploads | Requires `Content-Length` ≤ 12 MB. MIME from magic bytes (`FF D8 FF` / PNG signature) only — `415` otherwise. Keys are flat at the bucket root and must match the audit-photo pattern — `400` otherwise. Re-uploading the same RTU photo **overwrites in place** by design, so the pattern check is what stops a caller reaching objects outside that shape. |
| Downloads | Requires a valid bearer token — the bucket stays private and no public URL is ever handed out. The requested name is stripped of any path and must match the audit-photo pattern, so a caller cannot read arbitrary objects out of a bucket shared with QR East Industrial. Unknown key → `404`. |
| Audit sync | Requires a valid bearer token. Missing Supabase config → `503` (never a silent success that reports "synced" while nothing was stored). Supabase errors are reported as `502` with our own text, never PostgREST's, which can echo SQL. The service key never appears in a response. |
| Methods | Wrong method on known routes → `405`. |
| Headers | Every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. |

## Deploy

From this directory:

```bash
npm install
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put AUTH_SECRET
npx wrangler deploy
```

Or dry-run without publishing:

```bash
npm run dry-run
```

## Config & secrets

| Name | Where | Purpose |
| --- | --- | --- |
| `AUTH_PASSWORD` | Worker secret | Shared sign-in password (Settings → Sign in) |
| `AUTH_SECRET` | Worker secret | HMAC signing key for session tokens (**required**; login fails closed with 500 if missing) |
| `TOKEN_EPOCH` | `vars` in `wrangler.jsonc` | Integer/string epoch embedded in tokens. **Increment and redeploy** to revoke every outstanding token |
| `SUPABASE_URL` | `vars` in `wrangler.jsonc` | Project URL for QR-East_Industrial_Database. Public, not a credential |
| `SUPABASE_SERVICE_KEY` | Worker secret | Reads/writes `public.rtu_audit_state`, bypassing RLS. Audit sync fails closed with `503` if missing. Use a named secret key (`sb_secret_…`) from **Settings → API Keys** rather than the legacy `service_role` JWT, so it can be revoked independently |

Generate a strong `AUTH_SECRET` (e.g. `openssl rand -hex 32`) distinct from `AUTH_PASSWORD`.

## Rate limit bindings

Defined in `wrangler.jsonc`:

- `LOGIN_LIMITER` — namespace `1001`, 8 / 60s
- `UPLOAD_LIMITER` — namespace `1002`, 60 / 60s
- `SYNC_LIMITER` — namespace `1003`, 120 / 60s
- `DOWNLOAD_LIMITER` — namespace `1004`, 300 / 60s

Limits are per Cloudflare location and eventually consistent (abuse control, not accounting).

## Observability & limits

- `observability.enabled: true` — Workers Logs
- No `limits.cpu_ms`: this account is on the Workers Free plan, which rejects explicit CPU
  limits and applies its own ceiling. Re-add the limit if the account moves to a paid plan.

## R2 bucket public-access expectations

Bucket: **`rtu-pictures`** (binding `PICTURES`) in the quadreal.rpiwin@gmail.com account.

`wrangler` caches the last-used account in `.wrangler/cache/wrangler-account.json`. That cache
once pointed at a different account, so `account_id` is pinned in `wrangler.jsonc`; confirm
`npx wrangler whoami` reports quadreal.rpiwin@gmail.com before deploying.

**Verified against the account (2026-07-26):**

- [x] Objects are only reachable through this Worker as far as this API is concerned — there is no public GET endpoint here, uploads require a valid bearer token, and CORS is an allowlist (not `*`)
- [ ] **Open finding: public access IS enabled** at `https://pub-1c058fe61f9a431c87286f844358ac0e.r2.dev`. Photos carry GPS EXIF, so anyone holding or guessing an object key can read them unauthenticated. Left in place pending confirmation that no other system serves these objects publicly. To close it:
  `npx wrangler r2 bucket dev-url disable rtu-pictures`
- [ ] Optional: add an R2 lifecycle rule to expire aged objects (e.g. after N days/months) in the Cloudflare dashboard under R2 → `rtu-pictures` → Settings

The bucket is not empty — it held 1,722 objects / 3.34 GB of existing RTU photos at migration time.
