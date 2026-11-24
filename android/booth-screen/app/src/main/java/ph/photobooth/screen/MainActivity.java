package ph.photobooth.screen;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * The booth screen on a phone or tablet, over a USB cable, in landscape.
 *
 * <p>The desktop app maps port 47626 back to the computer with {@code adb reverse} and then opens
 * this activity with the screen URL, so the phone loads 127.0.0.1 — no internet, no router, nothing
 * to type. Launched on its own it explains what to press in the booth instead of showing a blank
 * page or an Android error.
 *
 * <p>Deliberately dependency-free: no AndroidX, no layout XML, no permissions beyond INTERNET. The
 * page it loads is the booth's own responsive guest screen, so the app adds nothing to the design.
 */
public class MainActivity extends Activity {

    /** Where the booth puts its guest screen over the cable. Anything else is refused. */
    private static final String BOOTH_PREFIX = "http://127.0.0.1:47626";

    /** Shown when the app is opened without the booth having pressed Connect. */
    private static final String NO_BOOTH_PAGE =
        "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<style>html,body{height:100%}body{margin:0;display:flex;align-items:center;justify-content:center;"
        + "background:#0b0f17;color:#f8fafc;font:16px system-ui,sans-serif;text-align:center}"
        + "main{max-width:38ch;padding:24px}h1{font-size:22px;margin:0 0 12px}"
        + "p{margin:0 0 10px;line-height:1.5;color:#cbd5e1}code{color:#fbbf24}</style>"
        + "<main><h1>Booth Screen</h1>"
        + "<p>This phone is ready. On the computer, open the photo booth and press "
        + "<b>Connect over USB</b> in the <b>USB cable screen</b> card.</p>"
        + "<p>The screen opens by itself once the cable link is up.</p>"
        + "<p>Keeping the app open on this screen is fine, and the USB cable must stay plugged in.</p>"
        + "</main>";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebView screen = new WebView(this);
        screen.setBackgroundColor(Color.BLACK);
        WebSettings settings = screen.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        setContentView(screen);
        hideSystemBars();

        String url = getIntent() == null ? null : getIntent().getDataString();
        if (url == null || !url.startsWith(BOOTH_PREFIX)) {
            screen.loadDataWithBaseURL(null, NO_BOOTH_PAGE, "text/html", "utf-8", null);
        } else {
            screen.loadUrl(url);
        }
    }

    /** A second Connect press in the booth sends a new URL: rebuild with it. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        recreate();
    }

    /** Immersive and sticky: a guest must never see the status bar or the navigation bar. */
    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
