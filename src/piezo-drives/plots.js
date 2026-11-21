// 2D plots drawn from the simulation result: the drive waveform over time, and the
// spectrum of the vibration the drive feeds into the frame.
import { P } from './model.js';

const C = {
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgba(255,255,255,0.28)',
  text: '#8b94a3',
  hot: '#ffb35c',
  cool: '#5fd3ff',
  warn: '#ff6b8a',
  rod: '#e8ebf0',
  audible: 'rgba(255,107,138,0.10)',
};
const LEG = [C.hot, C.cool];

function setup(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  return { ctx, size: () => ({ W, H }), resize };
}

export function fmtTime(s) {
  if (s >= 1e-3) return `${+(s * 1e3).toPrecision(3)} ms`;
  return `${+(s * 1e6).toPrecision(3)} µs`;
}
export function fmtHz(f) {
  if (f >= 1e3) return `${+(f / 1e3).toPrecision(3)} kHz`;
  return `${+f.toPrecision(3)} Hz`;
}

// Waveform: two cycles. Top: tangential position of each contact and of the rod (µm).
// Bottom strip: normal force at each contact (N); slipping is drawn in red on the rod trace.
export function createWavePlot(canvas) {
  const S = setup(canvas);
  return {
    resize: S.resize,
    draw(res, u) {
      const { ctx } = S;
      const { W, H } = S.size();
      ctx.clearRect(0, 0, W, H);
      if (!res) return;
      const N = P.STEPS;
      const cycles = 2;
      const L = 30;
      const R = W - 8;
      const top = 8;
      const midB = H * 0.68;
      const nTop = midB + 8;
      const nBot = H - 16;
      const T = 1 / res.params.f;

      // y range (µm): contacts and rod across two cycles, rod starting at 0
      const series = [];
      for (const c of res.contacts) series.push(Array.from(c.x, (z) => z * 1e6));
      const rod = [];
      for (let cyc = 0; cyc < cycles; cyc++) for (let k = 0; k < N; k++) rod.push((res.xr[k] + cyc * res.step) * 1e6 + series[0][0] * 0);
      let ymin = Infinity;
      let ymax = -Infinity;
      for (const s of series) for (const z of s) { ymin = Math.min(ymin, z); ymax = Math.max(ymax, z); }
      for (const z of rod) { ymin = Math.min(ymin, z); ymax = Math.max(ymax, z); }
      if (ymax - ymin < 0.2) { ymin -= 0.1; ymax += 0.1; }
      const pad = (ymax - ymin) * 0.08;
      ymin -= pad; ymax += pad;
      const X = (i) => L + ((R - L) * i) / (N * cycles);
      const Y = (z) => midB - ((midB - top) * (z - ymin)) / (ymax - ymin);

      // grid
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.text;
      const stepUm = niceStep((ymax - ymin) / 4);
      for (let z = Math.ceil(ymin / stepUm) * stepUm; z <= ymax; z += stepUm) {
        ctx.beginPath(); ctx.moveTo(L, Y(z)); ctx.lineTo(R, Y(z)); ctx.stroke();
        ctx.fillText(`${+z.toFixed(2)}`, 2, Y(z) + 3);
      }
      for (let cyc = 0; cyc <= cycles; cyc++) {
        ctx.beginPath(); ctx.moveTo(X(cyc * N), top); ctx.lineTo(X(cyc * N), nBot); ctx.stroke();
      }
      ctx.fillText('µm', 2, top + 8);

      // contacts
      res.contacts.forEach((c, i) => {
        ctx.strokeStyle = LEG[i];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let j = 0; j < N * cycles; j++) {
          const z = series[i][j % N];
          if (j === 0) ctx.moveTo(X(j), Y(z)); else ctx.lineTo(X(j), Y(z));
        }
        ctx.stroke();
      });
      // rod, red where it slips against the drive (friction power > small)
      const pmax = Math.max(1e-12, ...res.slipPow);
      ctx.lineWidth = 2;
      for (let j = 1; j < N * cycles; j++) {
        const slip = res.slipPow[j % N] / pmax > 0.05;
        ctx.strokeStyle = slip ? C.warn : C.rod;
        ctx.beginPath(); ctx.moveTo(X(j - 1), Y(rod[j - 1])); ctx.lineTo(X(j), Y(rod[j])); ctx.stroke();
      }

      // normal force strip
      let nmax = 0;
      for (const c of res.contacts) for (const z of c.N) nmax = Math.max(nmax, z);
      nmax = Math.max(nmax, 1);
      ctx.fillStyle = C.text;
      ctx.fillText('N', 2, nTop + 8);
      res.contacts.forEach((c, i) => {
        ctx.fillStyle = LEG[i] + '55';
        ctx.strokeStyle = LEG[i];
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(0), nBot);
        for (let j = 0; j < N * cycles; j++) ctx.lineTo(X(j), nBot - ((nBot - nTop) * c.N[j % N]) / nmax);
        ctx.lineTo(X(N * cycles - 1), nBot);
        ctx.closePath();
        ctx.fill();
      });
      ctx.fillStyle = C.text;
      ctx.fillText(`0`, L - 10, nBot + 3);
      ctx.fillText(`${nmax.toFixed(0)}`, L - 14, nTop + 4);

      // time axis
      ctx.fillText('0', L, H - 3);
      ctx.fillText(fmtTime(T), X(N) - 14, H - 3);
      ctx.fillText(fmtTime(2 * T), R - 40, H - 3);

      // cursor (current point in the cycle; shown in the first period)
      const cx = X(u * N);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, nBot); ctx.stroke();
      ctx.setLineDash([]);
    },
  };
}

// Spectrum: frame vibration (dB re 1 pm) at each harmonic of the drive, on a log
// frequency axis from 10 Hz to 1 MHz. Shaded: human hearing. Ticks: frame modes,
// drive-element resonance, CrossFixx mode resonance.
export function createSpectrumPlot(canvas) {
  const S = setup(canvas);
  const F_LO = 10;
  const F_HI = 1e6;
  const DB_LO = -40;
  const DB_HI = 100;
  return {
    resize: S.resize,
    draw(res) {
      const { ctx } = S;
      const { W, H } = S.size();
      ctx.clearRect(0, 0, W, H);
      const L = 30;
      const R = W - 8;
      const top = 14;
      const bot = H - 16;
      const X = (f) => L + ((R - L) * Math.log10(f / F_LO)) / Math.log10(F_HI / F_LO);
      const Y = (db) => bot - ((bot - top) * (Math.max(DB_LO, Math.min(DB_HI, db)) - DB_LO)) / (DB_HI - DB_LO);
      ctx.font = '10px "IBM Plex Mono", monospace';

      // audible band
      ctx.fillStyle = C.audible;
      ctx.fillRect(X(P.AUDIBLE[0]), top, X(P.AUDIBLE[1]) - X(P.AUDIBLE[0]), bot - top);
      ctx.fillStyle = C.warn;
      ctx.fillText('audible', X(P.AUDIBLE[0]) + 3, top - 3);

      // grid
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.text;
      for (let d = 1; d <= 6; d++) {
        const f = 10 ** d;
        ctx.beginPath(); ctx.moveTo(X(f), top); ctx.lineTo(X(f), bot); ctx.stroke();
        ctx.fillText(fmtHz(f).replace(' ', ''), Math.min(X(f) - 12, R - 34), H - 3);
      }
      for (let db = DB_LO; db <= DB_HI; db += 40) {
        ctx.beginPath(); ctx.moveTo(L, Y(db)); ctx.lineTo(R, Y(db)); ctx.stroke();
        ctx.fillText(`${db}`, 2, Y(db) + 3);
      }

      // resonance markers
      const mark = (f, color, text, row) => {
        ctx.strokeStyle = color;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(X(f), top); ctx.lineTo(X(f), bot); ctx.stroke();
        ctx.setLineDash([]);
        if (text) { ctx.fillStyle = color; ctx.fillText(text, X(f) + 3, top + 10 + row * 11); }
      };
      P.FRAME_MODES.forEach((m, i) => mark(m.f, 'rgba(232,235,240,0.35)', i === 0 ? 'frame modes' : '', 0));
      mark(P.ACT_F0, 'rgba(232,235,240,0.35)', 'stack', 1);
      mark(P.US_F0, 'rgba(95,211,255,0.6)', 'CrossFixx', 0);
      if (!res) return;

      // harmonics
      for (const h of res.spectrum) {
        if (h.f < F_LO || h.f > F_HI || h.X <= 0) continue;
        const db = 20 * Math.log10(h.X / 1e-12);
        if (db < DB_LO) continue;
        ctx.strokeStyle = h.audible ? C.warn : C.cool;
        ctx.lineWidth = h.f === res.params.f ? 2.5 : 1.5;
        ctx.beginPath(); ctx.moveTo(X(h.f), bot); ctx.lineTo(X(h.f), Y(db)); ctx.stroke();
      }
      ctx.lineWidth = 1;
      // drive frequency
      ctx.fillStyle = C.rod;
      ctx.beginPath();
      ctx.moveTo(X(res.params.f), bot + 1); ctx.lineTo(X(res.params.f) - 4, bot + 7); ctx.lineTo(X(res.params.f) + 4, bot + 7);
      ctx.fill();
    },
  };
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
