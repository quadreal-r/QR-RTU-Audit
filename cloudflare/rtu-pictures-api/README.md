# rtu-pictures-api

Cloudflare Worker that authenticates field staff and uploads RTU audit photos to R2 bucket **`rtu-pictures`**.

- Cloudflare account: **quadreal.rpiwin@gmail.com** (`ed62b8514615e386084ffd47455ec775`), pinned as `account_id` in `wrangler.jsonc`
- URL: https://rtu-pictures-api.quadreal-rpiwin.workers.dev
- Login: `POST /api/login` `{ "password": "..." }` → `{ token, expiresInHours }` (8h TTL)
- Session check: `GET /api/me` with `Authorization: Bearer <token>`
- Upload: `PUT /api/upload/:filename` with `Authorization: Bearer <token>` and raw JPEG/PNG body (max 12 MB)

## Object keys and metadata (for downstream consumers)

Objects are written to `uploads/YYYY-MM-DD/<8-hex>-<safeName>`. The random prefix guarantees
an upload can never overwrite an existing object, so re-running "Upload all pictures"
produces new keys for photos already in the bucket — dedupe on `originalName` and keep the
latest `uploadedAt`.

Each object carries custom metadata so **QR East Industrial** can map a photo to an RTU
without parsing the filename:

| Field | Source | Example |
| --- | --- | --- |
| `originalName` | Filename the app generated | `12A-RTU-3 (1) (Audit 2026).jpg` |
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
| Rate limits | Login: 8 req / 60s per `CF-Connecting-IP`. Upload: 60 req / 60s per SHA-256 of bearer token. Exceeded → `429` + `Retry-After: 60`. |
| Auth | Constant-time password compare. `AUTH_SECRET` is **required** (no fallback to `AUTH_PASSWORD`). Tokens include `iat`, `jti`, and `TOKEN_EPOCH`; bumping the epoch revokes all sessions. TTL: **8 hours**. |
| CORS | Allowlist only: `capacitor://localhost` (iOS shell), `https://localhost` (Android shell, per `androidScheme: 'https'`), plus the legacy shells' `https://appassets.androidplatform.net` and `rtuapp://app`. Responses include `Vary: Origin` (no `*`). Live reload (`npm run dev:ios`) serves from a LAN address that is deliberately **not** allowlisted — sign-in and upload only work in a normal build. |
| Uploads | Requires `Content-Length` ≤ 12 MB. MIME from magic bytes (`FF D8 FF` / PNG signature) only — `415` otherwise. Object keys are `uploads/YYYY-MM-DD/<8-hex>-<safeName>`. |
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

Generate a strong `AUTH_SECRET` (e.g. `openssl rand -hex 32`) distinct from `AUTH_PASSWORD`.

## Rate limit bindings

Defined in `wrangler.jsonc`:

- `LOGIN_LIMITER` — namespace `1001`, 8 / 60s
- `UPLOAD_LIMITER` — namespace `1002`, 60 / 60s

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
