/* Prywatka – wersja funkcjonalna (test Spotify + QR) */
'use strict';
const CLIENT_ID = '9f67b91656e04184a410b44f5b2d5d4a';
const SCOPES = 'user-read-playback-state user-modify-playback-state';
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
const API = 'https://api.spotify.com/v1';
const QR_RE = /^(?:PRYWATKA1|KARTKI1);([A-Za-z0-9]{22});(\d{1,4})$/;

const $ = s => document.querySelector(s);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('pry.' + k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem('pry.' + k, JSON.stringify(v)); } catch (e) {} },
  del: k => { try { localStorage.removeItem('pry.' + k); } catch (e) {} },
};
const S = { token: store.get('token'), device: store.get('device'), len: store.get('len') || 30,
  cur: null, timer: null, endsAt: 0, paused: false, remaining: 0, stream: null, scanning: false };

/* ------------------------------------------------------------ UI pomocnicze */
function show(id) { document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== id); }
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms); }
function log(msg, ok = true) {
  const li = document.createElement('li'); li.className = ok ? '' : 'err';
  li.textContent = new Date().toLocaleTimeString('pl-PL') + '  ' + msg;
  const ol = $('#log'); ol.prepend(li); while (ol.children.length > 40) ol.lastChild.remove();
}

/* ------------------------------------------------------------ logowanie (PKCE) */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set('verifier', verifier);
  const p = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, scope: SCOPES,
    redirect_uri: REDIRECT, code_challenge_method: 'S256', code_challenge: challenge });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}
async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, ...params }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || r.status);
  S.token = { access: j.access_token, refresh: j.refresh_token || S.token?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000 };
  store.set('token', S.token);
}
async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (q.get('error')) { toast('Logowanie przerwane: ' + q.get('error')); history.replaceState(null, '', REDIRECT); return; }
  if (!q.get('code')) return;
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: store.get('verifier') });
    log('Zalogowano do Spotify');
  } catch (e) { toast('Błąd logowania: ' + e.message); log('Logowanie: ' + e.message, false); }
  history.replaceState(null, '', REDIRECT);
}
function logout() { S.token = null; store.del('token'); store.del('device'); S.device = null; boot(); }

/* ------------------------------------------------------------ Spotify API */
async function api(method, path, body, retry = true) {
  if (!S.token) throw new Error('Brak logowania');
  if (Date.now() > S.token.exp) await tokenRequest({ grant_type: 'refresh_token', refresh_token: S.token.refresh });
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + S.token.access,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && retry) { await tokenRequest({ grant_type: 'refresh_token', refresh_token: S.token.refresh }); return api(method, path, body, false); }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  const short = path.split('?')[0];
  if (!r.ok) {
    const msg = j?.error?.message || txt || r.statusText;
    log(`${method} ${short} → ${r.status} ${msg}`, false);
    const err = new Error(msg); err.status = r.status; err.reason = j?.error?.reason; throw err;
  }
  log(`${method} ${short} → ${r.status}`);
  return j;
}

/* ------------------------------------------------------------ urządzenia */
async function loadDevices() {
  const j = await api('GET', '/me/player/devices');
  return j?.devices || [];
}
function setDevice(d) { S.device = d ? { id: d.id, name: d.name, type: d.type } : null; store.set('device', S.device); $('#devName').textContent = S.device ? S.device.name : 'wybierz urządzenie'; }
async function pickDevice(open = true) {
  let devs = [];
  try { devs = await loadDevices(); } catch (e) { toast('Nie udało się pobrać urządzeń: ' + e.message); }
  const known = devs.find(d => d.id === S.device?.id);
  if (known) setDevice(known);
  else if (devs.length) setDevice(devs.find(d => d.is_active) || devs.find(d => d.type === 'Smartphone') || devs[0]);
  if (open || !S.device || !known && !devs.length) {
    $('#devList').innerHTML = devs.map((d, i) => `<li><button data-i="${i}" class="${d.id === S.device?.id ? 'on' : ''}">${d.type === 'Smartphone' ? '📱' : d.type === 'Computer' ? '💻' : '🔊'} ${esc(d.name)}${d.is_active ? ' · aktywne' : ''}</button></li>`).join('')
      || '<li class="hint">Brak dostępnych urządzeń.</li>';
    $('#devList').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) { setDevice(devs[+b.dataset.i]); $('#devDlg').close(); } };
    if (!$('#devDlg').open) $('#devDlg').showModal();
  }
  return devs;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------ odtwarzanie */
async function play(trackId, startSec) {
  S.cur = { id: trackId, start: startSec };
  $('#reveal').hidden = true; $('#reveal').textContent = '';
  show('vPlay'); $('#playMsg').textContent = 'Uruchamiam…';
  if (!S.device) { await pickDevice(true); if (!S.device) return; }
  const body = { uris: ['spotify:track:' + trackId], position_ms: startSec * 1000 };
  try {
    await api('PUT', '/me/player/play?device_id=' + encodeURIComponent(S.device.id), body);
  } catch (e) {
    if (e.status === 404) {          // urządzenie uśpione – spróbuj je przebudzić
      try {
        await api('PUT', '/me/player', { device_ids: [S.device.id], play: false });
        await new Promise(r => setTimeout(r, 800));
        await api('PUT', '/me/player/play?device_id=' + encodeURIComponent(S.device.id), body);
      } catch (e2) { $('#playMsg').textContent = 'Nie widzę urządzenia. Otwórz Spotify i spróbuj ponownie.'; pickDevice(true); return; }
    } else if (e.status === 403) { $('#playMsg').textContent = 'Spotify odmówił odtwarzania (403): ' + e.message; return; }
    else { $('#playMsg').textContent = 'Błąd: ' + e.message; return; }
  }
  startTimer(S.len);
  $('#playMsg').textContent = 'Słuchaj uważnie…';
  $('#pauseBtn').textContent = '⏸ Pauza'; S.paused = false;
}
function startTimer(sec) {
  clearInterval(S.timer); S.total = sec; S.endsAt = Date.now() + sec * 1000; tick();
  S.timer = setInterval(tick, 200);
}
function tick() {
  const left = Math.max(0, (S.endsAt - Date.now()) / 1000);
  $('#count').textContent = Math.ceil(left);
  const C = 2 * Math.PI * 54; $('#arc').style.strokeDasharray = C; $('#arc').style.strokeDashoffset = C * (1 - left / S.total);
  if (left <= 0) { clearInterval(S.timer); S.timer = null; stopPlayback('Koniec fragmentu.'); }
}
async function stopPlayback(msg) {
  try { await api('PUT', '/me/player/pause?device_id=' + encodeURIComponent(S.device.id)); } catch (e) {}
  $('#playMsg').textContent = msg || 'Zatrzymano.';
}
async function togglePause() {
  if (!S.cur) return;
  if (!S.paused) {
    S.remaining = Math.max(0, (S.endsAt - Date.now()) / 1000); clearInterval(S.timer); S.timer = null;
    await stopPlayback('Pauza.'); S.paused = true; $('#pauseBtn').textContent = '▶ Wznów';
  } else {
    try { await api('PUT', '/me/player/play?device_id=' + encodeURIComponent(S.device.id)); } catch (e) { return; }
    S.paused = false; $('#pauseBtn').textContent = '⏸ Pauza'; $('#playMsg').textContent = 'Słuchaj uważnie…';
    S.total = S.remaining || 1; S.endsAt = Date.now() + S.remaining * 1000; S.timer = setInterval(tick, 200);
  }
}
async function more() {
  if (!S.cur) return;
  const left = Math.max(0, (S.endsAt - Date.now()) / 1000);
  if (!S.timer) { try { await api('PUT', '/me/player/play?device_id=' + encodeURIComponent(S.device.id)); } catch (e) { return; } }
  S.paused = false; $('#pauseBtn').textContent = '⏸ Pauza'; $('#playMsg').textContent = 'Słuchaj uważnie…';
  startTimer(left + 15);
}
async function reveal() {
  if (!S.cur) return;
  try {
    const t = await api('GET', '/tracks/' + S.cur.id);
    $('#reveal').innerHTML = `<b>${esc(t.artists.map(a => a.name).join(', '))}</b><br>${esc(t.name)}<br><small>album: ${esc(t.album.name)} · wydanie albumu: ${esc(t.album.release_date)}</small>`;
  } catch (e) { $('#reveal').textContent = 'Nie udało się pobrać informacji: ' + e.message; }
  $('#reveal').hidden = false;
}

/* ------------------------------------------------------------ skaner QR */
let detector = null;
async function startScan() {
  show('vScan'); $('#scanMsg').textContent = 'Skieruj aparat na kod QR karty.';
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch (e) { $('#scanMsg').textContent = 'Brak dostępu do aparatu: ' + e.message; return; }
  const v = $('#video'); v.srcObject = S.stream; await v.play();
  if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { detector = null; } }
  S.scanning = true; scanLoop();
}
function stopScan() {
  S.scanning = false;
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
}
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
async function search(q) {
  $('#results').innerHTML = '<li class="hint">Szukam…</li>';
  try {
    const j = await api('GET', '/search?type=track&limit=5&q=' + encodeURIComponent(q));
    const items = j.tracks.items;
    $('#results').innerHTML = items.map((t, i) => `<li>
      <div><b>${esc(t.name)}</b><br><small>${esc(t.artists.map(a => a.name).join(', '))} · ${fmt(t.duration_ms / 1000)} · ${esc(t.album.release_date)}</small></div>
      <div class="row"><input type="number" min="0" value="60" data-s="${i}" aria-label="Start w sekundach"><button data-play="${i}">▶</button><button data-qr="${i}">QR</button></div></li>`).join('')
      || '<li class="hint">Nic nie znaleziono.</li>';
    $('#results').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const i = +(b.dataset.play ?? b.dataset.qr), t = items[i], s = +$(`input[data-s="${i}"]`).value || 0;
      if (b.dataset.play != null) play(t.id, s); else showQR(`PRYWATKA1;${t.id};${s}`);
    };
  } catch (e) { $('#results').innerHTML = `<li class="err">Błąd wyszukiwania: ${esc(e.message)}</li>`; }
}
function showQR(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  $('#qrImg').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  $('#qrTxt').textContent = text; $('#qrBox').hidden = false;
}
const fmt = t => Math.floor(t / 60) + ':' + String(Math.round(t % 60)).padStart(2, '0');

/* ------------------------------------------------------------ start */
let wake = null;
async function keepAwake() { try { wake = await navigator.wakeLock?.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

async function boot() {
  await handleRedirect();
  const logged = !!S.token;
  $('#devBtn').hidden = !logged;
  if (!logged) { show('vLogin'); return; }
  setDevice(S.device); show('vHome'); keepAwake();
  pickDevice(false);
}
function bind() {
  $('#loginBtn').onclick = login;
  $('#logoutBtn').onclick = logout;
  $('#devBtn').onclick = () => pickDevice(true);
  $('#devRefresh').onclick = () => pickDevice(true);
  $('#devClose').onclick = () => $('#devDlg').close();
  $('#scanBtn').onclick = startScan;
  $('#nextBtn').onclick = async () => { clearInterval(S.timer); S.timer = null; if (S.cur && !S.paused) stopPlayback(); startScan(); };
  $('#scanCancel').onclick = () => { stopScan(); show('vHome'); };
  $('#againBtn').onclick = () => S.cur && play(S.cur.id, S.cur.start);
  $('#moreBtn').onclick = more;
  $('#pauseBtn').onclick = togglePause;
  $('#revealBtn').onclick = reveal;
  $('#searchForm').onsubmit = e => { e.preventDefault(); const q = $('#q').value.trim(); if (q) search(q); };
  $('#manualForm').onsubmit = e => { e.preventDefault(); const m = $('#manual').value.trim().match(QR_RE); if (m) play(m[1], +m[2]); else toast('Zły format. Przykład: PRYWATKA1;<22 znaki ID>;60'); };
  $('#lenSel').value = String(S.len);
  $('#lenSel').onchange = e => { S.len = +e.target.value; store.set('len', S.len); };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
bind(); boot();
