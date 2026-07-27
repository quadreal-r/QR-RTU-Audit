# Security — QR Industrial RTU Audit

This document is the human-readable companion to `.cursor/rules/security.mdc`.
It covers threat model, data classification, secrets, vendored dependencies, reporting,
and incident response.

## Threat model

| Surface | Trust | Primary threats |
| --- | --- | --- |
| Cloudflare Worker (`rtu-pictures-api`) | **Only trust boundary** | Brute-force shared password, token theft/reuse, oversized or hostile uploads to R2, cross-origin abuse via wildcard CORS |
| `index.html` (web + embedded copies) | Untrusted (fully readable) | XSS via notes / backup restore, session token theft from `sessionStorage`, client-side bypass of “validation” |
| Android WebView shell | Untrusted host for the SPA | Remote debugging in release, mixed content, over-broad JS bridge / permissions, cleartext |
| iOS WKWebView shell | Untrusted host for the SPA | Local scheme path traversal, inspectable WebView in release, string-built `evaluateJavaScript`, wildcard CORS on local assets |
| R2 bucket `rtu-pictures` | Confidential storage | Public bucket URL, key overwrite / collision, retention of GPS-bearing photos |

Assumptions:

- Field devices may be lost or inspected; the APK/IPA and `index.html` contain no secrets.
- Staff share one `AUTH_PASSWORD`. Compromise of the password or a live Bearer token is treated as full upload capability until revoked.
- Attackers can call the Worker from any network. Rate limits and fail-closed auth are mandatory.

Out of scope for this app: payment card data, end-customer PII databases, multi-tenant SaaS isolation.

## Data classification

| Data | Where it lives | Classification | Notes |
| --- | --- | --- | --- |
| Building addresses, manager names, RTU UIDs | Embedded `DATA` in `index.html`; localStorage keys | Confidential business | Not secret, but not public marketing data |
| Technician free-text notes | `localStorage` (`qr_rtu_v3:*`); optional JSON backup files | Confidential | May name people, defects, access issues — escape on render |
| Audit photos + GPS EXIF | IndexedDB locally; R2 after upload | **Sensitive** | GPS pins rooftop work; treat as the sensitive core |
| Shared audit progress (sticker, photo count, notes) | `public.rtu_audit_state` in Supabase, via the Worker | Confidential | Same sensitivity as the local notes it mirrors; devices never reach Postgres directly |
| Session Bearer token | `sessionStorage` (`rtu_cf_session_token`) | Credential | Short-lived; clear on 401; revoke fleet-wide via `TOKEN_EPOCH` |
| `AUTH_PASSWORD` / `AUTH_SECRET` / `TOKEN_EPOCH` | Cloudflare Worker secrets only | **Secret** | Never in git, never in client |

There is no customer PII store and no payment data in this product.

## Secret inventory and rotation

| Secret | Purpose | Storage | Rotation |
| --- | --- | --- | --- |
| `AUTH_PASSWORD` | Shared staff login for `POST /api/login` | `wrangler secret put AUTH_PASSWORD` | **Every 90 days**, and whenever a technician leaves or a device is lost with a remembered password |
| `AUTH_SECRET` | HMAC key for minting/verifying Bearer tokens | `wrangler secret put AUTH_SECRET` | **Every 90 days**, or immediately if token forgery is suspected (pair with `TOKEN_EPOCH` bump) |
| `TOKEN_EPOCH` | Epoch embedded in token payload; mismatch → reject | `wrangler secret put TOKEN_EPOCH` (or Worker var if configured as such) | Bump anytime to **revoke all outstanding tokens** without waiting for TTL |
| `SUPABASE_SERVICE_KEY` | Lets the Worker read and write `public.rtu_audit_state`; bypasses RLS | `wrangler secret put SUPABASE_SERVICE_KEY` | **Every 90 days.** Prefer a named secret key (`sb_secret_…`) over the legacy `service_role` JWT so it can be revoked on its own in Settings → API Keys |
| Android signing keystore + `keystore.properties` | Release APK signing | Local only; gitignored | Protect offline; do not commit |
| Apple provisioning / certificates | iOS distribution | Local / Apple Developer; gitignored `*.mobileprovision` | Per Apple lifecycle |

### Setting or rotating Worker secrets

```bash
cd cloudflare/rtu-pictures-api
npx wrangler secret put AUTH_PASSWORD
npx wrangler secret put AUTH_SECRET
npx wrangler secret put TOKEN_EPOCH
npx wrangler secret put SUPABASE_SERVICE_KEY
```

Use a new random high-entropy value for `AUTH_SECRET` and a monotonically increasing integer (or timestamp) for `TOKEN_EPOCH`.

### Immediate token revocation (`TOKEN_EPOCH`)

1. Choose a new epoch value (e.g. current Unix time).
2. `npx wrangler secret put TOKEN_EPOCH` and paste the new value.
3. Redeploy if your Worker reads the binding only at deploy time for vars; secrets are available on the next request.
4. All previously issued Bearer tokens fail verification. Staff must sign in again with `AUTH_PASSWORD`.

Also clear `rtu_cf_session_token` from `sessionStorage` on any Worker `401` in the client.

## Vendored dependency: `piexif.js`

| Field | Value |
| --- | --- |
| Library | [piexifjs](https://github.com/hMatoba/piexifjs) (`piexif.js`) |
| Version | **1.0.4** (`that.version = "1.0.4"`) |
| License | MIT — Copyright (c) 2014, 2015 [hMatoba](https://github.com/hMatoba) |
| Role | Read/write JPEG EXIF (including GPS) for audit photos |
| Package manager | **None** — vendored at repo root and copied into Android/iOS `www/` |
| SHA-256 (root `piexif.js`) | `A799F6ECCA79D2B39C14F38D95AD83907F4AA0D064DC17A7148877D1F5BD2D0D` |

Update process: replace the root file from a reviewed upstream release, recompute SHA-256, update this section, re-run asset sync scripts, and bump `APP_VER`/`BUILD`. Dependabot does not cover this file.

## Vulnerability reporting

This is a private internal application. Report suspected vulnerabilities to the repository owner / QuadReal project maintainer (do not open a public issue with exploit details).

Include:

- Affected surface (Worker path, `index.html` behavior, Android/iOS shell)
- Steps to reproduce
- Impact (data exposure, upload abuse, XSS, etc.)
- Whether you have a suggested fix

Expect acknowledgement when the maintainer is available; critical auth/upload issues should be treated as incidents (below).

## Incident response (short)

1. **Contain uploads / login abuse** — confirm Worker rate limits; if needed, rotate `AUTH_PASSWORD` and bump `TOKEN_EPOCH`.
2. **Contain token theft** — bump `TOKEN_EPOCH` immediately; rotate `AUTH_SECRET` if forgery is possible.
3. **Contain R2 exposure** — verify the `rtu-pictures` bucket has no public `r2.dev` URL or public access policy; remove public bindings if present.
4. **Contain client XSS** — ship a patched `index.html` with hardened `esc()` / backup validation; sync Android/iOS assets; bump version.
5. **Rotate** — follow the 90-day table early if the incident involved credentials or devices.
6. **Record** — note what changed (secret versions, epoch, deploy IDs) for the post-incident review.

## Related files

- `.cursor/rules/security.mdc` — always-applied AI/agent baseline
- `.cursor/rules/version-bump.mdc` — `APP_VER` / `BUILD` discipline
- `CONTRIBUTING.md` — PR checklist (“Before you ship”)
- `.github/workflows/ci.yml` — gitleaks, wrangler dry-run, asset parity, version bump
- `.github/dependabot.yml` — Gradle / npm / Actions updates
