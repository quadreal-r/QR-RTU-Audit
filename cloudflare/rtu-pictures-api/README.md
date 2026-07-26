# rtu-pictures-api

Cloudflare Worker that authenticates field staff and uploads RTU audit photos to R2 bucket **`rtu-pictures`**.

- URL: https://rtu-pictures-api.krutki11.workers.dev
- Login: `POST /api/login` `{ "password": "..." }` → `{ token, expiresInHours }` (8h TTL)
- Session check: `GET /api/me` with `Authorization: Bearer <token>`
- Upload: `PUT /api/upload/:filename` with `Authorization: Bearer <token>` and raw JPEG/PNG body (max 12 MB)

## Security behavior

| Control | Detail |
| --- | --- |
| Rate limits | Login: 8 req / 60s per `CF-Connecting-IP`. Upload: 60 req / 60s per SHA-256 of bearer token. Exceeded → `429` + `Retry-After: 60`. |
| Auth | Constant-time password compare. `AUTH_SECRET` is **required** (no fallback to `AUTH_PASSWORD`). Tokens include `iat`, `jti`, and `TOKEN_EPOCH`; bumping the epoch revokes all sessions. TTL: **8 hours**. |
| CORS | Allowlist only: `https://appassets.androidplatform.net`, `rtuapp://app`. Responses include `Vary: Origin` (no `*`). |
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
- `limits.cpu_ms: 10000` — protective CPU ceiling for this Worker

## R2 bucket public-access expectations

Bucket: **`rtu-pictures`** (binding `PICTURES`).

**Expected (manual checklist — not verified via Cloudflare API in this change):**

- [ ] No public **r2.dev** subdomain enabled for the bucket
- [ ] No public access / anonymous read policy on the bucket
- [ ] Objects are only reachable through this Worker (authenticated upload); there is no public GET endpoint in this API
- [ ] Optional: add an R2 lifecycle rule to expire aged objects (e.g. after N days/months) in the Cloudflare dashboard under R2 → `rtu-pictures` → Settings

**Verified in repo / code:** Worker never exposes a public object URL; uploads require a valid bearer token; CORS is allowlisted (not `*`).

If you have dashboard or API access, confirm the checklist items above before treating this as production-ready.
