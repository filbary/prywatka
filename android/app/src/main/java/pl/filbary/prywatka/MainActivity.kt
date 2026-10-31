package pl.filbary.prywatka

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Prywatka – test natywny: łączy się z aplikacją Spotify w tle (App Remote SDK),
 * gra utwór od zadanej sekundy i zatrzymuje po fragmencie. Spotify nie trzeba otwierać ręcznie.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val CLIENT_ID = "9f67b91656e04184a410b44f5b2d5d4a"
        const val REDIRECT_URI = "prywatka://callback"
        const val SNIPPET_MS = 30_000L
        val QR = Regex("^(?:PRYWATKA1|KARTKI1);([A-Za-z0-9]{22});(\\d{1,4})$")
    }

    private var remote: SpotifyAppRemote? = null
    private val handler = Handler(Looper.getMainLooper())
    private var stopTask: Runnable? = null

    private lateinit var input: EditText
    private lateinit var status: TextView
    private lateinit var logView: TextView

    private val scanner = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents ?: return@registerForActivityResult
        input.setText(text)
        playFromInput()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        log("Gotowe. Spotify zainstalowane: " + SpotifyAppRemote.isSpotifyInstalled(this))
    }

    override fun onDestroy() {
        super.onDestroy()
        remote?.let { SpotifyAppRemote.disconnect(it) }
    }

    // ---------------------------------------------------------------- Spotify

    private fun connect(then: (() -> Unit)? = null) {
        remote?.let { if (it.isConnected) { then?.invoke(); return } }
        if (!SpotifyAppRemote.isSpotifyInstalled(this)) {
            log("Brak aplikacji Spotify na telefonie – zainstaluj ją ze Sklepu Play.")
            return
        }
        setStatus("Łączenie ze Spotify…", "#ffc24b")
        val params = ConnectionParams.Builder(CLIENT_ID)
            .setRedirectUri(REDIRECT_URI)
            .showAuthView(true)
            .build()
        SpotifyAppRemote.connect(this, params, object : Connector.ConnectionListener {
            override fun onConnected(appRemote: SpotifyAppRemote) {
                remote = appRemote
                setStatus("Połączono ze Spotify ✓", "#33d69f")
                log("Połączono ze Spotify")
                then?.invoke()
            }

            override fun onFailure(error: Throwable) {
                setStatus("Brak połączenia ✗", "#ff6b6b")
                log("Błąd połączenia: ${error.javaClass.simpleName}: ${error.message}")
            }
        })
    }

    private fun playFromInput() {
        val m = QR.matchEntire(input.text.toString().trim())
        if (m == null) { log("Zły format. Przykład: PRYWATKA1;<ID>;149"); return }
        play(m.groupValues[1], m.groupValues[2].toLong())
    }

    private fun play(trackId: String, startSec: Long) = connect {
        val api = remote?.playerApi ?: return@connect
        stopTask?.let { handler.removeCallbacks(it) }
        log("Graj spotify:track:$trackId od ${startSec}s")
        api.play("spotify:track:$trackId")
            .setResultCallback {
                // chwila na załadowanie utworu, potem przewinięcie do startu fragmentu
                handler.postDelayed({
                    api.seekTo(startSec * 1000)
                        .setResultCallback { log("Przewinięto do ${startSec}s") }
                        .setErrorCallback { log("Błąd przewijania: ${it.message}") }
                    handler.postDelayed({
                        api.playerState.setResultCallback { st ->
                            log("Stan: pozycja ${st.playbackPosition / 1000}s, pauza=${st.isPaused}")
                        }
                    }, 1500)
                }, 450)
                val task = Runnable { api.pause(); log("Koniec fragmentu – pauza") }
                stopTask = task
                handler.postDelayed(task, SNIPPET_MS + 450)
            }
            .setErrorCallback { log("Błąd odtwarzania: ${it.javaClass.simpleName}: ${it.message}") }
    }

    private fun pause() {
        stopTask?.let { handler.removeCallbacks(it) }
        remote?.playerApi?.pause()?.setResultCallback { log("Pauza") }
    }

    // ---------------------------------------------------------------- UI

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

        root.addView(text("Prywatka – test Spotify", 24f, true))
        status = text("Niepołączono", 15f, color = "#a59cbb")
        root.addView(status)
        root.addView(button("1. Połącz ze Spotify") { connect() })
        root.addView(button("📷 Skanuj kartę") {
            scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Zeskanuj kod karty Prywatki").setBeepEnabled(false).setOrientationLocked(false))
        })
        input = EditText(this).apply {
            setText("PRYWATKA1;4u7EnebtmKWzUH433cf5Qv;149")
            setTextColor(Color.WHITE); textSize = 14f; isSingleLine = true
        }
        root.addView(text("…albo wpisz kod ręcznie:", 14f, color = "#a59cbb"))
        root.addView(input)
        root.addView(button("▶ Graj fragment (30 s)") { playFromInput() })
        root.addView(button("⏸ Pauza") { pause() })
        root.addView(text("Dziennik", 16f, true).apply { gravity = Gravity.START; setPadding(0, px(18), 0, 0) })
        logView = text("", 12f, color = "#cfc8e2").apply { typeface = Typeface.MONOSPACE }
        root.addView(logView)
        return ScrollView(this).apply { addView(root); setBackgroundColor(Color.parseColor("#15121c")) }
    }

    private fun setStatus(s: String, color: String) = runOnUiThread {
        status.text = s; status.setTextColor(Color.parseColor(color))
    }

    private fun log(s: String) = runOnUiThread {
        val t = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        logView.text = "$t  $s\n" + logView.text
    }
}
