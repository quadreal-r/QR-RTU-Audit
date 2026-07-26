# iOS signing & TestFlight

## Free Apple ID (today)

1. On a Mac: `git pull` this repo, `npm install`, `npm run sync`.
2. Open `ios/App/App.xcworkspace` in Xcode (not the `.xcodeproj`).
3. Select the **App** target → **Signing & Capabilities** → check **Automatically manage signing**.
4. Choose your personal Team (free Apple ID).
5. Plug in an iPhone, trust the computer, Run (▶).
6. On the phone: Settings → General → VPN & Device Management → trust your developer cert.
7. Builds signed with a free Apple ID **expire after 7 days**.

Live reload from the Mac:

```bash
npm run dev:ios
```

Phone and Mac must be on the same Wi-Fi.

## Paid Apple Developer Program → TestFlight

1. Enroll at https://developer.apple.com/programs/ ($99/yr).
2. In App Store Connect: create the app with bundle id `com.quadreal.rtuqr`.
3. Users and Access → Integrations → App Store Connect API → create a key with **App Manager** access. Download the `.p8`.
4. Put values in `.env`:

```
ASC_KEY_ID=...
ASC_ISSUER_ID=...
ASC_KEY_PATH=AuthKey_XXXX.p8
APPLE_TEAM_ID=...
```

5. One-time on the Mac: `bundle install` (needs Ruby + Bundler).
6. Ship:

```bash
npm run ship:ios
```

That runs `fastlane ios beta` (archive + upload to TestFlight).
