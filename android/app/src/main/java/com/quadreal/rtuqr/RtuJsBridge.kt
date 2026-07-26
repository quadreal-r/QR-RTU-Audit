package com.quadreal.rtuqr

import android.webkit.JavascriptInterface
import java.lang.ref.WeakReference

/**
 * Minimal JS bridge — keeps [MainActivity] off [android.webkit.WebView.addJavascriptInterface].
 */
class RtuJsBridge(activity: MainActivity) {
    private val activityRef = WeakReference(activity)

    @JavascriptInterface
    fun setKeepScreenOn(enabled: Boolean) {
        activityRef.get()?.bridgeSetKeepScreenOn(enabled)
    }

    @JavascriptInterface
    fun deleteCachedPhoto(name: String?) {
        activityRef.get()?.bridgeDeleteCachedPhoto(name)
    }
}
