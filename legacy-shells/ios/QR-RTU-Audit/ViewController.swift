//
//  ViewController.swift
//  QR-RTU-Audit  (com.quadreal.rtuqr)
//
//  iOS equivalent of the Android WebView shell (MainActivity.kt).
//  Wraps the QRRTU Audit web app (index.html + piexif.js)
//  in a WKWebView, and provides the same native features:
//
//   * JS bridge  ->  window.AndroidBridge.setKeepScreenOn / .deleteCachedPhoto
//   * Native GPS ->  navigator.geolocation.getCurrentPosition (CoreLocation shim)
//   * Camera     ->  <input type="file" capture="environment"> (handled natively)
//   * On-device persistence -> web assets served over a custom "rtuapp://" scheme
//     so localStorage + IndexedDB survive app restarts (a plain file:// URL does not
//     persist reliably on iOS).
//
//  The web app checks for `window.AndroidBridge`, so we define it here and forward
//  the calls to native code. No changes to index.html are required.
//
//  ATS stays at Info.plist defaults with zero exception domains.
//

import UIKit
import WebKit
import CoreLocation

class ViewController: UIViewController,
                      WKScriptMessageHandler,
                      WKUIDelegate,
                      WKNavigationDelegate,
                      CLLocationManagerDelegate {

    private var webView: WKWebView!
    private let locationManager = CLLocationManager()
    private var pendingGeoRequests: [String] = []   // geolocation request ids awaiting a fix

    // Custom scheme + host used to serve the bundled web app with a stable origin.
    private let appScheme = "rtuapp"
    private let appHost   = "app"

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.requestWhenInUseAuthorization()

        setupWebView()
        loadWebApp()
    }

    // MARK: - WebView setup

    private func setupWebView() {
        let controller = WKUserContentController()
        controller.add(self, name: "setKeepScreenOn")
        controller.add(self, name: "deleteCachedPhoto")
        controller.add(self, name: "getLocation")
        controller.addUserScript(
            WKUserScript(source: Self.bridgeJS,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: false)
        )

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Serve the bundled www/ folder over rtuapp:// for a persistent origin.
        if let wwwURL = Bundle.main.url(forResource: "www", withExtension: nil) {
            config.setURLSchemeHandler(LocalSchemeHandler(root: wwwURL),
                                       forURLScheme: appScheme)
        }

        if #available(iOS 14.0, *) {
            config.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Safari Web Inspector in debug builds only
        }
        #endif
        view.addSubview(webView)
    }

    private func loadWebApp() {
        // Prefer the persistent custom-scheme origin. Fall back to file:// if the
        // scheme handler could not be registered (asset folder missing).
        if Bundle.main.url(forResource: "www", withExtension: nil) != nil {
            if let url = URL(string: "\(appScheme)://\(appHost)/index.html") {
                webView.load(URLRequest(url: url))
                return
            }
        }
        if let fileURL = Bundle.main.url(forResource: "index",
                                         withExtension: "html",
                                         subdirectory: "www") {
            webView.loadFileURL(fileURL,
                                allowingReadAccessTo: fileURL.deletingLastPathComponent())
        }
    }

    // MARK: - JS -> native messages

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        switch message.name {
        case "setKeepScreenOn":
            let on = (message.body as? Bool) ?? false
            UIApplication.shared.isIdleTimerDisabled = on

        case "deleteCachedPhoto":
            clearCachedPhotos(named: message.body as? String)

        case "getLocation":
            if let id = message.body as? String { requestLocation(for: id) }

        default:
            break
        }
    }

    /// Mirror of MainActivity.deleteCachedPhoto: remove RTU_*.jpg camera dumps
    /// from the app's temporary and caches directories.
    private func clearCachedPhotos(named name: String?) {
        let fm = FileManager.default
        var dirs = [fm.temporaryDirectory]
        if let caches = try? fm.url(for: .cachesDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: false) {
            dirs.append(caches)
        }
        for dir in dirs {
            guard let files = try? fm.contentsOfDirectory(at: dir,
                                                          includingPropertiesForKeys: nil) else { continue }
            for f in files {
                let n = f.lastPathComponent
                if n.hasPrefix("RTU_") && (n.hasSuffix(".jpg") || n.hasSuffix(".jpeg")) {
                    try? fm.removeItem(at: f)
                }
            }
            if let name = name, !name.isEmpty {
                let safe = name.replacingOccurrences(of: "[^\\w.\\- ()]+",
                                                     with: "_",
                                                     options: .regularExpression)
                try? fm.removeItem(at: dir.appendingPathComponent(safe))
            }
        }
    }

    // MARK: - Geolocation (CoreLocation-backed shim)

    private func requestLocation(for id: String) {
        let status: CLAuthorizationStatus
        if #available(iOS 14.0, *) {
            status = locationManager.authorizationStatus
        } else {
            status = CLLocationManager.authorizationStatus()
        }

        switch status {
        case .denied, .restricted:
            rejectGeo(id: id, code: 1, message: "Location permission denied")
        case .notDetermined:
            // Auth prompt is in flight; queue and (re)request. The callback fires
            // once the user responds and a fix arrives.
            pendingGeoRequests.append(id)
            locationManager.requestWhenInUseAuthorization()
        default:
            pendingGeoRequests.append(id)
            locationManager.requestLocation()   // one-shot fix
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // If a request was waiting on the permission prompt, kick it off now.
        if !pendingGeoRequests.isEmpty {
            let status = manager.authorizationStatus
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                locationManager.requestLocation()
            } else if status == .denied || status == .restricted {
                let ids = pendingGeoRequests; pendingGeoRequests.removeAll()
                ids.forEach { rejectGeo(id: $0, code: 1, message: "Location permission denied") }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager,
                         didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let ids = pendingGeoRequests; pendingGeoRequests.removeAll()
        let ts = Int(loc.timestamp.timeIntervalSince1970 * 1000)
        for id in ids {
            evalBridgeFn("__iosGeoResolve", args: [
                id,
                loc.coordinate.latitude,
                loc.coordinate.longitude,
                loc.horizontalAccuracy,
                loc.altitude,
                loc.verticalAccuracy,
                loc.course,
                loc.speed,
                ts
            ])
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let ids = pendingGeoRequests; pendingGeoRequests.removeAll()
        ids.forEach { rejectGeo(id: $0, code: 2, message: error.localizedDescription) }
    }

    private func rejectGeo(id: String, code: Int, message: String) {
        evalBridgeFn("__iosGeoReject", args: [id, code, message])
    }

    /// JSON-encode arguments before evaluateJavaScript to avoid injection via geo messages.
    private func evalBridgeFn(_ name: String, args: [Any]) {
        guard JSONSerialization.isValidJSONObject(args),
              let data = try? JSONSerialization.data(withJSONObject: args),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.\(name).apply(null, \(json));",
                                   completionHandler: nil)
    }

    // MARK: - WKNavigationDelegate: open external links in Safari

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased() {
            if scheme == "http" || scheme == "https",
               navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    // MARK: - Injected JavaScript (bridge + geolocation shim)

    private static let bridgeJS = """
    (function () {
      // --- AndroidBridge shim: forward to native message handlers -------------
      window.AndroidBridge = {
        setKeepScreenOn: function (on) {
          try { window.webkit.messageHandlers.setKeepScreenOn.postMessage(!!on); } catch (e) {}
        },
        deleteCachedPhoto: function (name) {
          try { window.webkit.messageHandlers.deleteCachedPhoto.postMessage(name || ''); } catch (e) {}
        }
      };

      // --- Geolocation shim backed by native CoreLocation ---------------------
      var geoCallbacks = {};
      var geoSeq = 0;

      window.__iosGeoResolve = function (id, lat, lng, acc, alt, altAcc, heading, speed, ts) {
        var cb = geoCallbacks[id]; if (!cb) return; delete geoCallbacks[id];
        if (cb.success) {
          cb.success({
            coords: {
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              altitude: (alt < 0 ? null : alt),
              altitudeAccuracy: (altAcc < 0 ? null : altAcc),
              heading: (heading < 0 ? null : heading),
              speed: (speed < 0 ? null : speed)
            },
            timestamp: ts
          });
        }
      };

      window.__iosGeoReject = function (id, code, message) {
        var cb = geoCallbacks[id]; if (!cb) return; delete geoCallbacks[id];
        if (cb.error) {
          cb.error({ code: code, message: message,
                     PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        }
      };

      var nativeGeo = {
        getCurrentPosition: function (success, error) {
          var id = 'g' + (++geoSeq);
          geoCallbacks[id] = { success: success, error: error };
          try {
            window.webkit.messageHandlers.getLocation.postMessage(id);
          } catch (e) {
            if (error) error({ code: 2, message: 'Location unavailable' });
          }
        },
        watchPosition: function (success, error) {
          this.getCurrentPosition(success, error);   // one-shot fallback
          return 0;
        },
        clearWatch: function () {}
      };

      try {
        Object.defineProperty(navigator, 'geolocation', { value: nativeGeo, configurable: true });
      } catch (e) {
        navigator.geolocation = nativeGeo;
      }
    })();
    """
}

// MARK: - Local asset scheme handler

/// Serves the bundled `www/` folder over a custom scheme (rtuapp://app/...).
/// Using a real origin (instead of file://) lets the web app's localStorage and
/// IndexedDB persist across launches, matching the Android build.
final class LocalSchemeHandler: NSObject, WKURLSchemeHandler {

    /// Matches the Content-Security-Policy meta tag in index.html.
    static let contentSecurityPolicy =
        "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; " +
        "connect-src https://rtu-pictures-api.krutki11.workers.dev; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"

    private let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(NSError(domain: "rtuapp", code: 400)); return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path

        let rootResolved = root.resolvingSymlinksInPath().standardizedFileURL
        let candidate = rootResolved
            .appendingPathComponent(relative)
            .resolvingSymlinksInPath()
            .standardizedFileURL

        let rootPath = rootResolved.path
        let candidatePath = candidate.path
        let underRoot = candidatePath == rootPath
            || candidatePath.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/")
        guard underRoot else {
            task.didFailWithError(NSError(domain: "rtuapp", code: 403)); return
        }

        guard let data = try? Data(contentsOf: candidate) else {
            task.didFailWithError(NSError(domain: "rtuapp", code: 404)); return
        }

        let headers = [
            "Content-Type": Self.mimeType(for: candidate.pathExtension),
            "Cache-Control": "no-cache",
            "Content-Security-Policy": Self.contentSecurityPolicy
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200,
                                       httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js":          return "text/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif":         return "image/gif"
        case "svg":         return "image/svg+xml"
        case "webp":        return "image/webp"
        case "ico":         return "image/x-icon"
        case "woff":        return "font/woff"
        case "woff2":       return "font/woff2"
        case "ttf":         return "font/ttf"
        default:            return "application/octet-stream"
        }
    }
}
