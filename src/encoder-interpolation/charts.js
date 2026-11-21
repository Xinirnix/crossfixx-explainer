// Canvas drawings for the encoder page: the scale under the read head, the sin/cos signals,
// the Lissajous figure and the cyclic error. Plain 2D canvas, redrawn every frame.
import { signals, measure } from './model.js';

const TAU = 2 * Math.PI;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = () => ({
  text: css('--text'), muted: css('--muted'), grid: 'rgba(255,255,255,0.07)',
  hot: css('--hot'), cool: css('--cool'), warn: css('--warn'), ok: '#7ee0a1',
  mono: '10.5px "IBM Plex Mono", ui-monospace, monospace',
});

export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

const fmtLen = (um) => (Math.abs(um) >= 1000 ? `${(um / 1000).toFixed(3)} mm` : `${um.toFixed(3)} µm`);

// ---------- Scale and read head ----------
// The read head stays in the middle; the scale slides under it. Below: one period, cut into N counts.
export function drawScale(canvas, p, x, m) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const P = p.periodUm;
  const span = 3.2 * P; // µm across the canvas
  const X = (u) => W / 2 + ((u - x) / span) * W;
  const sy = 34, sh = 30; // scale band
  ctx.fillStyle = '#151a22'; ctx.fillRect(0, sy, W, sh);
  const n0 = Math.floor((x - span / 2) / P) - 1, n1 = Math.ceil((x + span / 2) / P) + 1;
  ctx.font = c.mono;
  for (let n = n0; n <= n1; n++) {
    // reflective line = first half of each period
    ctx.fillStyle = 'rgba(200,210,225,0.55)';
    ctx.fillRect(X(n * P), sy, (P / 2 / span) * W, sh);
    ctx.fillStyle = c.muted; ctx.textAlign = 'center';
    ctx.fillText(`${n}`, X(n * P), sy + sh + 12);
  }
  ctx.textAlign = 'left'; ctx.fillStyle = c.muted;
  ctx.fillText(`scale · period ${P} µm · numbered`, 6, 11);

  // read head window (fixed)
  const hw = 0.9 * (P / span) * W;
  ctx.strokeStyle = c.cool; ctx.lineWidth = 1.5;
  ctx.strokeRect(W / 2 - hw / 2, sy - 14, hw, sh + 10);
  ctx.fillStyle = 'rgba(95,211,255,0.08)'; ctx.fillRect(W / 2 - hw / 2, sy - 14, hw, 10);
  ctx.fillStyle = c.cool; ctx.fillText('read head', W / 2 + hw / 2 + 6, sy - 5);
  ctx.beginPath(); ctx.moveTo(W / 2, sy - 4); ctx.lineTo(W / 2, sy + sh + 2); ctx.stroke();
  ctx.lineWidth = 1;

  // one period, cut into N counts
  const ry = sy + sh + 26, rh = 16, rl = 14, rr = W - 14, rw = rr - rl;
  const frac = m.phi / TAU;
  const N = p.N, ticks = Math.min(N, 128);
  ctx.fillStyle = '#12161d'; ctx.fillRect(rl, ry, rw, rh);
  ctx.fillStyle = 'rgba(95,211,255,0.22)'; ctx.fillRect(rl, ry, rw * frac, rh);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  for (let k = 0; k <= ticks; k++) {
    const px = rl + (k / ticks) * rw;
    ctx.beginPath(); ctx.moveTo(px, ry + (k % (ticks / 4) === 0 ? 0 : rh * 0.55)); ctx.lineTo(px, ry + rh); ctx.stroke();
  }
  // current count cell
  const lsbFrac = 1 / N;
  const kIn = ((m.count % N) + N) % N;
  ctx.fillStyle = c.hot; ctx.fillRect(rl + kIn * lsbFrac * rw, ry - 3, Math.max(2, lsbFrac * rw), rh + 6);
  // true position within the period
  const tf = ((x / P) % 1 + 1) % 1;
  ctx.strokeStyle = c.text; ctx.beginPath(); ctx.moveTo(rl + tf * rw, ry - 6); ctx.lineTo(rl + tf * rw, ry + rh + 6); ctx.stroke();
  ctx.fillStyle = c.muted; ctx.textAlign = 'left';
  ctx.fillText(`one period = ${N} counts${N > ticks ? ` (${ticks} ticks drawn)` : ''}`, rl, ry + rh + 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = c.hot; ctx.fillText(`count ${kIn} of ${N}`, rr, ry + rh + 15);
  ctx.textAlign = 'left';
  return { span, W };
}

// ---------- sin and cos against position ----------
export function drawSignals(canvas, p, x) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const P = p.periodUm;
  const x0 = x - P, x1 = x + P;
  const pad = { l: 40, r: 10, t: 8, b: 20 };
  const R = 1.5 * Math.max(1, p.amp);
  const X = (u) => pad.l + ((u - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + ((R - v) / (2 * R)) * (H - pad.t - pad.b);
  ctx.font = c.mono; ctx.strokeStyle = c.grid;
  for (const v of [-1, 0, 1]) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(v === 0 ? '0' : v > 0 ? '+A' : '−A', pad.l - 6, Y(v) + 3);
  }
  for (let n = Math.ceil(x0 / P); n <= Math.floor(x1 / P); n++) {
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X(n * P), pad.t); ctx.lineTo(X(n * P), H - pad.b); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.fillText(`${(n * P).toFixed(0)} µm`, X(n * P), H - 6);
  }
  const line = (fn, color, dash = []) => {
    ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const u = x0 + ((x1 - x0) * i) / 300;
      const v = fn(u);
      i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v));
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  const th = (u) => (TAU * u) / P;
  ctx.lineWidth = 1;
  line((u) => Math.cos(th(u)), 'rgba(95,211,255,0.3)', [3, 4]);
  line((u) => Math.sin(th(u)), 'rgba(255,179,92,0.3)', [3, 4]);
  ctx.lineWidth = 2;
  line((u) => signals(th(u), p).c, c.cool);
  line((u) => signals(th(u), p).s, c.hot);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(X(x), pad.t); ctx.lineTo(X(x), H - pad.b); ctx.stroke();
  const s = signals(th(x), p);
  for (const [v, col] of [[s.c, c.cool], [s.s, c.hot]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(x), Y(v), 4, 0, TAU); ctx.fill(); }
  ctx.textAlign = 'left';
}

// ---------- Lissajous: cos horizontal, sin vertical [SmarAct] ----------
export function drawLissajous(canvas, p, m, noisy, E = 1) {
  // Distortion is drawn E× larger than it is, so a 1 % error is visible. The angle label stays the real one.
  const D = (th, sig) => {
    const ic = p.amp * Math.cos(th), is = p.amp * Math.sin(th);
    return { c: ic + E * (sig.c - ic), s: is + E * (sig.s - is) };
  };
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const S = Math.min(W, H);
  const cx = W / 2, cy = H / 2;
  const R = 1.3 * Math.max(1, p.amp * (1 + E * Math.abs(p.gain) / 2) + E * Math.hypot(p.offX, p.offY) + E * p.amp * Math.abs(p.phaseDeg) / 90);
  const k = (S / 2 - 8) / R;
  const X = (v) => cx + v * k, Y = (v) => cy - v * k;
  ctx.font = c.mono;
  ctx.strokeStyle = c.grid;
  ctx.beginPath(); ctx.moveTo(X(-R), Y(0)); ctx.lineTo(X(R), Y(0)); ctx.moveTo(X(0), Y(-R)); ctx.lineTo(X(0), Y(R)); ctx.stroke();
  ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText('cos →', X(R) - 2, Y(0) - 6);
  ctx.textAlign = 'left'; ctx.fillText('↑ sin', X(0) + 6, Y(R) + 12);

  // counts as sectors on the ideal circle
  const ticks = Math.min(p.N, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  for (let i = 0; i < ticks; i++) {
    const a = (TAU * i) / ticks, r0 = i % (ticks / 4) === 0 ? 0.8 : 0.93;
    ctx.beginPath(); ctx.moveTo(X(r0 * Math.cos(a)), Y(r0 * Math.sin(a))); ctx.lineTo(X(1.07 * Math.cos(a)), Y(1.07 * Math.sin(a))); ctx.stroke();
  }
  // ideal circle
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(X(0), Y(0), k, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  // measured figure (noise-free shape)
  ctx.strokeStyle = c.hot; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 360; i++) { const th = (TAU * i) / 360; const s = D(th, signals(th, p)); i ? ctx.lineTo(X(s.c), Y(s.s)) : ctx.moveTo(X(s.c), Y(s.s)); }
  ctx.stroke(); ctx.lineWidth = 1;
  // noisy samples
  if (noisy.length) {
    ctx.fillStyle = 'rgba(255,179,92,0.35)';
    for (const n of noisy) { const s = D(n.theta, n); ctx.fillRect(X(s.c) - 1, Y(s.s) - 1, 2, 2); }
  }
  // centre the read-out assumes, and the fitted centre when correcting
  const ox = p.correct ? E * p.offX : 0, oy = p.correct ? E * p.offY : 0;
  const pt = D(m.theta, m);
  if (p.correct && (p.offX || p.offY)) {
    ctx.strokeStyle = c.ok; ctx.beginPath(); ctx.arc(X(ox), Y(oy), 3, 0, TAU); ctx.stroke();
  }
  // true angle (thin), read angle (thick)
  ctx.strokeStyle = 'rgba(232,235,240,0.45)'; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
  ctx.lineTo(X(1.12 * Math.cos(m.theta)), Y(1.12 * Math.sin(m.theta))); ctx.stroke();
  ctx.strokeStyle = c.cool; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(ox), Y(oy)); ctx.lineTo(X(pt.c), Y(pt.s)); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(ox), Y(oy), 0.28 * k, 0, -m.phi, true); ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = c.cool; ctx.fillText(`φ = ${((m.phi * 180) / Math.PI).toFixed(1)}°`, X(ox) + 0.32 * k * Math.cos(m.phi / 2) + 4, Y(oy) - 0.32 * k * Math.sin(m.phi / 2));
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(X(pt.c), Y(pt.s), 5, 0, TAU); ctx.fill();
  ctx.fillStyle = c.muted; ctx.textAlign = 'left';
  ctx.fillText(`${p.N} counts per turn${p.N > ticks ? ` (${ticks} drawn)` : ''}`, 6, H - 6);
  if (E !== 1) { ctx.fillStyle = c.hot; ctx.textAlign = 'right'; ctx.fillText(`distortion drawn ×${E}`, W - 6, H - 6); ctx.textAlign = 'left'; }
  return { cx, cy, k };
}

// ---------- Cyclic error over one period ----------
export function drawError(canvas, an, x) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const { p, xs, err, quant, noisy, lsbNm } = an;
  const P = p.periodUm;
  const lim = Math.max(1.6 * lsbNm, ...err.map(Math.abs), ...quant.map(Math.abs), ...noisy.map(Math.abs)) * 1.15;
  const pad = { l: 56, r: 12, t: 10, b: 22 };
  const X = (u) => pad.l + (u / P) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + ((lim - v) / (2 * lim)) * (H - pad.t - pad.b);
  ctx.font = c.mono;
  const step = nice(lim / 2);
  for (let v = -Math.floor(lim / step) * step; v <= lim; v += step) {
    ctx.strokeStyle = Math.abs(v) < 1e-9 ? 'rgba(255,255,255,0.3)' : c.grid;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(W - pad.r, Y(v)); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(`${+v.toFixed(1)} nm`, pad.l - 6, Y(v) + 3);
  }
  for (let q = 0; q <= 4; q++) {
    const u = (q / 4) * P;
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X(u), pad.t); ctx.lineTo(X(u), H - pad.b); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.fillText(q === 4 ? `${P} µm` : `${+u.toFixed(1)}`, X(u) - (q === 4 ? 16 : 0), H - 6);
  }
  // single noisy readings, then the counter output (staircase), then the cyclic error itself
  ctx.fillStyle = 'rgba(255,179,92,0.45)';
  noisy.forEach((v, i) => ctx.fillRect(X(xs[i]) - 1, Y(v) - 1, 2, 2));
  ctx.strokeStyle = 'rgba(232,235,240,0.35)'; ctx.beginPath();
  quant.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))));
  ctx.stroke();
  ctx.strokeStyle = c.cool; ctx.lineWidth = 2; ctx.beginPath();
  err.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))));
  ctx.stroke(); ctx.lineWidth = 1;
  // where the head is now
  const u = ((x % P) + P) % P;
  const m = measure(u, p);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(X(u), pad.t); ctx.lineTo(X(u), H - pad.b); ctx.stroke();
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(X(u), Y(m.errUm * 1000), 4, 0, TAU); ctx.fill();
  ctx.textAlign = 'left';
}

function nice(raw) {
  const pw = 10 ** Math.floor(Math.log10(raw || 1));
  const r = raw / pw;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * pw;
}

export { fmtLen };
