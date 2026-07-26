# Capacitor parity checklist

Run on a **real** Android phone and iPhone after `npm run sync`. The old hand-written shells were removed from the tree; they remain in git history (`Snapshot pre-Capacitor state` / `Move hand-written…` commits) if you need to compare.

## Android (`npm run dev:android` or install the release APK)

- [ ] App launches and shows the property list
- [ ] Camera opens from a unit photo slot; JPEG comes back
- [ ] Captured photo shows GPS stamp (EXIF path) when location is allowed
- [ ] Photos still present after force-stop + reopen (IndexedDB)
- [ ] Checklist taps still present after force-stop + reopen (localStorage)
- [ ] Settings → keep screen on holds the screen awake
- [ ] Sign in + photo upload to `rtu-pictures-api` succeeds

## iOS (`npm run dev:ios` or Xcode Run)

- [ ] Same checks as Android
- [ ] Location permission prompt appears and GPS stamps work
- [ ] localStorage / IndexedDB survive app kill (Capacitor origin)

## Release APK smoke (already verified on this machine)

- [x] `npm run sync` succeeds
- [x] Signed `assembleRelease` produces `android/app/build/outputs/apk/release/app-release.apk`
