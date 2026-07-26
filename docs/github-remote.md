# GitHub remote (Windows ↔ Mac)

iOS builds and TestFlight uploads must run on a Mac. Use a **private** GitHub repo as the transport between your Windows machine and Mac.

## One-time setup

1. Create a private empty repo on GitHub (e.g. `QR-Industrial-RTU-Audit`).
2. From this project root:

```bash
git remote add origin https://github.com/<your-user>/QR-Industrial-RTU-Audit.git
git push -u origin main
```

3. On the Mac: `git clone` the same repo, then run `npm install` and the iOS lanes there.

Until `origin` is set, Android/web work continues fine on Windows; only `npm run ship:ios` / `npm run dev:ios` need the Mac.
