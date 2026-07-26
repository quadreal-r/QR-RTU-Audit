# Keep WebView JavascriptInterface methods on the bridge class.
-keepclassmembers class com.quadreal.rtuqr.RtuJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
