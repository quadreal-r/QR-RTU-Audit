# RTU QR Tracker — Android app

Android Studio project that wraps the QuadReal RTU QR Tracker web app in a WebView, with camera and GPS support for field photo capture.

## Open in Android Studio

1. Install **Android Studio** (Ladybug or newer recommended).
2. **File → Open** and select this folder:
   `C:\Users\Robert\Projects\RTU-QR-Tracker\android`
3. Let Gradle sync finish (download SDK/platform packages if prompted).
4. Plug in a phone with **USB debugging**, or start an emulator.
5. Click **Run** (green play) on the `app` configuration.

## First launch on a phone

Allow **Camera** and **Location** when prompted so Photo capture can stamp GPS and open the camera.

## Updating the embedded web app

After you change `index.html` / `piexif.js` in the project root, copy them into the Android assets:

```powershell
Copy-Item ..\index.html .\app\src\main\assets\www\index.html -Force
Copy-Item ..\piexif.js .\app\src\main\assets\www\piexif.js -Force
```

Or run `.\sync-web-assets.ps1` from this `android` folder.

Then rebuild/run the app.

## Package

- Application ID: `com.quadreal.rtuqr`
- Loads: `file:///android_asset/www/index.html`
- Progress saves on-device (WebView localStorage + IndexedDB)
