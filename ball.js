/* Prywatka – kula disco rysowana na żywo (canvas).
   ~1300 lusterek na sferze; kolor każdego to odbicie kolorowych świateł sali + indywidualny „szum”,
   a lusterka trafiające w główne światło błyskają na biało. */
'use strict';
(function () {
  const NLAT = 26, NLON = 52, GAP = 0.09;
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const L = norm([-0.55, -0.65, 0.55]);
  const SPOTS = [
    [norm([-0.75, -0.35, 0.55]), [255, 79, 163], 0.6],
    [norm([-0.2, -0.4, 0.9]), [255, 240, 250], 0.35],
    [norm([0.8, -0.25, 0.55]), [110, 210, 255], 0.5],
    [norm([0.25, 0.85, 0.45]), [255, 205, 100], 0.5],
    [norm([-0.3, 0.7, 0.6]), [150, 120, 255], 0.5],
    [norm([0.0, -0.95, 0.3]), [255, 150, 220], 0.45],
  ];
  const BASE = [70, 52, 130];
  const rnd = (a, b, s) => { let x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x); };

  function env(r) {
    const c = BASE.slice();
    for (const [d, col, w] of SPOTS) {
      const cos = Math.max(-1, Math.min(1, r[0] * d[0] + r[1] * d[1] + r[2] * d[2]));
      const k = Math.exp(-((Math.acos(cos) / w) ** 2)) * 0.98;
      for (let i = 0; i < 3; i++) c[i] += (col[i] - c[i]) * k;
    }
    return c;
  }

  // stałe dane lusterek
  const tiles = [];
  for (let i = 0; i < NLAT; i++) {
    const la0 = -90 + 180 * i / NLAT, la1 = -90 + 180 * (i + 1) / NLAT;
    if (Math.abs((la0 + la1) / 2) > 84) continue;
    for (let k = 0; k < NLON; k++) tiles.push({ i, k, la0, la1, jit: 0.7 + 0.6 * rnd(i, k, 1), glint: rnd(k, i, 7) > 0.965 });
  }
  const D = Math.PI / 180;

  function Ball(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.rot = 0; this.speed = 6; this.target = 6; this.last = 0; this.running = false;
  }
  Ball.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.max(10, Math.round(r.width));
    this.c.width = this.size * dpr; this.c.height = this.size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };
  Ball.prototype.setSpeed = function (degPerSec) { this.target = degPerSec; };
  Ball.prototype.start = function () {
    if (this.running) return; this.running = true; this.last = performance.now();
    const loop = t => {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
      this.speed += (this.target - this.speed) * Math.min(1, dt * 2.5);   // płynne przyspieszanie/zwalnianie
      this.rot = (this.rot + this.speed * dt) % 360;
      this.draw(); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  Ball.prototype.stop = function () { this.running = false; };
  Ball.prototype.draw = function () {
    const g = this.ctx, S = this.size || 200, R = S / 2, C = S / 2;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#0b0720'; g.beginPath(); g.arc(C, C, R - 0.5, 0, Math.PI * 2); g.fill();
    const step = 360 / NLON;
    for (const t of tiles) {
      const lo0 = t.k * step + this.rot, lo1 = lo0 + step;
      const cla = (t.la0 + t.la1) / 2, clo = (lo0 + lo1) / 2;
      const ca = cla * D, cb = clo * D;
      const n = [Math.cos(ca) * Math.sin(cb), -Math.sin(ca), Math.cos(ca) * Math.cos(cb)];
      if (n[2] <= 0.02) continue;
      const dd = n[2], r = [2 * dd * n[0], 2 * dd * n[1], 2 * dd * n[2] - 1];
      const col = env(r);
      const sp = Math.max(0, r[0] * L[0] + r[1] * L[1] + r[2] * L[2]) ** 25 + (t.glint ? 0.85 : 0);
      const limb = 0.45 + 0.55 * Math.sqrt(n[2]);
      g.fillStyle = `rgb(${Math.min(255, col[0] * t.jit * limb + 306 * sp) | 0},${Math.min(255, col[1] * t.jit * limb + 306 * sp) | 0},${Math.min(255, col[2] * t.jit * limb + 306 * sp) | 0})`;
      g.beginPath();
      const corners = [[t.la0, lo0], [t.la0, lo1], [t.la1, lo1], [t.la1, lo0]];
      for (let j = 0; j < 4; j++) {
        const la = (cla + (corners[j][0] - cla) * (1 - GAP)) * D, lo = (clo + (corners[j][1] - clo) * (1 - GAP)) * D;
        const x = C + R * Math.cos(la) * Math.sin(lo), y = C - R * Math.sin(la);
        if (Math.cos(la) * Math.cos(lo) < -0.05) { /* róg za horyzontem – i tak blisko krawędzi */ }
        j ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.fill();
    }
    const sh = g.createRadialGradient(C * 0.76, C * 0.64, 0, C, C, R * 1.02);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.72, 'rgba(5,3,15,0.1)'); sh.addColorStop(1, 'rgba(5,3,15,0.6)');
    g.fillStyle = sh; g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();
  };
  window.DiscoBall = Ball;
})();
