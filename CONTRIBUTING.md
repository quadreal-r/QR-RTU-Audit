# Contributing — QR Industrial RTU Audit

## Prerequisites

- Changes land via pull request on the **private** GitHub repo (once the remote exists).
- Read `.cursor/rules/security.mdc` and `SECURITY.md` before touching auth, uploads, WebViews, or CORS.
- Bump versions per `.cursor/rules/version-bump.mdc` whenever `index.html` changes.

## PR checklist (Before you ship)

Mirror of the security baseline “Before you ship” section — tick these before requesting review:

- [ ] **Version** — `APP_VER` and `BUILD` bumped in root `index.html` if that file changed.
- [ ] **Asset sync** — re-ran `android/sync-web-assets.ps1` and `ios/sync-web-assets.ps1` (or `.sh`) so
      `android/app/src/main/assets/www/` and `ios/QR-RTU-Audit/www/` stay byte-identical to root
      `index.html` / `piexif.js`.
- [ ] **Android versionName** — kept in step with `APP_VER` when shipping a shell release.
- [ ] **No secrets** — nothing new in `wrangler.jsonc`, client code, or docs that belongs in
      `wrangler secret put` / gitignored keystore files. `.wrangler/` stays untracked.
- [ ] **Worker changes** (if any):
  - [ ] Brute-force `/api/login` → expect `429` (with `Retry-After`) after the limit.
  - [ ] `PUT` ~50 MB body → expect `413`.
  - [ ] `PUT` `text/html` (or non-image) → expect `415`.
  - [ ] Call the API from an unlisted browser origin → expect CORS block.
  - [ ] Duplicate filename uploads → distinct R2 object keys (no overwrite).
- [ ] **Rendering / import changes** (if any):
  - [ ] Paste `"><img src=x onerror=alert(1)>` into a note, save, reload, export, and restore —
        nothing executes.
- [ ] **Native shells** (if any): debug WebView / inspectable flags remain debug-only; no new
      cleartext or wildcard CORS regressions.
- [ ] **CI** — gitleaks, asset-parity, and (on `index.html` PRs) version-bump checks are green.

## Automated review

- Enable **GitHub secret scanning** and **push protection** on the private repo.
- Install **[CodeRabbit](https://coderabbit.ai)** (or Cursor **Bugbot**) on the repo for PR review.
  Repo defaults live in `.coderabbit.yaml`; the GitHub App still must be installed via the UI.
- **Dependabot** is configured in `.github/dependabot.yml` (Gradle, npm, GitHub Actions, weekly).

## Worker toolchain

```bash
cd cloudflare/rtu-pictures-api
npm install          # pins wrangler via package.json
npm run deploy:dry-run
npm run deploy
```

Secrets: see `SECURITY.md` (`AUTH_PASSWORD`, `AUTH_SECRET`, `TOKEN_EPOCH`).

## First-time git / GitHub (maintainers)

If this tree was initialized locally without a remote:

1. Create a **private** GitHub repository.
2. `git remote add origin <url>` and push the default branch.
3. Enable secret scanning + push protection in repo settings.
4. Install CodeRabbit / Bugbot.
5. Confirm Actions and Dependabot are allowed for the private repo.
