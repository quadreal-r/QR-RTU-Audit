# QRRTU Audit — iOS app

This is the iOS twin of the Android app. It wraps the same web app
(`index.html` + `piexif.js`) in a native **WKWebView** and provides the same
native features:

- **JS bridge** — `window.AndroidBridge.setKeepScreenOn()` and `deleteCachedPhoto()`
  (defined by the shell so `index.html` runs unchanged).
- **Native GPS** — `navigator.geolocation.getCurrentPosition()` is backed by
  CoreLocation (WKWebView doesn't provide reliable geolocation on its own).
- **Camera** — `<input type="file" capture="environment">` opens the camera / photo picker.
- **On-device persistence** — assets are served over a custom `rtuapp://` origin so
  `localStorage` + `IndexedDB` survive app restarts (a plain `file://` URL does not on iOS).

Files provided in this folder:

```
ios/
  README.md                              <- this tutorial
  QR-RTU-Audit/                          <- iOS source folder (use this)
    ViewController.swift                 <- the whole native shell
    Info-privacy-keys.xml                <- camera/location/photo permission strings
    www/
      index.html                         <- copy of the web app
      piexif.js
  sync-web-assets.ps1                    <- re-copy web app after edits (Windows)
  sync-web-assets.sh                     <- same, for macOS/Linux
```

> On disk the source folder is **`ios/QR-RTU-Audit/`**. In Xcode you create the app as
> **QRRTU Audit** — that is the name users see on the iPhone home screen.

---

## The one hard requirement: a Mac

**You cannot build, run, or install an iOS app without macOS + Xcode.** There is no
Windows path and no way around it — Apple's toolchain (Xcode) is Mac-only, and it does
the signing that lets an app run on an iPhone.

You also need:
- An **iPhone** (iOS 15 or newer recommended) and its **USB/Lightning or USB-C cable**.
- A **free Apple ID** (the one you already use is fine — no paid Developer account needed
  to run on *your own* phone).

> **Free Apple ID limitation:** apps signed with a free Apple ID expire after **7 days**
> and must be re-installed from Xcode. You can install on a limited number of devices.
> That's fine for field testing on your own phone. To remove the 7-day expiry and share
> via TestFlight, you'd enroll in the Apple Developer Program ($99/yr) later — not covered here.

---

## Step 1 — Get this project onto the Mac

Copy the whole **QR-Industrial-RTU-Audit** project folder to the Mac (USB drive, AirDrop,
OneDrive, Git — whatever's easiest). You specifically need the `ios/` folder.

---

## Step 2 — Install Xcode

On the Mac, open the **App Store**, search **Xcode**, install it (it's large, ~7 GB).
Launch it once and accept the license / let it install components.

---

## Step 3 — Create a new Xcode project

> Written for **Xcode 16.4**.

### Important: pick the **iOS** tab, not Multiplatform

On the template screen (before the name/options screen):

1. Xcode → **File → New → Project…**
2. At the **top** of the template chooser, click **iOS** (not **Multiplatform**, not macOS).
3. Select **App**, click **Next**.

If you picked **Multiplatform → App**, you will **not** see an Interface / Storyboard
option — that template is SwiftUI-only. Click **Previous** and switch to **iOS → App**.

### Options on the next screen

| Option | Choose |
|---|---|
| **Product Name** | `QRRTU Audit` |
| **Team** | leave blank for now (Step 7) |
| **Organization Identifier** | `com.quadreal` |
| **Bundle Identifier** | auto is fine (can change later to `com.quadreal.rtuqr`) |
| **Interface** | **Storyboard** (if this row appears) |
| **Language** | **Swift** |
| **Storage** | **None** |
| **Testing System** | **None** (or any; we don't use tests) |

Click **Next** → choose a save location → **Create**.

### If you still see no Storyboard / Interface option

That's OK — create the project with the defaults (SwiftUI). After it opens you will see
files like `QRRTU_AuditApp.swift` and `ContentView.swift` instead of
`ViewController.swift`. Use **Step 4 (SwiftUI path)** below instead of the Storyboard path.

---

## Step 4 — Add the QRRTU Audit shell (`ViewController.swift`)

Pick the path that matches what Xcode created for you.

---

### Path A — You have `ViewController.swift` (Storyboard project)

#### 4a — Find Xcode's stub file

1. Left sidebar = Project navigator (**Cmd+1** if missing).
2. Expand the yellow **QRRTU Audit** group.
3. Open **`ViewController.swift`**.

You should see a short stub (~10 lines). That is what you overwrite.

#### 4b — Copy the real shell from this repo

1. Finder → `QR-Industrial-RTU-Audit` → `ios` → `QR-RTU-Audit`
2. Open **`ViewController.swift`**
3. **Cmd+A** → **Cmd+C**

(`QR-RTU-Audit` is only the folder name on disk; the app is QRRTU Audit.)

#### 4c — Paste into Xcode

1. Back to Xcode's `ViewController.swift`
2. Click in the editor → **Cmd+A** → **Cmd+V** → **Cmd+S**

You should now see imports for `WebKit` and `CoreLocation`. If it's still the short stub,
redo 4a–4c.

#### 4d — Optional drag-in instead of paste

Delete Xcode's stub → drag repo `ViewController.swift` into the **QRRTU Audit** group →
Copy items + add to target **QRRTU Audit**.

#### 4e — Checks

- Don't edit the storyboard; don't rename `class ViewController`
- Red errors until Steps 5–6 are normal

---

### Path B — You only have SwiftUI files (no Storyboard option)

Your project has something like `QRRTU_AuditApp.swift` and `ContentView.swift`.
Do this instead:

#### 4B-a — Add the shell file

1. Finder → `QR-Industrial-RTU-Audit` → `ios` → `QR-RTU-Audit`
2. Drag **`ViewController.swift`** into the yellow **QRRTU Audit** group in Xcode
3. Dialog: check **Copy items if needed**, check target **QRRTU Audit** → **Finish**

#### 4B-b — Point the app at that ViewController

1. Open your `*App.swift` file (name may be `QRRTU_AuditApp.swift`)
2. **Replace the entire file** with:

```swift
import SwiftUI

@main
struct QRRTU_AuditApp: App {
    var body: some Scene {
        WindowGroup {
            ViewControllerHost()
                .ignoresSafeArea()
        }
    }
}

struct ViewControllerHost: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ViewController {
        ViewController()
    }

    func updateUIViewController(_ uiViewController: ViewController, context: Context) {}
}
```

3. If Xcode complains about the struct name `QRRTU_AuditApp`, change it to match the
   `@main` struct name that was already in your file (keep `@main` on that struct).
4. You can ignore or delete `ContentView.swift` — it is unused now.

#### 4B-c — Checks

- Build may still show errors until Steps 5–6 (`www` + privacy keys)
- Do **not** rename `class ViewController` inside the dragged file

---

## Step 5 — Add the web app assets

1. In Finder, open `ios/QR-RTU-Audit/` and locate the **`www`** folder.
2. **Drag the `www` folder** into the Xcode Project navigator, dropping it onto the
   yellow **QRRTU Audit** group.
3. In the dialog that appears:
   - Check **Copy items if needed**
   - Check **Create folder references**  ← *critical.* Pick "folder references" (blue folder
     icon), **not** "groups". This preserves the `www/` directory so the app can load
     `www/index.html`.
   - Check Add to target **QRRTU Audit**.
4. After adding, you should see a **blue** `www` folder in the navigator containing
   `index.html` and `piexif.js`.

---

## Step 6 — Add the privacy permission strings

iOS will crash the app the moment it touches the camera or GPS if these strings are missing.

1. Select the **project** at the top of the navigator → select the **QRRTU Audit** target
   → **Info** tab → expand **Custom iOS Target Properties**.
2. Open `ios/QR-RTU-Audit/Info-privacy-keys.xml` for reference and add these four rows
   (hover any row, click **+**, type the friendly name, set the value):

   - **Privacy - Camera Usage Description** →
     `QRRTU Audit uses the camera to take field photos of rooftop units.`
   - **Privacy - Location When In Use Usage Description** →
     `QRRTU Audit stamps your field photos with GPS coordinates.`
   - **Privacy - Photo Library Usage Description** →
     `QRRTU Audit lets you choose existing photos of rooftop units.`
   - **Privacy - Photo Library Additions Usage Description** →
     `QRRTU Audit can save captured photos to your library.`

---

## Step 7 — Sign with your free Apple ID

1. Select the **QRRTU Audit** target → **Signing & Capabilities** tab.
2. Check **Automatically manage signing**.
3. **Team** dropdown → **Add an Account…** → sign in with your Apple ID →
   back in the dropdown pick your name **(Personal Team)**.
4. If you see a red error about the bundle ID being taken, change the **Bundle Identifier**
   to something unique like `com.quadreal.qrrtuaudit.rp` and let it re-sign.

---

## Step 8 — Run it on your iPhone (sideload)

1. Connect the iPhone by cable. Tap **Trust** on the phone if prompted, enter your passcode.
2. In Xcode's top toolbar, click the device/scheme selector (next to the Run ▶ button)
   and pick your iPhone under **"Devices"** (not a simulator — the simulator has no real
   camera/GPS).
3. Click **Run ▶** (or Cmd+R). Xcode builds, installs, and launches **QRRTU Audit** on the phone.

### First launch — two things happen on the phone

1. **"Untrusted Developer"** — the first time, iOS blocks a free-signed app. On the phone go to
   **Settings → General → VPN & Device Management** → tap your Apple ID under *Developer App*
   → **Trust**. Then re-open the app (or hit Run again).
2. **Permission prompts** — allow **Camera** and **Location ("While Using the App")** when
   asked, so photo capture can open the camera and stamp GPS.

That's it — the app runs the QRRTU Audit UI, saves progress on-device, and uploads to the
same Cloudflare API.

---

## Updating the app after you edit the web app

Whenever you change `index.html` or `piexif.js` in the project root, re-copy them into the
iOS `www` folder and rebuild:

- **On Windows**, from the `ios` folder: `.\sync-web-assets.ps1`
- **On macOS/Linux**, from the `ios` folder: `./sync-web-assets.sh`

Then in Xcode click **Run ▶** again. (If the `www` files were added as *folder references*
in Step 5, Xcode always bundles the current copies — no re-import needed.)

> Reminder: with a free Apple ID the installed app stops opening after **7 days**. Just plug
> in and **Run ▶** from Xcode again to refresh it for another 7 days.

---

## Feature parity with Android — what maps to what

| Android (Kotlin) | iOS (Swift) |
|---|---|
| `WebView` loading `file:///android_asset/www/index.html` | `WKWebView` loading `rtuapp://app/index.html` (custom scheme for persistence) |
| `AndroidBridge.setKeepScreenOn` | `webkit.messageHandlers.setKeepScreenOn` → `UIApplication.isIdleTimerDisabled` |
| `AndroidBridge.deleteCachedPhoto` | `webkit.messageHandlers.deleteCachedPhoto` → clears `RTU_*.jpg` in caches/tmp |
| `navigator.geolocation` (native WebView) | CoreLocation shim injected as `navigator.geolocation` |
| `<input type=file>` + FileProvider camera | native WKWebView file input (camera/photos) |
| localStorage + IndexedDB on device | same, persisted via the `rtuapp://` origin |
| Runtime permissions in Manifest | `Info.plist` usage strings (Step 6) |
| App ID `com.quadreal.rtuqr` | Bundle ID `com.quadreal.rtuqr` (or your unique Personal Team ID) |

## Troubleshooting

- **App opens to a blank white screen** — the `www` folder wasn't added as a *folder
  reference*. Delete it from Xcode and re-do Step 5, making sure "Create folder references"
  (blue folder) is selected.
- **Camera button does nothing / app crashes on capture** — the camera privacy string is
  missing (Step 6).
- **GPS never returns / photos aren't stamped** — the location privacy string is missing,
  or you denied location. Check **Settings → Privacy → Location Services → QRRTU Audit**.
- **"Could not launch — untrusted developer"** — do the Trust step (Step 8, item 1).
- **App quit working after about a week** — free-signing expiry. Re-run from Xcode.
- **Debug the web app** — on the Mac, Safari → Settings → Advanced → "Show Develop menu",
  then with the phone connected: **Develop → [your iPhone] → QRRTU Audit** opens Web Inspector.
