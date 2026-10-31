package pl.filbary.prywatka

import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.sdk.android.auth.AuthorizationClient
import com.spotify.sdk.android.auth.AuthorizationRequest
import com.spotify.sdk.android.auth.AuthorizationResponse
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Prywatka – test natywny.
 * Tryb A (domyślny): odtwarzacz Spotify wbudowany w aplikację (Web Playback SDK w WebView) –
 *   dźwięk gra w Prywatce, Spotify nie pokazuje powiadomienia z tytułem.
 * Tryb B (porównawczy): sterowanie aplikacją Spotify w tle (App Remote SDK).
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val CLIENT_ID = "9f67b91656e04184a410b44f5b2d5d4a"
        const val REDIRECT_URI = "prywatka://callback"
        const val PLAYER_URL = "https://filbary.github.io/prywatka/sdk.html"
        const val SNIPPET_MS = 30_000L
        val QR = Regex("^(?:PRYWATKA1|KARTKI1);([A-Za-z0-9]{22});(\\d{1,4})$")
        val SCOPES = arrayOf(
            "streaming", "user-read-email", "user-read-private",
            "user-modify-playback-state", "user-read-playback-state", "app-remote-control"
        )
    }

    private val handler = Handler(Looper.getMainLooper())
    private var stopTask: Runnable? = null
    private var token: String? = null
    private var tokenExp = 0L
    private var afterAuth: (() -> Unit)? = null
    private var embeddedReady = false
    private var remote: SpotifyAppRemote? = null

    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var logView: TextView
    private lateinit var web: WebView

    private val authLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val resp = AuthorizationClient.getResponse(res.resultCode, res.data)
        when (resp.type) {
            AuthorizationResponse.Type.TOKEN -> {
                token = resp.accessToken
                tokenExp = System.currentTimeMillis() + (resp.expiresIn - 60) * 1000L
                log("Zgoda Spotify ✓ (token ważny ${resp.expiresIn / 60} min)")
                loadEmbeddedPlayer()
                val next = afterAuth; afterAuth = null; next?.invoke()
            }
            AuthorizationResponse.Type.ERROR -> { setStatus("Błąd autoryzacji ✗", "#ff6b6b"); log("Autoryzacja – błąd: ${resp.error}") }
            else -> { setStatus("Autoryzacja przerwana", "#ff6b6b"); log("Autoryzacja przerwana (${resp.type})") }
        }
    }

    private val scanner = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        input.setText(text)
        playEmbeddedFromInput()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        log("Odcisk SHA1 aplikacji: " + signingSha1())
        log("Spotify zainstalowane: " + SpotifyAppRemote.isSpotifyInstalled(this))
    }

    override fun onDestroy() {
        super.onDestroy()
        remote?.let { SpotifyAppRemote.disconnect(it) }
        web.destroy()
    }

    // ---------------------------------------------------------------- autoryzacja

    private fun withToken(then: () -> Unit) {
        if (token != null && System.currentTimeMillis() < tokenExp) { then(); return }
        setStatus("Proszę o zgodę Spotify…", "#ffc24b")
        afterAuth = then
        val req = AuthorizationRequest.Builder(CLIENT_ID, AuthorizationResponse.Type.TOKEN, REDIRECT_URI)
            .setScopes(SCOPES).build()
        authLauncher.launch(AuthorizationClient.createLoginActivityIntent(this, req))
    }

    // ---------------------------------------------------------------- tryb A: odtwarzacz wbudowany

    inner class Bridge {
        @JavascriptInterface fun getToken(): String = token ?: ""
        @JavascriptInterface fun log(msg: String) = this@MainActivity.log("[odtwarzacz] $msg")
        @JavascriptInterface fun state(s: String) {
            embeddedReady = s == "ready"
            when (s) {
                "ready" -> setStatus("Odtwarzacz w aplikacji gotowy ✓", "#33d69f")
                "error" -> setStatus("Odtwarzacz w aplikacji – błąd ✗", "#ff6b6b")
                else -> setStatus("Odtwarzacz niedostępny", "#ffc24b")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        // WebView przedstawia się jak zwykły Chrome (bez znacznika „wv”)
        web.settings.userAgentString = web.settings.userAgentString
            .replace("; wv", "").replace(Regex("Version/\\S+ "), "")
        web.addJavascriptInterface(Bridge(), "Android")
        web.webChromeClient = object : WebChromeClient() {
            // Spotify wymaga zabezpieczonego odtwarzania (DRM Widevine)
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }
    }

    private fun loadEmbeddedPlayer() {
        if (web.url != null) return
        setStatus("Uruchamiam odtwarzacz w aplikacji…", "#ffc24b")
        web.loadUrl(PLAYER_URL)
    }

    private fun playEmbeddedFromInput() {
        val (id, start) = parse() ?: return
        withToken {
            if (!embeddedReady) {
                log("Odtwarzacz jeszcze się uruchamia – spróbuję za 2 s")
                handler.postDelayed({ playEmbedded(id, start) }, 2000)
            } else playEmbedded(id, start)
        }
    }

    private fun playEmbedded(id: String, start: Long) {
        if (!embeddedReady) { log("Odtwarzacz w aplikacji niegotowy – zobacz komunikaty [odtwarzacz]"); return }
        log("A: graj w aplikacji od ${start}s")
        web.evaluateJavascript("playTrack('$id', $start)", null)
        scheduleStop { web.evaluateJavascript("pauseTrack()", null); log("Koniec fragmentu – pauza") }
    }

    // ---------------------------------------------------------------- tryb B: aplikacja Spotify w tle

    private fun playRemoteFromInput() {
        val (id, start) = parse() ?: return
        withToken { connectRemote { playRemote(id, start) } }
    }

    private fun connectRemote(then: () -> Unit) {
        remote?.let { if (it.isConnected) { then(); return } }
        val params = ConnectionParams.Builder(CLIENT_ID).setRedirectUri(REDIRECT_URI).showAuthView(true).build()
        SpotifyAppRemote.connect(this, params, object : Connector.ConnectionListener {
            override fun onConnected(appRemote: SpotifyAppRemote) { remote = appRemote; log("B: połączono z aplikacją Spotify"); then() }
            override fun onFailure(error: Throwable) { log("B: błąd połączenia: ${error.javaClass.simpleName}: ${error.message}") }
        })
    }

    private fun playRemote(id: String, start: Long) {
        val api = remote?.playerApi ?: return
        log("B: graj przez Spotify od ${start}s")
        api.play("spotify:track:$id").setResultCallback {
            handler.postDelayed({ api.seekTo(start * 1000) }, 450)
        }.setErrorCallback { log("B: błąd: ${it.message}") }
        scheduleStop { api.pause(); log("Koniec fragmentu – pauza") }
    }

    // ---------------------------------------------------------------- wspólne

    private fun parse(): Pair<String, Long>? {
        val m = QR.matchEntire(input.text.toString().trim())
        if (m == null) { log("Zły format. Przykład: PRYWATKA1;<ID>;149"); return null }
        return m.groupValues[1] to m.groupValues[2].toLong()
    }

    private fun scheduleStop(action: () -> Unit) {
        stopTask?.let { handler.removeCallbacks(it) }
        val t = Runnable(action); stopTask = t
        handler.postDelayed(t, SNIPPET_MS + 500)
    }

    private fun pauseAll() {
        stopTask?.let { handler.removeCallbacks(it) }
        web.evaluateJavascript("pauseTrack && pauseTrack()", null)
        remote?.playerApi?.pause()
    }

    private fun buildUi(): ScrollView {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(28), px(20), px(20))
            setBackgroundColor(Color.parseColor("#15121c"))
        }
        fun text(s: String, size: Float, bold: Boolean = false, color: String = "#f2edf8") =
            TextView(this).apply {
                text = s; textSize = size; setTextColor(Color.parseColor(color))
                if (bold) typeface = Typeface.DEFAULT_BOLD
                setPadding(0, px(6), 0, px(6))
            }
        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 17f
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = px(8) }
        }

        root.addView(text("Prywatka – test odtwarzania", 24f, true))
        status = text("Niepołączono", 15f, color = "#a59cbb")
        root.addView(status)
        root.addView(button("1. Połącz ze Spotify") { withToken { } })
        root.addView(button("📷 Skanuj kartę (gra w aplikacji)") {
            scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Zeskanuj kod karty Prywatki").setBeepEnabled(false)
                .setOrientationLocked(true).setCaptureActivity(PortraitCaptureActivity::class.java))
        })
        root.addView(text("Kod karty:", 14f, color = "#a59cbb"))
        input = EditText(this).apply {
            setText("PRYWATKA1;4u7EnebtmKWzUH433cf5Qv;149")
            setTextColor(Color.WHITE); textSize = 14f; isSingleLine = true
        }
        root.addView(input)
        root.addView(button("▶ A: Graj w aplikacji (bez paska)") { playEmbeddedFromInput() })
        root.addView(button("▶ B: Graj przez aplikację Spotify") { playRemoteFromInput() })
        root.addView(button("⏸ Pauza") { pauseAll() })

        web = WebView(this).apply {
            layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, px(44)).apply { topMargin = px(10) }
            setBackgroundColor(Color.parseColor("#15121c"))
        }
        setupWebView()
        root.addView(web)

        root.addView(text("Dziennik", 16f, true).apply { gravity = Gravity.START; setPadding(0, px(14), 0, 0) })
        logView = text("", 12f, color = "#cfc8e2").apply { typeface = Typeface.MONOSPACE }
        root.addView(logView)
        return ScrollView(this).apply { addView(root); setBackgroundColor(Color.parseColor("#15121c")) }
    }

    private fun signingSha1(): String = try {
        val info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val cert = info.signingInfo!!.apkContentsSigners[0].toByteArray()
        MessageDigest.getInstance("SHA-1").digest(cert).joinToString(":") { "%02X".format(it) }
    } catch (e: Exception) { "? (${e.message})" }

    private fun setStatus(s: String, color: String) = runOnUiThread {
        status.text = s; status.setTextColor(Color.parseColor(color))
    }

    private fun log(s: String) = runOnUiThread {
        val t = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        logView.text = "$t  $s\n" + logView.text
    }
}
