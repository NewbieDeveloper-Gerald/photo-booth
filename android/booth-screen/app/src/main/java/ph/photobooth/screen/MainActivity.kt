package ph.photobooth.screen

import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * The booth screen on a phone or tablet, over a USB cable.
 *
 * The desktop app maps port 47626 back to the computer with `adb reverse` and then opens this
 * activity with the screen URL, so the phone loads 127.0.0.1 — no internet, no router, nothing to
 * type. If no URL arrives the operator can paste one; it is remembered for next time.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var setupPanel: LinearLayout
    private lateinit var addressField: EditText
    private lateinit var prefs: SharedPreferences

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = getSharedPreferences("booth-screen", MODE_PRIVATE)

        webView = findViewById(R.id.screen)
        setupPanel = findViewById(R.id.setup)
        addressField = findViewById(R.id.address)

        // Keep the screen awake for the whole event; the guest must never see it sleep.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            // The page decides its own layout; a phone and a 10-inch tablet both get the same CSS.
            mediaPlaybackRequiresUserGesture = false
        }
        webView.setBackgroundColor(android.graphics.Color.BLACK)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                setupPanel.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                // Only the main frame matters: a failed image must not cover the screen with an error.
                if (request?.isForMainFrame != true) return
                showSetup(getString(R.string.unreachable))
            }
        }

        findViewById<Button>(R.id.open).setOnClickListener { open(addressField.text.toString()) }

        val url = intent?.dataString?.trim().orEmpty()
        if (url.isNotEmpty()) {
            open(url)
        } else {
            val remembered = prefs.getString(KEY_LAST_URL, "").orEmpty()
            if (remembered.isNotEmpty()) open(remembered) else showSetup(null)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        // A second `am start` (another Connect press) just loads the new link.
        intent.dataString?.takeIf { it.isNotBlank() }?.let { open(it) }
    }

    private fun open(rawUrl: String) {
        val target = normalise(rawUrl)
        if (target == null) {
            showSetup("Paste the address the booth shows, starting with http://127.0.0.1:47626/")
            return
        }
        prefs.edit().putString(KEY_LAST_URL, target).apply()
        addressField.setText(target)
        setupPanel.visibility = View.GONE
        webView.loadUrl(target)
    }

    /** Only the cable's own loopback is accepted, so a mistyped internet address cannot be opened. */
    private fun normalise(rawUrl: String): String? {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return null
        val uri = android.net.Uri.parse(trimmed)
        val host = uri.host ?: return null
        if (uri.scheme != "http") return null
        if (host != "127.0.0.1" && host != "localhost") return null
        return trimmed
    }

    private fun showSetup(message: String?) {
        setupPanel.visibility = View.VISIBLE
        if (!message.isNullOrBlank()) Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onPause() {
        // Do not leave the page running (and the socket open) when the operator leaves the app.
        webView.onPause()
        super.onPause()
    }

    companion object {
        private const val KEY_LAST_URL = "lastUrl"
    }
}
