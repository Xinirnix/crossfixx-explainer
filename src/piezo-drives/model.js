// One rod, three ways to drive it with piezo elements.
//
// Everything on this page comes out of one friction model, solved in the time domain:
//
//   m · dv/dt = Σ_i  μ · N_i(t) · sat( (v_i(t) − v) / v_ε )  −  F_load
//
//   v        rod velocity
//   v_i(t)   tangential velocity of contact i (pusher pad, walking leg, or CrossFixx tip)
//   N_i(t)   normal force at contact i (0 when that contact is lifted off)
//   sat()    clamp to ±1: a regularised Coulomb law. |v_i − v| < v_ε  ≈ sticking.
//
// The three drives differ only in what the contacts do:
//
//   stick-slip   one shear pad, constant preload, sawtooth: slow ramp (rod sticks and
//                follows), fast flyback (rod's inertia exceeds μN, it slips and stays).
//   walking      two legs, each tracing a quasi-static loop x = A sin θ, y = A sin(θ + φ),
//                half a cycle apart, so one leg always clamps while the other returns.
//   ultrasonic   one tip on a resonant structure: x = A sin θ, y = A sin(θ + φ) at ~100+ kHz.
//                The tip presses on the push stroke and lifts off on the return.
//
// From the steady-state cycle we get the rod speed, the force fed back into the frame
// (its harmonics shake the frame and make sound), and the friction work (what wears).
//
// Numbers marked "illustrative" are plausible orders of magnitude, not Xeryon data.
// Xeryon's own claims for comparison: ultrasonic motors run "typically around 100 kHz",
// "remaining quiet to the human ear", "up to 1000 mm/s", and stick-slip motors are
// "slow, noisy ... short lifetime ... prone to resonance effects".

import { F0_KHZ, Q as US_Q, tipAmplitudeUm } from '../crossfixx/physics.js';

export const P = {
  ROD_MASS: 0.02,        // kg, rod + carriage (illustrative)
  PRELOAD: 5,            // N, spring preload pressing the rod onto the drive (illustrative)
  MU: 0.3,               // friction coefficient, ceramic on ceramic (illustrative)
  V_EPS: 2e-5,           // m/s, stick band of the regularised friction law
  STROKE_UM: 1.0,        // µm, peak tangential amplitude of stick-slip pad / walking leg at amp = 1
  ACT_F0: 40e3,          // Hz, first resonance of the shear stack / legs (illustrative)
  ACT_Q: 8,
  CONTACT_K: 1.5e7,      // N/m, contact stiffness of tip / leg on the rod (illustrative)
  US_F0: F0_KHZ * 1e3,   // Hz, CrossFixx mode resonance used on the CrossFixx page
  US_Q,
  // Frame (stage body + mount) bending modes: illustrative values for a small stage.
  FRAME_MODES: [
    { f: 850, q: 25, k: 2e7 },
    { f: 2600, q: 30, k: 3e7 },
    { f: 7400, q: 30, k: 6e7 },
  ],
  AUDIBLE: [20, 20000],  // Hz, human hearing
  STEPS: 720,            // time steps per cycle
  HARMONICS: 240,        // harmonics kept for the frame spectrum
};

export const DRIVES = {
  stickslip: { label: 'Stick-slip', f: 1000, amp: 1, shape: 0.9, contacts: 1 },
  walking: { label: 'Walking', f: 1000, amp: 1, shape: 90, contacts: 2 },
  ultrasonic: { label: 'Ultrasonic', f: P.US_F0, amp: 1, shape: 90, contacts: 1 },
};

const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;

// ---------- complex helpers ----------
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cabs = (a) => Math.hypot(a[0], a[1]);

// Second-order (single mode) response, normalised to 1 at DC.
export function mode2(f, f0, q) {
  const r = f / f0;
  const re = 1 - r * r;
  const im = r / q;
  const d = re * re + im * im;
  return [re / d, -im / d];
}

// A-weighting (IEC 61672), as a linear gain. Zero outside human hearing.
export function aWeight(f) {
  if (f < P.AUDIBLE[0] || f > P.AUDIBLE[1]) return 0;
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * 1.2589; // +2.0 dB so that A(1 kHz) = 1
}

// ---------- commanded waveforms (one cycle, u in [0,1)) ----------

// Stick-slip sawtooth: ramp from −1 to +1 over `rise` of the cycle, fly back over the rest.
// rise > 0.5 drives +x, rise < 0.5 drives −x, rise = 0.5 is a symmetric triangle (no net motion).
export function sawtooth(u, rise) {
  return u < rise ? -1 + (2 * u) / rise : 1 - (2 * (u - rise)) / (1 - rise);
}

// Fourier series of a sampled periodic signal: c[n] = [re, im] such that
// s(u) = Σ_n Re( c[n] · e^{i 2π n u} ), n = 1..H (the mean is dropped).
function fourier(samples, H) {
  const M = samples.length;
  const c = [];
  for (let n = 0; n <= H; n++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < M; k++) {
      const a = (TAU * n * k) / M;
      re += samples[k] * Math.cos(a);
      im -= samples[k] * Math.sin(a);
    }
    const s = n === 0 ? 1 / M : 2 / M;
    c.push([re * s, im * s]);
  }
  return c;
}

// Synthesise position and velocity of a filtered waveform at STEPS points.
function synth(c, f, H, gain) {
  const N = P.STEPS;
  const x = new Float64Array(N);
  const v = new Float64Array(N);
  const w = TAU * f;
  for (let n = 1; n < c.length; n++) {
    const g = cmul(c[n], gain(n * f));
    if (cabs(g) < 1e-15) continue;
    for (let k = 0; k < N; k++) {
      const a = (TAU * n * k) / N;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      x[k] += g[0] * cs - g[1] * sn;
      v[k] += -n * w * (g[0] * sn + g[1] * cs);
    }
  }
  return { x, v };
}

const sineCoeffs = (phaseRad) => [[0, 0], [Math.sin(phaseRad), -Math.cos(phaseRad)]]; // sin(θ + φ)

// Contact normal force for a sprung tip/leg whose normal displacement is y(t) (m):
// N = max(0, N0' + k·y), with N0' chosen so the time-average equals the preload share.
function contactForce(y, meanN) {
  const k = P.CONTACT_K;
  const avg = (off) => {
    let s = 0;
    for (let i = 0; i < y.length; i++) s += Math.max(0, off + k * y[i]);
    return s / y.length;
  };
  let lo = meanN - k * 1e-5;
  let hi = meanN + k * 1e-5;
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    if (avg(mid) < meanN) lo = mid; else hi = mid;
  }
  const off = 0.5 * (lo + hi);
  // yTouch: normal position at which the contact just closes (below it, there is a gap)
  return { N: Float64Array.from(y, (yy) => Math.max(0, off + k * yy)), yTouch: -off / k };
}

// ---------- contacts for each drive ----------
// Returns [{ x, v, y, N }] with arrays of length STEPS (SI units).
export function contacts(drive, { f, amp, shape }) {
  const N = P.STEPS;
  const actGain = (fr) => mode2(fr, P.ACT_F0, P.ACT_Q);

  if (drive === 'stickslip') {
    const A = amp * P.STROKE_UM * 1e-6;
    const M = 2048;
    const cmd = Array.from({ length: M }, (_, k) => A * sawtooth(k / M, shape));
    const H = Math.min(200, Math.max(8, Math.floor(400e3 / f)));
    const { x, v } = synth(fourier(cmd, H), f, H, actGain);
    return [{ x, v, y: new Float64Array(N), N: new Float64Array(N).fill(P.PRELOAD), yTouch: 0 }];
  }

  if (drive === 'walking') {
    const A = amp * P.STROKE_UM * 1e-6;
    const out = [];
    for (const leg of [0, 1]) {
      const off = leg * Math.PI;
      const gx = sineCoeffs(off).map((c) => [c[0] * A, c[1] * A]);
      const gy = sineCoeffs(off + shape * DEG).map((c) => [c[0] * A, c[1] * A]);
      const { x, v } = synth(gx, f, 1, actGain);
      const { x: y } = synth(gy, f, 1, actGain);
      out.push({ x, v, y, ...contactForce(y, P.PRELOAD / 2) });
    }
    return out;
  }

  // ultrasonic: both standing-wave modes share one resonance (the CrossFixx model)
  const A = tipAmplitudeUm(amp, f / 1e3) * 1e-6;
  const x = new Float64Array(N);
  const v = new Float64Array(N);
  const y = new Float64Array(N);
  const w = TAU * f;
  for (let k = 0; k < N; k++) {
    const th = (TAU * k) / N;
    x[k] = A * Math.sin(th);
    v[k] = A * w * Math.cos(th);
    y[k] = A * Math.sin(th + shape * DEG);
  }
  return [{ x, v, y, ...contactForce(y, P.PRELOAD) }];
}

// ---------- rod dynamics ----------
function frictionAt(cs, k, vr) {
  let F = 0;
  for (const c of cs) {
    const s = Math.max(-1, Math.min(1, (c.v[k] - vr) / P.V_EPS));
    F += P.MU * c.N[k] * s;
  }
  return F;
}

// Cycle-averaged rod speed (rod much heavier than one cycle's impulse): a good start value.
function averagedSpeed(cs, load) {
  let vmax = 0;
  for (const c of cs) for (let k = 0; k < P.STEPS; k++) vmax = Math.max(vmax, Math.abs(c.v[k]));
  let lo = -vmax - 1e-3;
  let hi = vmax + 1e-3;
  const g = (vr) => {
    let s = 0;
    for (let k = 0; k < P.STEPS; k++) s += frictionAt(cs, k, vr);
    return s / P.STEPS - load;
  };
  for (let it = 0; it < 50; it++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Full simulation. Returns the steady-state cycle and everything derived from it.
export function simulate(drive, params, load = 0) {
  const { f } = params;
  const cs = contacts(drive, params);
  const N = P.STEPS;
  const dt = 1 / f / N;
  const m = P.ROD_MASS;
  const cycles = drive === 'ultrasonic' ? 4 : 10;

  let v = drive === 'stickslip' ? 0 : averagedSpeed(cs, load);
  let x = 0;
  const xr = new Float64Array(N);
  const vr = new Float64Array(N);
  const F = new Float64Array(N);
  const slipPow = new Float64Array(N);
  let x0 = 0;

  for (let cyc = 0; cyc < cycles; cyc++) {
    const last = cyc === cycles - 1;
    if (last) x0 = x;
    for (let k = 0; k < N; k++) {
      // Implicit Euler on the regularised friction law (stable for any v_ε): solve
      // m (v1 − v)/dt = friction(v1) − load  by bisection (left side rises, right side falls).
      let Fmax = Math.abs(load);
      for (const c of cs) Fmax += P.MU * c.N[k];
      let lo = v - (Fmax * dt) / m - 1e-9;
      let hi = v + (Fmax * dt) / m + 1e-9;
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        const gmid = (m * (mid - v)) / dt - frictionAt(cs, k, mid) + load;
        if (gmid < 0) lo = mid; else hi = mid;
      }
      v = 0.5 * (lo + hi);
      x += v * dt;
      if (last) {
        xr[k] = x - x0;
        vr[k] = v;
        F[k] = frictionAt(cs, k, v);
        let p = 0;
        for (const c of cs) {
          const s = Math.max(-1, Math.min(1, (c.v[k] - v) / P.V_EPS));
          p += P.MU * c.N[k] * Math.abs(s) * Math.abs(c.v[k] - v);
        }
        slipPow[k] = p;
      }
    }
  }

  const step = xr[N - 1] + vr[N - 1] * dt; // m per cycle
  const speed = step * f;                   // m/s
  let work = 0;
  for (let k = 0; k < N; k++) work += slipPow[k] * dt; // J per cycle dissipated by sliding

  // Force fed back into the motor body, and from there into the frame: −F (reaction).
  const H = Math.min(P.HARMONICS, Math.floor(N / 2) - 1);
  const Fc = fourier(Array.from(F, (z) => -z), H);
  const spectrum = [];
  let audible2 = 0;
  let disp2 = 0;
  const frameX = new Float64Array(N);
  for (let n = 1; n <= H; n++) {
    const fn = n * f;
    let G = [0, 0];
    for (const md of P.FRAME_MODES) {
      const g = mode2(fn, md.f, md.q);
      G = [G[0] + g[0] / md.k, G[1] + g[1] / md.k];
    }
    const X = cmul(Fc[n], G);           // frame displacement phasor, m
    const Xa = cabs(X);
    const Va = TAU * fn * Xa;            // frame surface velocity amplitude, m/s
    const wA = aWeight(fn);
    audible2 += 0.5 * (Va * wA) ** 2;
    disp2 += 0.5 * Xa * Xa;
    spectrum.push({ f: fn, F: cabs(Fc[n]), X: Xa, V: Va, audible: wA > 0, phase: Math.atan2(X[1], X[0]) });
    for (let k = 0; k < N; k++) {
      const a = (TAU * n * k) / N;
      frameX[k] += X[0] * Math.cos(a) - X[1] * Math.sin(a);
    }
  }
  const audibleDb = audible2 > 0 ? 10 * Math.log10(audible2 / 1e-18) : -Infinity; // dB(A) re 1 nm/s

  return {
    drive, params, load, contacts: cs,
    xr, vr, F, slipPow, frameX,
    step, speed, work,
    workPerMm: Math.abs(step) > 1e-12 ? work / (Math.abs(step) * 1e3) : Infinity, // J per mm of travel
    frictionPower: work * f,             // W turned into heat (and wear) at the contact
    frameRmsNm: Math.sqrt(disp2) * 1e9,
    audibleDb,
    spectrum,
  };
}

// Holding: with the drive off every contact keeps its preload, so the rod stays put
// until the load exceeds μ·N. All three are self-locking in this sense.
export const holdingForce = () => P.MU * P.PRELOAD;
