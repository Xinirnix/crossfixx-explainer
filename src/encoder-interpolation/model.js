// Optical encoder interpolation model. No DOM, so it runs in Node too:
//   node -e "import('./src/encoder-interpolation/model.js').then(m => console.log(m.analyse({ offX: 0.01 })))"
//
// Every value is tagged:
//   [SmarAct]   from smaract.com, "Operating principles of optical encoders" (sin/cos quadrature,
//               Lissajous circle, one turn = one scale period, 20 µm METIRIO pitch, x = φ/2π · 20 µm)
//   [Xeryon]    from Xeryon's Controller & Connection Manual (encoder resolutions per count)
//   [textbook]  standard interpolation relations (atan2 read-out, first-order cyclic error, Heydemann)
//   [assumed]   an example value chosen for the page; replace it with a datasheet value

// Scale periods offered on the page.
export const PERIODS_UM = [
  { v: 20, label: '20 µm · SmarAct METIRIO [SmarAct]' },
  { v: 4, label: '4 µm · fine grating [assumed]' },
  { v: 40, label: '40 µm · coarse grating [assumed]' },
];

// Interpolation factor N = counts per signal period. 4 is plain quadrature edge counting
// (one count per zero crossing of sin or cos). The rest are typical interpolator settings [assumed].
export const FACTORS = [4, 64, 256, 1024, 4096, 16384];

// Resolutions Xeryon lists for its encoders, nm per count [Xeryon]. Used in the notes and the closed-loop link.
export const XERYON_RES_NM = [1250, 312, 78, 5, 1];

// Signal errors are relative to the nominal signal amplitude (1 = 100 %).
export const DEFAULTS = {
  periodUm: 20,   // [SmarAct]
  N: 4096,        // [assumed] → 20 µm / 4096 ≈ 4.9 nm per count
  amp: 1,         // common signal amplitude (dirty scale, head too far away) [assumed range]
  offX: 0,        // DC offset on cos
  offY: 0,        // DC offset on sin
  gain: 0,        // amplitude mismatch: cos gets 1 + g/2, sin gets 1 − g/2
  phaseDeg: 0,    // quadrature error: sin leads by 90° + δ instead of 90°
  noise: 0,       // rms noise on each channel
  correct: false, // Heydemann-style correction with the fitted ellipse
};

export const PRESETS = [
  { id: 'ideal', label: 'Ideal', params: {} },
  { id: 'offset', label: 'Offset 1 %', params: { offX: 0.01 }, note: 'Circle shifted: error repeats once per period.' },
  { id: 'gain', label: 'Gain 2 %', params: { gain: 0.02 }, note: 'Circle squashed into an ellipse: error repeats twice per period.' },
  { id: 'phase', label: 'Phase 2°', params: { phaseDeg: 2 }, note: 'Ellipse tilted 45°: error repeats twice per period.' },
  { id: 'head', label: 'Misaligned head', params: { offX: 0.02, offY: -0.012, gain: 0.04, phaseDeg: 3, amp: 0.8 }, note: 'All three at once [assumed values].' },
  { id: 'noisy', label: 'Noisy signal', params: { noise: 0.004 }, note: 'Noise jitters the angle; more counts stop adding information.' },
];

const TAU = 2 * Math.PI;

// Gaussian noise (Box–Muller), seeded so the error plot doesn't flicker between redraws.
function rng(seed) {
  let s = seed >>> 0 || 1;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(TAU * u());
}

// The two photodiode signals at scale phase θ = 2π·x/P [SmarAct: sin and cos, 90° apart].
export function signals(theta, p, gauss = null) {
  const gx = p.amp * (1 + p.gain / 2);
  const gy = p.amp * (1 - p.gain / 2);
  const d = (p.phaseDeg * Math.PI) / 180;
  const nx = gauss ? p.noise * gauss() : 0;
  const ny = gauss ? p.noise * gauss() : 0;
  return { c: gx * Math.cos(theta) + p.offX + nx, s: gy * Math.sin(theta + d) + p.offY + ny };
}

// Read-out angle. Without correction: atan2(s, c), which assumes a perfect circle centred on 0 [textbook].
// With correction: undo offset, gain and phase from the fitted ellipse (Heydemann 1981) [textbook].
// The page uses the true parameters as the "fit"; a real interpolator estimates them from the
// recorded Lissajous figure, so the correction is only as good as that fit.
export function readAngle({ c, s }, p) {
  if (!p.correct) return Math.atan2(s, c);
  const gx = p.amp * (1 + p.gain / 2);
  const gy = p.amp * (1 - p.gain / 2);
  const d = (p.phaseDeg * Math.PI) / 180;
  const c0 = (c - p.offX) / gx;
  const s0 = (s - p.offY) / gy; // = sin θ cos δ + cos θ sin δ
  return Math.atan2((s0 - c0 * Math.sin(d)) / Math.cos(d), c0);
}

const wrap = (a) => a - TAU * Math.round(a / TAU); // to (−π, π]

// Measured position for a true position x (µm). The period index comes from counting full turns
// of the Lissajous point; the fraction from the angle; the count from the interpolator.
export function measure(xUm, p, gauss = null) {
  const P = p.periodUm;
  const theta = (TAU * xUm) / P;
  const sig = signals(theta, p, gauss);
  const phi = readAngle(sig, p);
  const errUm = (wrap(phi - theta) / TAU) * P; // interpolation error before counting
  const lsb = P / p.N;
  const xCont = xUm + errUm; // what an infinitely fine interpolator would report
  const count = Math.floor(xCont / lsb + 1e-9);
  return { theta, phi: ((phi % TAU) + TAU) % TAU, ...sig, errUm, count, xMeas: count * lsb, lsb };
}

// One period of the cyclic error, its harmonics, and the first-order predictions.
export function analyse(changes = {}, samples = 720) {
  const p = { ...DEFAULTS, ...changes };
  const P = p.periodUm;
  const gauss = p.noise > 0 ? rng(12345) : null;
  const xs = [], err = [], quant = [], noisy = [];
  let a1c = 0, a1s = 0, a2c = 0, a2s = 0, mean = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < samples; i++) {
    const x = (i / samples) * P;
    const m = measure(x, p); // the cyclic part, noise-free
    const e = m.errUm * 1000; // nm
    if (gauss) noisy.push(measure(x, p, gauss).errUm * 1000);
    xs.push(x); err.push(e); quant.push((m.xMeas - x) * 1000);
    const th = (TAU * i) / samples;
    a1c += e * Math.cos(th); a1s += e * Math.sin(th);
    a2c += e * Math.cos(2 * th); a2s += e * Math.sin(2 * th);
    mean += e; min = Math.min(min, e); max = Math.max(max, e);
  }
  const k = 2 / samples;
  const lsbNm = (P / p.N) * 1000;
  const r = P * 1000 / TAU; // nm per radian of angle error
  const d = (p.phaseDeg * Math.PI) / 180;
  const off = Math.hypot(p.offX, p.offY) / p.amp;
  return {
    p, xs, err, quant, noisy,
    lsbNm,
    meanNm: mean / samples,
    ppNm: max - min,
    h1Nm: Math.hypot(a1c, a1s) * k, // once-per-period amplitude
    h2Nm: Math.hypot(a2c, a2s) * k, // twice-per-period amplitude
    // First-order predictions [textbook], uncorrected:
    //   offset o (relative to amplitude) → angle error ≈ o·sin(θ − θo): amplitude P/2π · o
    //   gain mismatch g                  → ≈ −(g/2)·sin 2θ:             amplitude P/2π · g/2
    //   phase error δ                     → ≈ (δ/2)(1 + cos 2θ):        amplitude P/2π · δ/2, plus a constant shift
    pred1Nm: p.correct ? 0 : r * off,
    pred2Nm: p.correct ? 0 : r * Math.hypot(p.gain / 2, d / 2),
    // Noise σ on each channel → angle jitter ≈ σ/amp rad rms [textbook]
    jitterNm: (r * p.noise) / p.amp,
  };
}
