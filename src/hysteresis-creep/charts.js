// Canvas charts: the displacement–voltage loop and the drift after the last voltage change.
import { P } from './model.js';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = () => ({
  text: css('--text'), muted: css('--muted'), grid: 'rgba(255,255,255,0.07)',
  hot: css('--hot'), cool: css('--cool'), warn: css('--warn'),
  mono: '10.5px "IBM Plex Mono", ui-monospace, monospace',
});

function fit(canvas) {
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

function scales(W, H, x0, x1, y0, y1, pad) {
  return {
    X: (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r),
    Y: (v) => H - pad.b - ((v - y0) / (y1 - y0)) * (H - pad.t - pad.b),
  };
}

// trace: [{ v, x }] in path order. now: { v, x, guess }. closed: closed-loop mode.
export function drawLoop(canvas, trace, now, closed) {
  const { ctx, W, H } = fit(canvas);
  const c = C();
  const pad = { l: 44, r: 12, t: 10, b: 30 };
  const yMax = P.STROKE * 1.12;
  const { X, Y } = scales(W, H, 0, P.V_MAX, 0, yMax, pad);

  ctx.font = c.mono; ctx.lineWidth = 1;
  for (let v = 0; v <= P.V_MAX; v += 20) {
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X(v), pad.t); ctx.lineTo(X(v), H - pad.b); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.fillText(`${v}`, X(v), H - pad.b + 14);
  }
  for (let u = 0; u <= yMax; u += 5) {
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(pad.l, Y(u)); ctx.lineTo(W - pad.r, Y(u)); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(`${u}`, pad.l - 6, Y(u) + 3.5);
  }
  ctx.textAlign = 'center'; ctx.fillText('voltage, V', (pad.l + W - pad.r) / 2, H - 4);
  ctx.save(); ctx.translate(11, (pad.t + H - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('position, µm', 0, 0); ctx.restore();

  // Straight-line calibration
  ctx.setLineDash([4, 4]); ctx.strokeStyle = c.cool; ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(P.V_MAX), Y(P.STROKE)); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // Trace, older parts fainter
  const n = trace.length;
  ctx.lineWidth = 1.8; ctx.strokeStyle = c.hot;
  const chunk = 60;
  for (let s = 0; s < n - 1; s += chunk) {
    ctx.globalAlpha = 0.18 + 0.82 * ((s + chunk) / n) ** 2;
    ctx.beginPath();
    for (let i = s; i <= Math.min(n - 1, s + chunk); i++) {
      const p = trace[i];
      i === s ? ctx.moveTo(X(p.v), Y(p.x)) : ctx.lineTo(X(p.v), Y(p.x));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Error bar at the current voltage
  if (!closed) {
    ctx.strokeStyle = c.warn; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(now.v), Y(now.guess)); ctx.lineTo(X(now.v), Y(now.x)); ctx.stroke();
  } else {
    // Closed loop: the position is the target; the hysteresis now shows up in the voltage
    ctx.strokeStyle = c.warn; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(now.x * P.V_MAX / P.STROKE), Y(now.x)); ctx.lineTo(X(now.v), Y(now.x)); ctx.stroke();
  }
  ctx.fillStyle = c.hot; ctx.beginPath(); ctx.arc(X(now.v), Y(now.x), 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.cool; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(now.v), Y(now.guess), 3.5, 0, Math.PI * 2); ctx.stroke();
}

// Drift since the last voltage (or target) change, on a log time axis from 0.1 s to 3 h.
// samples: [{ age, x, v }] recorded since the change. predict(age) → x if the voltage is held
// from now (open loop only). ref: position just before the change.
export const T_MIN = 0.1, T_MAX = 1e4;
export function drawCreep(canvas, { samples, predict, ref, step, age, closed }) {
  const { ctx, W, H } = fit(canvas);
  const c = C();
  const pad = { l: 52, r: closed ? 56 : 24, t: 10, b: 30 };
  const lx0 = Math.log10(T_MIN), lx1 = Math.log10(T_MAX);
  const LX = (t) => Math.log10(Math.min(T_MAX, Math.max(T_MIN, t)));

  // y range: around the step's end value, wide enough for ~5 decades of creep
  const end = ref + step;
  const span = Math.max(0.15, Math.abs(step) * P.GAMMA * 8, ...samples.map((s) => Math.abs(s.x - end) * 1.3));
  const y0 = end - (step >= 0 ? span * 0.25 : span * 0.75), y1 = y0 + span;
  const { X, Y } = scales(W, H, lx0, lx1, y0, y1, pad);

  ctx.font = c.mono; ctx.lineWidth = 1;
  const ticks = [[0.1, '0.1 s'], [1, '1 s'], [10, '10 s'], [100, '100 s'], [1000, '17 min'], [10000, '2.8 h']];
  for (const [t, s] of ticks) {
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X(LX(t)), pad.t); ctx.lineTo(X(LX(t)), H - pad.b); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'center'; ctx.fillText(s, X(LX(t)), H - pad.b + 14);
  }
  const dy = span / 4;
  const p10 = 10 ** Math.floor(Math.log10(dy)); const ys = Math.ceil(dy / p10) * p10;
  for (let u = Math.ceil(y0 / ys) * ys; u <= y1; u += ys) {
    ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(pad.l, Y(u)); ctx.lineTo(W - pad.r, Y(u)); ctx.stroke();
    ctx.fillStyle = c.muted; ctx.textAlign = 'right'; ctx.fillText(u.toFixed(ys < 0.1 ? 2 : 1), pad.l - 6, Y(u) + 3.5);
  }
  ctx.textAlign = 'center'; ctx.fillText('time since the last change (log scale)', (pad.l + W - pad.r) / 2, H - 4);
  ctx.save(); ctx.translate(11, (pad.t + H - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('position, µm', 0, 0); ctx.restore();

  // Value 0.1 s after the change: PI's ΔL reference
  ctx.strokeStyle = c.muted; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(end)); ctx.lineTo(W - pad.r, Y(end)); ctx.stroke(); ctx.setLineDash([]);

  // Prediction if held
  if (predict) {
    ctx.strokeStyle = c.hot; ctx.globalAlpha = 0.45; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const l = lx0 + ((lx1 - lx0) * i) / 120; const t = 10 ** l;
      if (t < age) continue;
      const y = predict(t);
      ctx.lineTo(X(l), Y(y));
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Recorded position
  ctx.strokeStyle = c.hot; ctx.lineWidth = 2; ctx.beginPath();
  let started = false;
  for (const s of samples) { if (s.age < T_MIN) continue; started ? ctx.lineTo(X(LX(s.age)), Y(s.x)) : ctx.moveTo(X(LX(s.age)), Y(s.x)); started = true; }
  ctx.stroke();

  // Closed loop: the controller's voltage on a right-hand axis
  if (closed && samples.length) {
    const vs = samples.filter((s) => s.age >= T_MIN).map((s) => s.v);
    if (vs.length) {
      const lo = Math.min(...vs), hi = Math.max(...vs);
      const vSpan = Math.max(0.4, (hi - lo) * 1.25);
      const vy0 = (lo + hi) / 2 - vSpan / 2, vy1 = vy0 + vSpan;
      const VY = (v) => H - pad.b - ((v - vy0) / (vy1 - vy0)) * (H - pad.t - pad.b);
      ctx.strokeStyle = c.cool; ctx.lineWidth = 1.6; ctx.beginPath(); started = false;
      for (const s of samples) { if (s.age < T_MIN) continue; started ? ctx.lineTo(X(LX(s.age)), VY(s.v)) : ctx.moveTo(X(LX(s.age)), VY(s.v)); started = true; }
      ctx.stroke();
      ctx.fillStyle = c.cool; ctx.textAlign = 'left';
      for (let k = 0; k <= 3; k++) { const v = vy0 + (vSpan * k) / 3; ctx.fillText(v.toFixed(vSpan < 2 ? 2 : 1), W - pad.r + 4, VY(v) + 3.5); }
      ctx.save(); ctx.translate(W - 6, (pad.t + H - pad.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('voltage, V', 0, 0); ctx.restore();
    }
  }

  // Now
  if (age >= T_MIN) {
    const last = samples[samples.length - 1];
    if (last) { ctx.fillStyle = c.hot; ctx.beginPath(); ctx.arc(X(LX(age)), Y(last.x), 4, 0, Math.PI * 2); ctx.fill(); }
  }
  if (age < 0.5) {
    ctx.fillStyle = c.muted; ctx.textAlign = 'center';
    ctx.fillText('hold the voltage to watch it drift', (pad.l + W - pad.r) / 2, pad.t + 16);
  }
}
