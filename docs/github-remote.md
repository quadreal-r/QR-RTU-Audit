# GitHub remote (Windows ↔ Mac)

iOS builds and TestFlight uploads must run on a Mac. Use a **private** GitHub repo as the transport between your Windows machine and Mac.

## One-time setup

1. Create a private empty repo on GitHub named **`QR-RTU-Audit`**. (The local folder is
   still `QR-Industrial-RTU-Audit`; the names do not have to match.)
2. From this project root:

```bash
git remote add origin https://github.com/<your-user>/QR-RTU-Audit.git
git push -u origin main
```

3. On the Mac: clone the same repo, then run `npm install` and `npm run sync` before opening
   Xcode — `ios/App/App/public/` is gitignored, so a fresh clone has no web assets:

```bash
git clone https://github.com/<your-user>/QR-RTU-Audit.git
cd QR-RTU-Audit
npm install
npm run sync
open ios/App/App.xcodeproj
```

Until `origin` is set, Android/web work continues fine on Windows; only `npm run ship:ios` / `npm run dev:ios` need the Mac.
