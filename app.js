/* Prywatka – aplikacja (YouTube w ukrytym odtwarzaczu, kula disco, skaner QR) */
'use strict';
// kod karty: PRYWATKA2;<ID YouTube>;<start w s>[;<rok>]  – rok zapisany jako (rok-1900) w systemie 36 (np. 1975 → „23”),
// żeby zwykły aparat w telefonie nie zdradzał go wprost
const QR_RE = /^PRYWATKA2;([A-Za-z0-9_-]{11});(\d{1,4})(?:;([0-9A-Za-z]{1,3}))?$/;
const decYear = s => { const y = s ? parseInt(s, 36) + 1900 : NaN; return y > 1900 && y < 2100 ? y : null; };
const encYear = y => (y - 1900).toString(36).toUpperCase();
const $ = s => document.querySelector(s);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('pry.' + k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem('pry.' + k, JSON.stringify(v)); } catch (e) {} },
};
const S = { player: null, ready: false, len: store.get('len2') || 15, theme: store.get('theme') === 'spk' ? 'spk' : 'disco', cur: null, want: null,
  stream: null, scanning: false, total: 15, cards: 0, view: 'vHome' };
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

/* ------------------------------------------------------------ pomocnicze */
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms); }
function log(msg, ok = true) {
  const li = document.createElement('li'); li.className = ok ? '' : 'err';
  li.textContent = new Date().toLocaleTimeString('pl-PL') + '  ' + msg;
  const ol = $('#log'); ol.prepend(li); while (ol.children.length > 40) ol.lastChild.remove();
}

/* ------------------------------------------------------------ kula disco */
const ballEl = $('#ball'), ball = new DiscoBall($('#ballCanvas')), spkEl = $('#spk');
const orb = () => S.theme === 'spk' ? spkEl : ballEl;      // element na środku sceny w bieżącym motywie
const SPEED = { home: 7, play: 26, reveal: 4 };
let lastRect = '';
function trackBall() {
  const slot = document.querySelector(`#${S.view} .slot`);
  if (slot) { const r = slot.getBoundingClientRect(); const k = [r.left, r.top, r.width].map(Math.round).join(','); if (k !== lastRect) placeBall(); }
  requestAnimationFrame(trackBall);
}
function placeBall() {
  const slot = document.querySelector(`#${S.view} .slot`), el = orb();
  (el === ballEl ? spkEl : ballEl).hidden = true;
  if (!slot) { el.hidden = true; return; }
  const r = slot.getBoundingClientRect();
  el.hidden = false;
  lastRect = [r.left, r.top, r.width].map(Math.round).join(',');
  const sizeChanged = el.style.width !== r.width + 'px';
  Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  if (sizeChanged && el === ballEl) ball.resize();
}
function show(id) {
  S.view = id;
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== id);
  const mode = { vHome: 'home', vPlay: 'play', vReveal: 'reveal' }[id];
  ballEl.classList.toggle('hot', id === 'vPlay'); ballEl.classList.toggle('gold', id === 'vReveal');
  spkEl.classList.toggle('count', id === 'vPlay'); spkEl.classList.toggle('spin', id !== 'vPlay');
  if (mode) ball.setSpeed(SPEED[mode]);
  document.documentElement.style.setProperty('--beams', id === 'vPlay' ? '16s' : '40s');
  placeBall(); requestAnimationFrame(placeBall); setTimeout(placeBall, 300);
}
window.addEventListener('resize', () => requestAnimationFrame(placeBall));

/* ------------------------------------------------------------ motywy */
function buildDecor() {
  const C = ['#ff3b5c', '#ff8a2e', '#ffd23f', '#2fe08a', '#2ad4ff', '#3d7bff', '#b46bff'];
  const seg = i => i < 12 ? '#2fe08a' : i < 16 ? '#ffd23f' : i < 18 ? '#ff8a2e' : '#ff3b5c';     // pasek głośności
  const bars = Array.from({ length: 20 }, (_, i) => `<i style="--c:${seg(i)}"></i>`).join('');
  document.querySelector('.vud').innerHTML = bars; document.querySelector('.vul div').innerHTML = bars;
  document.querySelector('.spec').innerHTML = Array.from({ length: 16 }, (_, i) =>
    `<i style="--c:${C[Math.floor(i / 16 * 7)]};animation-duration:${(0.7 + 0.07 * (i % 5)).toFixed(2)}s;animation-delay:${(-0.13 * i).toFixed(2)}s"></i>`).join('');
}
function applyTheme(t) {
  S.theme = t; store.set('theme', t);
  document.body.classList.toggle('theme-spk', t === 'spk');
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
  document.querySelector('meta[name=theme-color]').content = t === 'spk' ? '#0d0b18' : '#150e33';
  if (t === 'spk') ball.stop(); else ball.start();
  if (S.want && S.want.started) $('#count').textContent = fmtCount(Math.ceil(Math.max(0, (S.want.endAt - Date.now()) / 1000)));
  lastRect = ''; placeBall();
}
// pasek głośności: płynny – szybki skok w górę, powolne opadanie (jak prawdziwy wskaźnik)
const vuEl = document.querySelector('.vul');
let vuLvl = 0, vuTgt = 0, vuNext = 0, vuLast = 0, vuSeg = -1;
function vuLoop(t) {
  requestAnimationFrame(vuLoop);
  const dt = Math.min(0.05, (t - vuLast) / 1000 || 0); vuLast = t;
  if (S.theme !== 'spk' || S.view !== 'vPlay') return;
  if (document.body.classList.contains('live')) {
    if (t > vuNext) {                       // kolejne „uderzenie”: co ~0,5 s mocniejsze (stopa), pomiędzy słabsze
      const beat = Math.round(t / 500) !== Math.round(vuNext / 500);
      vuTgt = beat ? 0.82 + Math.random() * 0.18 : 0.5 + Math.random() * 0.3;
      vuNext = t + 110 + Math.random() * 150;
    }
    vuTgt -= dt * 0.9;                      // cel powoli opada między uderzeniami
  } else vuTgt = 0;
  vuTgt = Math.max(0, vuTgt);
  const tau = vuTgt > vuLvl ? 0.035 : 0.28;  // atak / opadanie
  vuLvl += (vuTgt - vuLvl) * (1 - Math.exp(-dt / tau));
  const seg = Math.round(vuLvl * 20);
  if (seg !== vuSeg) { vuSeg = seg; vuEl.style.clipPath = `inset(0 ${(100 - seg * 5).toFixed(1)}% 0 0)`; }
}
requestAnimationFrame(vuLoop);
const fmtCount = n => S.theme === 'spk' ? '00:' + String(n).padStart(2, '0') : String(n);

/* ------------------------------------------------------------ powiadomienie systemowe bez tytułu */
function neutralMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Prywatka', artist: 'Parkiet czeka!',
      artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => resume());
    navigator.mediaSession.setActionHandler('pause', () => pause());
  } catch (e) {}
}

/* ------------------------------------------------------------ odtwarzacz YouTube */
window.onYouTubeIframeAPIReady = () => {
  S.player = new YT.Player('yt', {
    width: '220', height: '124',
    playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0, modestbranding: 1 },
    events: {
      onReady: () => { S.ready = true; log('Odtwarzacz YouTube gotowy'); },
      onError: e => { const m = { 2: 'złe ID', 5: 'błąd odtwarzacza', 100: 'nagranie usunięte', 101: 'zakaz osadzania', 150: 'zakaz osadzania' }[e.data] || e.data;
        log('Błąd YouTube: ' + m, false); setWait('Nie można odtworzyć: ' + m); S.want = null; setToggle('ended'); },
    }
  });
};

function setWait(t) { $('#wait').textContent = t || ''; }
function setToggle(state) {           // playing | paused | ended
  $('#toggleIco').innerHTML = state === 'playing' ? ICON_PAUSE : ICON_PLAY;
  $('#toggleTxt').textContent = state === 'playing' ? 'Stop' : 'Start';
  $('#toggleBtn').setAttribute('aria-label', state === 'playing' ? 'Zatrzymaj' : 'Odtwórz');
  ball.setSpeed(state === 'playing' ? SPEED.play : (S.view === 'vReveal' ? SPEED.reveal : 5));
}
function setArc(frac) {
  frac = Math.max(0, Math.min(1, frac));
  $('#arc').style.strokeDashoffset = 917.3 * (1 - frac);
  spkEl.style.setProperty('--lit', (360 * frac).toFixed(1) + 'deg');
}

function play(id, start, newCard = false, year = null) {
  if (newCard) { S.year = year; S.cards++; $('#cardNo').textContent = $('#cardNo2').textContent = $('#cardNo3').textContent = 'Karta ' + S.cards; }
  S.cur = { id, start };
  show('vPlay');
  if (!S.ready) { setWait('Odtwarzacz jeszcze się ładuje – spróbuj za chwilę'); return; }
  S.want = { id, start, len: S.len, started: false, t0: Date.now(), ad: false };
  $('#count').textContent = fmtCount(S.len); setArc(1); setWait('Ładuję…'); setToggle('playing');
  const p = S.player;
  p.mute(); p.setVolume(100);           // do startu właściwego nagrania – reklama gra bez dźwięku
  const cur = p.getVideoData && p.getVideoData().video_id;
  if (cur === id) { p.seekTo(start, true); p.playVideo(); }
  else p.loadVideoById({ videoId: id, startSeconds: start });
  neutralMediaSession();
  log(`Graj ${id} od ${start}s`);
}
function pause() {
  const w = S.want; if (!w) return;
  if (w.started && !w.paused && !w.ended) { w.left = Math.max(0, w.endAt - Date.now()); w.paused = true; }
  S.player.pauseVideo(); setToggle('paused');
}
function resume() {
  const w = S.want; if (!w) return;
  if (w.ended || !w.started) { if (S.cur) play(S.cur.id, S.cur.start); return; }
  if (!w.paused) return;
  w.paused = false; w.endAt = Date.now() + w.left;
  S.player.playVideo(); setToggle('playing');
}
function toggle() {
  const w = S.want;
  if (!w || w.ended) { if (S.cur) play(S.cur.id, S.cur.start); return; }
  if (!w.started) return;              // trwa ładowanie / reklama
  w.paused ? resume() : pause();
}
function stopAll() { if (S.player && S.ready) S.player.pauseVideo(); S.want = null; }
function cleanTitle(t) {
  return String(t || '').replace(/\s*[\(\[][^)\]]*(official|video|audio|lyric|remaster|teledysk|hd|4k)[^)\]]*[\)\]]/gi, '').trim();
}
function reveal() {
  const d = S.player && S.player.getVideoData ? S.player.getVideoData() : {};
  let title = cleanTitle(d.title), artist = String(d.author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);              // „Wykonawca – Tytuł”
  if (m && (!artist || m[1].toLowerCase().includes(artist.toLowerCase().slice(0, 4)))) { artist = m[1]; title = m[2]; }
  $('#rTitle').textContent = title || '(brak tytułu)';
  $('#rArtist').textContent = artist;
  $('#rYear').textContent = S.year || ''; $('#rYear').hidden = !S.year; $('#rNote').hidden = !!S.year;
  show('vReveal');
}

// pętla: wykrywa reklamę, włącza dźwięk przy starcie nagrania, odlicza i zatrzymuje
setInterval(() => {
  const w = S.want, p = S.player;
  document.body.classList.toggle('live', !!(w && w.started && !w.paused && !w.ended));   // muzyka gra → głośnik i pasek „żyją”
  if (!w || !p || !p.getPlayerState) return;
  const st = p.getPlayerState(), t = p.getCurrentTime(), vid = (p.getVideoData() || {}).video_id;
  if (!w.started) {
    if (st === YT.PlayerState.PLAYING && vid === w.id && t >= w.start - 1.5 && t < w.start + 20) {
      w.started = true; w.endAt = Date.now() + w.len * 1000; S.total = w.len;
      p.unMute(); p.setVolume(100); neutralMediaSession(); setWait('');
      navigator.vibrate?.(30);
      log(w.ad ? `Start po reklamie (${Math.round((Date.now() - w.t0) / 1000)} s)` : 'Start bez reklamy');
    } else {
      const moving = w.lastT !== undefined && Math.abs(t - w.lastT) > 0.1;
      if (!w.ad && ((moving && t < w.start - 1.5) || (st === YT.PlayerState.PLAYING && vid !== w.id))) {
        w.ad = true; setWait('Reklama gra bez dźwięku – chwilka…'); log('Reklama (wyciszona)', false);
      }
      w.lastT = t;
      if (Date.now() - w.t0 > 150000) { setWait('Nie udało się uruchomić nagrania'); S.want = null; setToggle('ended'); }
    }
    return;
  }
  if (w.paused || w.ended) return;
  const left = Math.max(0, (w.endAt - Date.now()) / 1000);
  $('#count').textContent = fmtCount(Math.ceil(left)); setArc(left / S.total);
  if (left < 1.2) p.setVolume(Math.round(left / 1.2 * 100));           // łagodne wyciszenie na końcu
  if (left <= 0) { w.ended = true; p.pauseVideo(); p.setVolume(100); setToggle('ended'); navigator.vibrate?.([40, 60, 40]); }
}, 120);

/* ------------------------------------------------------------ skaner QR */
let detector = null;
async function startScan() {
  stopAll(); show('vScan'); $('#scanMsg').textContent = 'Skieruj aparat na kod QR karty';
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { $('#scanMsg').textContent = 'Brak dostępu do aparatu: ' + e.message; return; }
  const v = $('#video'); v.srcObject = S.stream; await v.play().catch(() => {});
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
    if (m) { navigator.vibrate?.(60); stopScan(); play(m[1], +m[2], true, decYear(m[3])); return; }
    $('#scanMsg').textContent = 'To nie jest karta Prywatki';
  }
  setTimeout(scanLoop, detector ? 120 : 180);
}

/* ------------------------------------------------------------ ustawienia i narzędzia */
function ytId(v) { const m = String(v).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/); return m ? m[1] : (/^[\w-]{11}$/.test(v.trim()) ? v.trim() : null); }
function showQR(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  $('#qrImg').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  $('#qrTxt').textContent = text; $('#qrBox').hidden = false;
}
function renderLen() { document.querySelectorAll('#lenSeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === S.len)); }

async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

function bind() {
  $('#scanBtn').onclick = startScan;
  $('#howBtn').onclick = () => $('#howDlg').showModal();
  $('#setBtn').onclick = () => $('#setDlg').showModal();
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('#scanBack').onclick = () => { stopScan(); show('vHome'); };
  $('#playBack').onclick = () => { stopAll(); show('vHome'); };
  $('#revBack').onclick = () => show('vPlay');
  $('#againBtn').onclick = () => S.cur && play(S.cur.id, S.cur.start);
  $('#againBtn2').onclick = () => S.cur && play(S.cur.id, S.cur.start);
  $('#toggleBtn').onclick = toggle;
  $('#revealBtn').onclick = reveal;
  $('#nextBtn').onclick = startScan;
  $('#nextBtn2').onclick = startScan;
  document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => applyTheme(b.dataset.v));
  document.querySelectorAll('#lenSeg button').forEach(b => b.onclick = () => { S.len = +b.dataset.v; store.set('len2', S.len); renderLen(); });
  $('#manualForm').onsubmit = e => { e.preventDefault(); const m = $('#manual').value.trim().match(QR_RE); if (m) { $('#setDlg').close(); play(m[1], +m[2], true, decYear(m[3])); } else toast('Zły format. Przykład: PRYWATKA2;BSTsnWoslP4;149'); };
  $('#linkForm').onsubmit = e => { e.preventDefault(); const id = ytId($('#link').value); if (!id) return toast('Nie rozpoznaję linku YouTube'); const y = +$('#linkYear').value; showQR(`PRYWATKA2;${id};${+$('#linkSec').value || 0}` + (y > 1900 && y < 2100 ? ';' + encYear(y) : '')); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
bind(); renderLen(); buildDecor(); setToggle('playing'); show('vHome'); applyTheme(S.theme); keepAwake(); trackBall();
$('#manual').value = 'PRYWATKA2;BSTsnWoslP4;149;' + encYear(1975);
document.fonts?.ready.then(() => requestAnimationFrame(placeBall));
