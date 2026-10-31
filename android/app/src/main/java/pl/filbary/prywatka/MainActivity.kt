package pl.filbary.prywatka

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.CountDownTimer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Prywatka – test odtwarzania z YouTube wewnątrz aplikacji.
 * Odtwarzacz YouTube działa w ukrytym okienku (WebView zasłonięty planszą), więc nikt nie widzi tytułu,
 * a Android nie pokazuje powiadomienia z utworem. Reklamy grają wyciszone; dźwięk włącza się,
 * gdy ruszy właściwe nagranie od zadanej sekundy.
 *
 * Kod karty: PRYWATKA2;<ID nagrania YouTube, 11 znaków>;<start w sekundach>
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val PLAYER_URL = "https://filbary.github.io/prywatka/yt.html"
        const val SNIPPET_S = 30
        val QR = Regex("^PRYWATKA2;([A-Za-z0-9_-]{11});(\\d{1,4})$")
    }

    private var ready = false
    private var current: Pair<String, Int>? = null
    private var timer: CountDownTimer? = null
    private var paused = false

    private lateinit var web: WebView
    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var big: TextView
    private lateinit var reveal: TextView
    private lateinit var pauseBtn: Button
    private lateinit var logView: TextView

    private val scanner = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        input.setText(text)
        playFromInput()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(buildUi())
        setupWebView()
        web.loadUrl(PLAYER_URL)
        setStatus("Uruchamiam odtwarzacz…", "#ffc24b")
    }

    override fun onDestroy() { super.onDestroy(); web.destroy() }

    // ---------------------------------------------------------------- odtwarzacz (WebView)

    inner class Bridge {
        @JavascriptInterface fun log(msg: String) = this@MainActivity.log(msg)
        @JavascriptInterface fun onTitle(t: String) = runOnUiThread { reveal.text = if (t.isBlank()) "(brak tytułu)" else t; reveal.visibility = View.VISIBLE }
        @JavascriptInterface fun onState(s: String) = runOnUiThread { handleState(s) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.addJavascriptInterface(Bridge(), "Android")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = WebViewClient()
    }

    private fun handleState(s: String) {
        when {
            s == "ready" -> { ready = true; setStatus("Gotowe – zeskanuj kartę", "#33d69f") }
            s == "loading" -> { setStatus("Ładuję…", "#ffc24b"); big.text = "…" }
            s == "ad" -> { setStatus("Reklama gra bez dźwięku – chwilka…", "#ffc24b"); log("Reklama (wyciszona)") }
            s.startsWith("playing:") -> {
                paused = false; pauseBtn.text = "⏸ Pauza"
                setStatus("Słuchaj uważnie…", "#33d69f")
                startCountdown(s.substringAfter(':').toIntOrNull() ?: SNIPPET_S)
            }
            s == "paused" -> { timer?.cancel(); setStatus("Pauza", "#a59cbb") }
            s == "ended" -> { timer?.cancel(); big.text = "0"; setStatus("Koniec fragmentu", "#a59cbb") }
            s == "stopped" -> { timer?.cancel(); big.text = "" }
            s.startsWith("error") -> { timer?.cancel(); setStatus("Błąd: ${s.substringAfter(':')}", "#ff6b6b"); log("Błąd odtwarzacza: $s") }
        }
    }

    private fun js(code: String) = web.evaluateJavascript(code, null)

    private fun startCountdown(sec: Int) {
        timer?.cancel()
        timer = object : CountDownTimer(sec * 1000L, 250) {
            override fun onTick(ms: Long) { big.text = ((ms + 999) / 1000).toString() }
            override fun onFinish() { big.text = "0" }
        }.start()
    }

    // ---------------------------------------------------------------- akcje

    private fun playFromInput() {
        val m = QR.matchEntire(input.text.toString().trim())
        if (m == null) { log("To nie jest karta Prywatki (oczekuję PRYWATKA2;ID;sekunda)"); setStatus("Nieznany kod", "#ff6b6b"); return }
        play(m.groupValues[1], m.groupValues[2].toInt())
    }

    private fun play(id: String, start: Int) {
        if (!ready) { log("Odtwarzacz jeszcze się ładuje"); return }
        current = id to start
        reveal.visibility = View.GONE
        log("Graj $id od ${start}s")
        js("playClip('$id', $start, $SNIPPET_S)")
    }

    private fun togglePause() {
        if (current == null) return
        if (!paused) { js("pauseClip()"); paused = true; pauseBtn.text = "▶ Wznów" }
        else { js("resumeClip()") }
    }

    // ---------------------------------------------------------------- UI

    private fun buildUi(): View {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val bg = Color.parseColor("#15121c")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(28), px(20), px(20)); setBackgroundColor(bg)
        }
        fun text(s: String, size: Float, bold: Boolean = false, color: String = "#f2edf8") = TextView(this).apply {
            text = s; textSize = size; setTextColor(Color.parseColor(color))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, px(6), 0, px(6))
        }
        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false; textSize = 17f; setOnClickListener { onClick() }
        }
        fun full(v: View, top: Int = 8) = v.apply { layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = px(top) } }

        root.addView(text("Prywatka", 26f, true))
        status = text("…", 15f, color = "#a59cbb"); root.addView(status)
        big = text("", 64f, true).apply { gravity = Gravity.CENTER }
        root.addView(full(big))
        root.addView(full(button("📷 Skanuj kartę") {
            scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Zeskanuj kod karty Prywatki").setBeepEnabled(false)
                .setOrientationLocked(true).setCaptureActivity(PortraitCaptureActivity::class.java))
        }))

        val grid = GridLayout(this).apply { columnCount = 2 }
        fun cell(b: Button) = b.apply {
            layoutParams = GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED, 1f), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply { width = 0 }
        }
        grid.addView(cell(button("↺ Powtórz") { current?.let { play(it.first, it.second) } }))
        grid.addView(cell(button("+15 s") { js("extendClip(15)") }))
        pauseBtn = cell(button("⏸ Pauza") { togglePause() })
        grid.addView(pauseBtn)
        grid.addView(cell(button("👁 Odkryj") { js("revealTitle()") }))
        root.addView(full(grid))
        reveal = text("", 16f, true).apply { gravity = Gravity.CENTER; visibility = View.GONE }
        root.addView(full(reveal))

        root.addView(text("Kod karty (test):", 14f, color = "#a59cbb").apply { setPadding(0, px(18), 0, 0) })
        input = EditText(this).apply { setText("PRYWATKA2;BSTsnWoslP4;149"); setTextColor(Color.WHITE); textSize = 14f; isSingleLine = true }
        root.addView(input)
        root.addView(full(button("▶ Graj kod") { playFromInput() }))

        // ukryty odtwarzacz: WebView pod nieprzezroczystą planszą
        val holder = FrameLayout(this).apply { layoutParams = LinearLayout.LayoutParams(px(160), px(90)).apply { topMargin = px(14) } }
        web = WebView(this).apply { layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT) }
        holder.addView(web)
        holder.addView(TextView(this).apply {
            layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            setBackgroundColor(Color.parseColor("#211c2b")); text = "🎵"; textSize = 28f; gravity = Gravity.CENTER
            isClickable = true
        })
        root.addView(holder)

        root.addView(text("Dziennik", 16f, true).apply { setPadding(0, px(14), 0, 0) })
        logView = text("", 12f, color = "#cfc8e2").apply { typeface = Typeface.MONOSPACE }
        root.addView(logView)
        return ScrollView(this).apply { addView(root); setBackgroundColor(bg) }
    }

    private fun setStatus(s: String, color: String) = runOnUiThread { status.text = s; status.setTextColor(Color.parseColor(color)) }

    private fun log(s: String) = runOnUiThread {
        val t = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        logView.text = "$t  $s\n" + logView.text
    }
}
