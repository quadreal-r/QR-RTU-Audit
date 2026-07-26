# Field rollout — Capacitor upgrade

**Important:** The Capacitor builds use a different web origin than the old WebView shells.

| Platform | Old origin | New origin |
|----------|------------|------------|
| Android | `file:///android_asset/www/` | `https://localhost` |
| iOS | `rtuapp://app` | `capacitor://localhost` |

Browser storage (`localStorage` + IndexedDB photo cache) is **per-origin**. Installing the Capacitor app over the old one (same package id `com.quadreal.rtuqr` on Android) will look like a fresh install for progress and photos.

## Before upgrading a phone

1. Open the **current** RTU QR app.
2. Use **Export / Backup** (CSV / backup file) from the data card on the home screen.
3. Save the file somewhere safe (Files, email, Drive).
4. Install the new Capacitor build (Firebase App Distribution link, TestFlight, or sideload).
5. Open the new app → **Restore** from that backup file.
6. Confirm a few buildings still show the right checklist state and photos.

## If someone upgrades without backing up

Progress on that device cannot be recovered from the old origin. They will need to re-enter field notes or restore from another device's backup / CSV.

## Testers

- **Android:** join the Firebase App Distribution group (email invite), install from the link.
- **iOS:** join TestFlight after the paid Apple Developer Program is active; until then only devices registered in Xcode can install.
