/* Prywatka – wersja webowa z YouTube (odtwarzacz ukryty pod planszą) */
'use strict';
const QR_RE = /^PRYWATKA2;([A-Za-z0-9_-]{11});(\d{1,4})$/;
const $ = s => document.querySelector(s);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('pry.' + k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem('pry.' + k, JSON.stringify(v)); } catch (e) {} },
};
const S = { player: null, ready: false, len: store.get('len2') || 15, cur: null, want: null,
  stream: null, scanning: false, total: 15 };

/* ------------------------------------------------------------ UI pomocnicze */
function show(id) { document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== id); }
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms); }
function log(msg, ok = true) {
  const li = document.createElement('li'); li.className = ok ? '' : 'err';
  li.textContent = new Date().toLocaleTimeString('pl-PL') + '  ' + msg;
  const ol = $('#log'); ol.prepend(li); while (ol.children.length > 40) ol.lastChild.remove();
}
function pstate(txt, cls = '') { const p = $('#pstate'); p.textContent = txt; p.className = 'pill ' + cls; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------ powiadomienie systemowe bez tytułu */
function neutralMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Prywatka', artist: 'Zgadnij, z którego roku!',
      artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
  } catch (e) {}
}

/* ------------------------------------------------------------ odtwarzacz YouTube */
window.onYouTubeIframeAPIReady = () => {
  S.player = new YT.Player('yt', {
    width: '320', height: '180',
    playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0, modestbranding: 1 },
    events: {
      onReady: () => { S.ready = true; pstate('gotowe', 'ok'); log('Odtwarzacz YouTube gotowy'); },
      onError: e => { const m = { 2: 'złe ID', 5: 'błąd odtwarzacza', 100: 'nagranie usunięte', 101: 'zakaz osadzania', 150: 'zakaz osadzania' }[e.data] || e.data;
        log('Błąd YouTube: ' + m, false); $('#playMsg').textContent = 'Nie można odtworzyć: ' + m; S.want = null; },
    }
  });
};

function play(id, start) {
  S.cur = { id, start };
  $('#reveal').hidden = true; show('vPlay');
  if (!S.ready) { $('#playMsg').textContent = 'Odtwarzacz jeszcze się ładuje – spróbuj za chwilę.'; return; }
  S.want = { id, start, len: S.len, started: false, t0: Date.now(), ad: false };
  $('#count').textContent = '…'; setArc(1); $('#playMsg').textContent = 'Ładuję…';
  $('#pauseBtn').textContent = '⏸ Pauza';
  const p = S.player;
  p.mute();                                          // do czasu startu właściwego nagrania – reklama gra bez dźwięku
  const cur = p.getVideoData && p.getVideoData().video_id;
  if (cur === id) { p.seekTo(start, true); p.playVideo(); }
  else p.loadVideoById({ videoId: id, startSeconds: start });
  neutralMediaSession();
  log(`Graj ${id} od ${start}s`);
}
function pause() {
  const w = S.want; if (!w) return;
  if (w.started && !w.paused && !w.ended) { w.left = Math.max(0, w.endAt - Date.now()); w.paused = true; }
  S.player.pauseVideo(); $('#playMsg').textContent = 'Pauza.'; $('#pauseBtn').textContent = '▶ Wznów';
}
function resume() {
  const w = S.want; if (!w || !w.paused) return;
  w.paused = false; w.endAt = Date.now() + w.left; S.total = w.left / 1000;
  S.player.playVideo(); $('#playMsg').textContent = 'Słuchaj uważnie…'; $('#pauseBtn').textContent = '⏸ Pauza';
}
function more() {
  const w = S.want; if (!w || !w.started) return;
  const left = w.paused ? w.left : Math.max(0, w.endAt - Date.now());
  w.paused = false; w.ended = false; w.endAt = Date.now() + left + 15000; S.total = (left + 15000) / 1000;
  S.player.playVideo(); $('#playMsg').textContent = 'Słuchaj uważnie…'; $('#pauseBtn').textContent = '⏸ Pauza';
}
function reveal() {
  const d = S.player && S.player.getVideoData ? S.player.getVideoData() : {};
  $('#reveal').innerHTML = `<b>${esc(d.title || '(brak tytułu)')}</b>${d.author ? '<br><small>' + esc(d.author) + '</small>' : ''}`;
  $('#reveal').hidden = false;
}
function setArc(frac) { const C = 2 * Math.PI * 54; $('#arc').style.strokeDasharray = C; $('#arc').style.strokeDashoffset = C * (1 - frac); }

// pętla: wykrywa reklamę, włącza dźwięk przy starcie nagrania, zatrzymuje po fragmencie
setInterval(() => {
  const w = S.want, p = S.player;
  if (!w || !p || !p.getPlayerState) return;
  const st = p.getPlayerState(), t = p.getCurrentTime(), vid = (p.getVideoData() || {}).video_id;
  if (!w.started) {
    if (st === YT.PlayerState.PLAYING && vid === w.id && t >= w.start - 1.5 && t < w.start + 20) {
      w.started = true; w.endAt = Date.now() + w.len * 1000; S.total = w.len;
      p.unMute(); p.setVolume(100); neutralMediaSession();
      $('#playMsg').textContent = 'Słuchaj uważnie…';
      log(w.ad ? `Start po reklamie (${Math.round((Date.now() - w.t0) / 1000)} s)` : 'Start bez reklamy');
    } else {
      const moving = w.lastT !== undefined && Math.abs(t - w.lastT) > 0.1;
      if (!w.ad && ((moving && t < w.start - 1.5) || (st === YT.PlayerState.PLAYING && vid !== w.id))) {
        w.ad = true; $('#playMsg').textContent = 'Reklama gra bez dźwięku – chwilka…'; log('Reklama (wyciszona)', false);
      }
      w.lastT = t;
      if (Date.now() - w.t0 > 150000) { $('#playMsg').textContent = 'Nie udało się uruchomić nagrania.'; S.want = null; }
    }
    return;
  }
  if (w.paused || w.ended) return;
  const left = Math.max(0, (w.endAt - Date.now()) / 1000);
  $('#count').textContent = Math.ceil(left); setArc(left / S.total);
  if (left < 1.2) p.setVolume(Math.round(left / 1.2 * 100));           // łagodne wyciszenie
  if (left <= 0) { w.ended = true; p.pauseVideo(); p.setVolume(100); $('#playMsg').textContent = 'Koniec fragmentu.'; }
}, 150);

/* ------------------------------------------------------------ skaner QR */
let detector = null;
async function startScan() {
  show('vScan'); $('#scanMsg').textContent = 'Skieruj aparat na kod QR karty.';
  // „odblokowanie” dźwięku w ramach dotknięcia przycisku (zasady autoodtwarzania przeglądarek)
  try { if (S.ready) { S.player.mute(); } } catch (e) {}
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { $('#scanMsg').textContent = 'Brak dostępu do aparatu: ' + e.message; return; }
  const v = $('#video'); v.srcObject = S.stream; await v.play();
  if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
  S.scanning = true; scanLoop();
}
function stopScan() { S.scanning = false; if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } }
const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
async function scanLoop() {
  if (!S.scanning) return;
  const v = $('#video'); let text = null;
  if (v.readyState >= 2) {
    try {
      if (detector) { const r = await detector.detect(v); if (r[0]) text = r[0].rawValue; }
      else {
        const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
        canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
        const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        if (r) text = r.data;
      }
    } catch (e) {}
  }
  if (text) {
    const m = text.trim().match(QR_RE);
    if (m) { navigator.vibrate?.(80); stopScan(); play(m[1], +m[2]); return; }
    $('#scanMsg').textContent = 'To nie jest karta Prywatki.';
  }
  setTimeout(scanLoop, detector ? 120 : 180);
}

/* ------------------------------------------------------------ narzędzia testowe */
function ytId(v) { const m = String(v).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(v.trim()) ? v.trim() : null); }
function showQR(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  $('#qrImg').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  $('#qrTxt').textContent = text; $('#qrBox').hidden = false;
}

/* ------------------------------------------------------------ start */
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

function bind() {
  $('#scanBtn').onclick = startScan;
  $('#nextBtn').onclick = () => { if (S.want && !S.want.ended) S.player.pauseVideo(); S.want = null; startScan(); };
  $('#scanCancel').onclick = () => { stopScan(); show('vHome'); };
  $('#againBtn').onclick = () => S.cur && play(S.cur.id, S.cur.start);
  $('#moreBtn').onclick = more;
  $('#pauseBtn').onclick = () => (S.want && S.want.paused) ? resume() : pause();
  $('#revealBtn').onclick = reveal;
  $('#manualForm').onsubmit = e => { e.preventDefault(); const m = $('#manual').value.trim().match(QR_RE); if (m) play(m[1], +m[2]); else toast('Zły format. Przykład: PRYWATKA2;BSTsnWoslP4;149'); };
  $('#linkForm').onsubmit = e => { e.preventDefault(); const id = ytId($('#link').value); if (!id) return toast('Nie rozpoznaję linku YouTube'); showQR(`PRYWATKA2;${id};${+$('#linkSec').value || 0}`); };
  $('#lenSel').value = String(S.len);
  $('#lenSel').onchange = e => { S.len = +e.target.value; store.set('len2', S.len); };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
bind(); show('vHome'); keepAwake(); pstate('ładowanie odtwarzacza…');
$('#manual').value = 'PRYWATKA2;BSTsnWoslP4;149';
