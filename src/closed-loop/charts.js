// Canvas charts for the closed-loop page: the whole move, the landing in encoder counts,
// and the drive the controller sends. Plain 2D canvas, redrawn on every change.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = () => ({
  text: css('--text'), muted: css('--muted'), line: 'rgba(255,255,255,0.07)',
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

// Plot frame with linear scales. pad = { l, r, t, b } in px.
function frame(ctx, W, H, x0, x1, y0, y1, pad = { l: 52, r: 14, t: 10, b: 22 }) {
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const inv = (px) => x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
  return { X, Y, inv, pad, clip() { ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); ctx.clip(); } };
}

function niceStep(range, target = 5) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

function axes(ctx, f, W, H, x0, x1, y0, y1, c, yFmt = (v) => v, xLabel = 'ms') {
  ctx.font = c.mono; ctx.lineWidth = 1;
  const xs = niceStep(x1 - x0, 8);
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.X(v), f.pad.t); ctx.lineTo(f.X(v), H - f.pad.b); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'center';
    if (f.X(v) < W - 34) ctx.fillText(`${+v.toFixed(1)}`, f.X(v), H - 7);
  }
  ctx.textAlign = 'right'; ctx.fillText(xLabel, W - 2, H - 7);
  const ys = niceStep(y1 - y0, 4);
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
    ctx.strokeStyle = c.line; ctx.beginPath(); ctx.moveTo(f.pad.l, f.Y(v)); ctx.lineTo(W - f.pad.r, f.Y(v)); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(yFmt(v), f.pad.l - 6, f.Y(v) + 3);
  }
  ctx.textAlign = 'left';
}

function vmark(ctx, f, H, t, color, label, dash = [3, 3], row = 0) {
  ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath();
  ctx.moveTo(f.X(t), f.pad.t); ctx.lineTo(f.X(t), H - f.pad.b); ctx.stroke(); ctx.setLineDash([]);
  if (label) { ctx.fillStyle = color; ctx.fillText(label, f.X(t) + 4, f.pad.t + 11 + row * 13); }
}

function cursor(ctx, f, H, t) {
  if (t == null) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath();
  ctx.moveTo(f.X(t), f.pad.t); ctx.lineTo(f.X(t), H - f.pad.b); ctx.stroke();
}

function path(ctx, xs, ys, X, Y, step = false) {
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const px = X(xs[i]), py = Y(ys[i]);
    if (i === 0) ctx.moveTo(px, py);
    else if (step) { ctx.lineTo(px, Y(ys[i - 1])); ctx.lineTo(px, py); }
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// Shade the spans where the drive is off (self-locked).
function offSpans(ctx, f, H, out, color) {
  ctx.fillStyle = color;
  let start = null;
  for (let i = 0; i <= out.t.length; i++) {
    const off = i < out.t.length && !out.on[i];
    if (off && start === null) start = out.t[i];
    if (!off && start !== null) {
      ctx.fillRect(f.X(start), f.pad.t, f.X(out.t[i - 1]) - f.X(start), H - f.pad.t - f.pad.b);
      start = null;
    }
  }
}

export function drawMove(canvas, run, tCur) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const { out, p, summary: s } = run;
  const t1 = out.t[out.t.length - 1];
  let lo = Math.min(0, ...out.x), hi = Math.max(p.moveUm, ...out.x);
  const padY = (hi - lo) * 0.08 || 1; lo -= padY; hi += padY;
  const f = frame(ctx, W, H, 0, t1, lo, hi);
  axes(ctx, f, W, H, 0, t1, lo, hi, c, (v) => (Math.abs(hi - lo) > 2000 ? `${+(v / 1000).toFixed(2)} mm` : `${+v.toFixed(0)} µm`));
  f.clip();
  offSpans(ctx, f, H, out, 'rgba(126,224,161,0.07)');
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(f.X(0), f.Y(p.moveUm)); ctx.lineTo(f.X(t1), f.Y(p.moveUm)); ctx.stroke(); ctx.setLineDash([]);
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(232,235,240,0.5)'; ctx.setLineDash([5, 4]); path(ctx, out.t, out.sp, f.X, f.Y); ctx.setLineDash([]);
  ctx.lineWidth = 2; ctx.strokeStyle = c.cool; path(ctx, out.t, out.x, f.X, f.Y);
  ctx.lineWidth = 1;
  ctx.restore();
  ctx.font = c.mono;
  vmark(ctx, f, H, s.profileMs, c.muted, 'profile ends');
  if (s.elimMs != null) vmark(ctx, f, H, s.elimMs, c.warn, 'ELIM: safe mode', [3, 3], 1);
  if (s.reachedMs != null) vmark(ctx, f, H, s.reachedMs, c.ok, 'position reached', [], 1);
  cursor(ctx, f, H, tCur);
  return f;
}

export function drawLanding(canvas, run, tCur) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const { out, p, summary: s } = run;
  const tEnd = out.t[out.t.length - 1];
  const t0 = Math.max(0, Math.min(s.profileMs - 8, tEnd - 20));
  // show the landing, not the long flat tail after it
  const t1 = Math.min(tEnd, Math.max(s.profileMs + 40, (s.reachedMs ?? tEnd) + 20, (s.timeoutMs ?? 0) + 15));
  const R = Math.max(6, Math.ceil(p.PTO2 * 2.2), Math.ceil(p.PTOL * 3));
  const res = s.res;
  const f = frame(ctx, W, H, t0, t1, -R, R);
  ctx.font = c.mono;
  // encoder count grid: one line per count when it fits, else every 5 or 10
  const every = R <= 12 ? 1 : R <= 30 ? 2 : R <= 60 ? 5 : 10;
  for (let k = -R; k <= R; k++) {
    if (k % every) continue;
    ctx.strokeStyle = k === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.moveTo(f.pad.l, f.Y(k)); ctx.lineTo(W - f.pad.r, f.Y(k)); ctx.stroke();
    if (k % (every * (R > 12 ? 2 : 2)) === 0) { ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(`${k > 0 ? '+' : ''}${k}`, f.pad.l - 6, f.Y(k) + 3); }
  }
  ctx.textAlign = 'left';
  const xs = niceStep(t1 - t0, 8);
  for (let v = Math.ceil(t0 / xs) * xs; v <= t1; v += xs) { ctx.fillStyle = c.muted; ctx.textAlign = 'center'; if (f.X(v) < W - 34) ctx.fillText(`${+v.toFixed(1)}`, f.X(v), H - 7); }
  ctx.textAlign = 'right'; ctx.fillText('ms', W - 2, H - 7); ctx.textAlign = 'left';
  ctx.save(); ctx.translate(12, H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = c.muted;
  ctx.fillText(`counts (1 = ${p.encNm} nm)`, 0, 0); ctx.restore();

  f.clip();
  // tolerance bands
  ctx.fillStyle = 'rgba(255,179,92,0.08)'; ctx.fillRect(f.pad.l, f.Y(p.PTO2 + 0.5), W, f.Y(-p.PTO2 - 0.5) - f.Y(p.PTO2 + 0.5));
  ctx.fillStyle = 'rgba(95,211,255,0.16)'; ctx.fillRect(f.pad.l, f.Y(p.PTOL + 0.5), W, f.Y(-p.PTOL - 0.5) - f.Y(p.PTOL + 0.5));
  offSpans(ctx, f, H, out, 'rgba(126,224,161,0.10)');
  // true position (thin) and encoder reading (staircase)
  const i0 = out.t.findIndex((t) => t >= t0);
  const T = out.t.slice(i0);
  const xc = out.x.slice(i0).map((x) => x / res - Math.round(p.moveUm / res));
  const mc = out.meas.slice(i0).map((x) => Math.round(x / res) - Math.round(p.moveUm / res));
  ctx.strokeStyle = 'rgba(232,235,240,0.35)'; ctx.lineWidth = 1; path(ctx, T, xc, f.X, f.Y);
  ctx.strokeStyle = c.cool; ctx.lineWidth = 2; path(ctx, T, mc, f.X, f.Y, true); ctx.lineWidth = 1;
  ctx.restore();
  ctx.font = c.mono;
  vmark(ctx, f, H, s.profileMs, c.muted, 'profile ends');
  if (s.timeoutMs != null) vmark(ctx, f, H, s.timeoutMs, c.hot, `TOUT → PTO2`, [3, 3], 1);
  if (s.reachedMs != null) vmark(ctx, f, H, s.reachedMs, c.ok, 'reached', [], 2);
  cursor(ctx, f, H, tCur);
  return f;
}

export function drawDrive(canvas, run, tCur) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const { out } = run;
  const t1 = out.t[out.t.length - 1];
  const aMax = Math.max(0.05, ...out.amp) * 1.1;
  const f = frame(ctx, W, H, 0, t1, 0, aMax, { l: 52, r: 52, t: 10, b: 22 });
  axes(ctx, f, W, H, 0, t1, 0, aMax, c, (v) => `${+v.toFixed(2)} µm`);
  f.clip();
  // amplitude bars coloured by phase sign
  const bw = Math.max(1, (W - 104) / out.t.length + 0.5);
  for (let i = 0; i < out.t.length; i++) {
    if (out.amp[i] < 1e-4) continue;
    ctx.fillStyle = out.phase[i] > 0 ? c.hot : out.phase[i] < 0 ? c.cool : c.muted;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(f.X(out.t[i]), f.Y(out.amp[i]), bw, f.Y(0) - f.Y(out.amp[i]));
  }
  ctx.globalAlpha = 1;
  // frequency on the right axis, 160–180 kHz
  const fy = (hz) => f.Y(((hz - 160000) / 20000) * aMax);
  ctx.strokeStyle = 'rgba(232,235,240,0.7)'; ctx.lineWidth = 1.2;
  path(ctx, out.t, out.freq, f.X, fy); ctx.lineWidth = 1;
  ctx.restore();
  ctx.font = c.mono; ctx.fillStyle = c.muted;
  for (const hz of [160000, 166000, 170000, 180000]) {
    ctx.fillText(`${hz / 1000}k`, W - f.pad.r + 6, fy(hz) + 3);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([1, 3]);
  ctx.beginPath(); ctx.moveTo(f.pad.l, fy(166000)); ctx.lineTo(W - f.pad.r, fy(166000)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText('resonance', W - f.pad.r - 62, fy(166000) - 4);
  cursor(ctx, f, H, tCur);
  return f;
}

// Real-scale tip ellipse at one instant: x = A sin θ, y = A sin(θ + φ).
export function drawTip(canvas, Aum, phaseDeg, theta) {
  const { ctx, W, H } = fitCanvas(canvas); const c = C();
  const cx = W / 2, cy = H / 2, s = (Math.min(W, H) * 0.4) / 1.0;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(cx, cy, s, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = 'rgba(233,236,239,0.5)'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(8, cy); ctx.lineTo(W - 8, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = c.mono; ctx.fillStyle = c.muted;
  ctx.fillText('strip', 8, cy + 12); ctx.fillText('1 µm', cx + s - 26, cy - s + 2);
  const ph = (phaseDeg * Math.PI) / 180;
  ctx.strokeStyle = phaseDeg > 0 ? c.hot : phaseDeg < 0 ? c.cool : c.muted; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= 64; k++) {
    const th = (k / 64) * 2 * Math.PI;
    const x = cx + s * Aum * Math.sin(th), y = cy + s * Aum * Math.sin(th + ph);
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke(); ctx.lineWidth = 1;
  const x = cx + s * Aum * Math.sin(theta), y = cy + s * Aum * Math.sin(theta + ph);
  ctx.fillStyle = c.text; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = c.muted; ctx.textAlign = 'center';
  ctx.fillText(Aum < 1e-3 ? 'off · preload holds' : phaseDeg > 0 ? 'pushing →' : '← pushing', cx, H - 6);
  ctx.textAlign = 'left';
}
