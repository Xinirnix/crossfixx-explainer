// Hysteresis and creep of an open-loop piezo stack. No DOM, runs in Node:
//   node -e "import('./src/hysteresis-creep/model.js').then(m => console.log(m.loopWidth()))"
//
// Every constant is tagged:
//   [PI]      from PI's tutorial "Displacement of Piezo Actuators"
//             https://www.pi-usa.us/en/products/piezo-flexure-nanopositioners/piezo-motion-control-tutorial/tutorial-4-20
//   [assumed] an example value chosen for this page; replace it with a datasheet value
//   [model]   a modelling choice of ours, not something PI states
//
// Hysteresis [model]: a Prandtl–Ishlinskii model, x = a·V + Σ wᵢ·playᵢ(V). Each play operator
// is a backlash of half-width rᵢ: its output only follows V once V has pushed it to the edge of
// its gap. That gives a rate-independent loop whose width grows with the peak voltage, and
// smaller loops nest inside bigger ones, as in PI's figure "Hysteresis curves of an open loop
// piezo actuator for various peak voltages". The weights are scaled so the full 0–Vmax loop is
// HYST of the stroke wide. Each play starts at its lower edge (sᵢ = rᵢ, as if just lowered to 0 V)
// and we subtract that, so every loop starts and ends at 0 V, 0 µm like PI's curves.
//
// Creep [PI]: after a voltage change, ΔL(t) = ΔL₀.₁ · (1 + γ · lg(t / 0.1 s)), where ΔL₀.₁ is the
// displacement 0.1 s after the change. We apply that to every change and add them up
// (superposition [model]), so a slow drag creeps too, and a step back down creeps back.

export const P = {
  V_MAX: 100,      // V        [assumed] unipolar drive range 0–100 V
  STROKE: 30,      // µm       [assumed] nominal displacement at V_MAX (PI's example actuator is 50 µm)
  HYST: 0.12,      // fraction [PI] "typically on the order of 10 to 15 % of the commanded motion"
  GAMMA: 0.015,    //          [PI] creep factor "on the order of 0.01 to 0.02"
  T0: 0.1,         // s        [PI] ΔL is measured 0.1 s after the voltage change
  N_PLAY: 24,      //          [model] number of play operators
  STACK_MM: 36,    // mm       [assumed] stack length, for the 3D view only
};

// Play-operator half-widths, spread evenly over half the range [model].
function radii(n, vmax) {
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * (vmax / 2));
}

const play = (r, v, prev) => Math.min(v + r, Math.max(v - r, prev));

// Linear part a and play weights w, scaled so that x(V_MAX) = STROKE after a rise from 0 and the
// widest gap of the full loop is `hyst` × STROKE. The loop width is linear in the play weight k, so
// one trial run fixes it.
export function makeParams(hyst = P.HYST, p = P) {
  const r = radii(p.N_PLAY, p.V_MAX);
  // Rise 0 → Vmax with unit weights, then fall back; measure the gap and the top value.
  const sum = (s) => s.reduce((q, z, j) => q + z - r[j], 0);
  const trial = (a, k) => {
    let s = [...r], up = [], dn = [];
    const N = 200;
    for (let i = 0; i <= N; i++) { const v = (i / N) * p.V_MAX; s = s.map((si, j) => play(r[j], v, si)); up.push(a * v + k * sum(s)); }
    for (let i = N; i >= 0; i--) { const v = (i / N) * p.V_MAX; s = s.map((si, j) => play(r[j], v, si)); dn.push(a * v + k * sum(s)); }
    dn.reverse();
    const gap = Math.max(...up.map((u, i) => dn[i] - u));
    return { top: up[N], gap };
  };
  // Hysteretic part alone (a = 0, k = 1), and linear part alone (top = Vmax · a).
  const h = trial(0, 1);
  // Want: gap = hyst · STROKE, top = STROKE. gap comes only from k: k = hyst·STROKE / h.gap.
  const k = h.gap > 0 ? (hyst * p.STROKE) / h.gap : 0;
  const a = (p.STROKE - k * h.top) / p.V_MAX;
  return { r, w: k, a: Math.max(a, 0), hyst };
}

// Measured width of the full 0 → Vmax → 0 loop, as a fraction of the stroke (sanity check).
export function loopWidth(hyst = P.HYST) {
  const prm = makeParams(hyst);
  const st = new Actuator(prm);
  const up = [], dn = [];
  for (let i = 0; i <= 100; i++) up.push(st.setVoltage(i, 0, false));
  for (let i = 100; i >= 0; i--) dn.push(st.setVoltage(i, 0, false));
  dn.reverse();
  return Math.max(...up.map((u, i) => dn[i] - u)) / P.STROKE;
}

// One actuator: hysteresis state plus the list of past changes that are still creeping.
export class Actuator {
  constructor(prm = makeParams(), gamma = P.GAMMA) {
    this.prm = prm;
    this.gamma = gamma;
    this.s = [...prm.r];
    this.v = 0;
    this.xh = 0;          // hysteresis output, µm (what you get 0.1 s after a change)
    this.events = [];     // { t, dx } changes of xh, merged into 20 ms buckets
  }

  hystAt(v) { return this.prm.a * v + this.prm.w * this.s.reduce((q, z, j) => q + z - this.prm.r[j], 0); }

  // Move the voltage to v at time t (s). Returns the hysteresis output (no creep).
  setVoltage(v, t, creep = true) {
    v = Math.min(P.V_MAX, Math.max(0, v));
    this.s = this.s.map((si, j) => play(this.prm.r[j], v, si));
    this.v = v;
    const x = this.hystAt(v);
    const dx = x - this.xh;
    this.xh = x;
    if (creep && dx !== 0) {
      const last = this.events[this.events.length - 1];
      if (last && t - last.t < 0.02) last.dx += dx; else this.events.push({ t, dx });
      if (this.events.length > 4000) this.compact(t);
    }
    return x;
  }

  // Creep part at time t: Σ γ·dx·lg((t − tᵢ)/T0), counted from 0.1 s after each change [PI].
  creepAt(t) {
    let c = 0;
    for (const e of this.events) {
      const age = t - e.t;
      if (age > P.T0) c += this.gamma * e.dx * Math.log10(age / P.T0);
    }
    return c;
  }

  position(t) { return this.xh + this.creepAt(t); }

  // Merge old changes. Two changes at nearly the same age creep almost identically, so events
  // older than 10 s are merged into ones spaced at 5 % of their age (keeps the list short).
  compact(t) {
    const out = [];
    for (const e of this.events) {
      const prev = out[out.length - 1];
      const age = t - e.t;
      if (prev && age > 10 && (prev.t - e.t) > -0.05 * age) { prev.dx += e.dx; } else out.push({ ...e });
    }
    this.events = out;
  }

  // What an open-loop user expects from a straight-line calibration: STROKE · V / V_MAX.
  static linearGuess(v) { return (P.STROKE * v) / P.V_MAX; }

  reset() { this.s = [...this.prm.r]; this.v = 0; this.xh = 0; this.events = []; }
}

// Creep after one step of size dx (µm), for the log-time chart: displacement relative to the
// value just before the step. t in seconds; before T0 the step is still settling (drawn as rising).
export function stepResponse(dx, t, gamma = P.GAMMA) {
  if (t <= 0) return 0;
  if (t < P.T0) return dx * (t / P.T0);
  return dx * (1 + gamma * Math.log10(t / P.T0));
}

// Closed loop [model]: a sensor reads the true position and an integrator moves the voltage until
// it matches the target. Several small corrections per frame; the slope bound keeps it stable.
export function closedLoopStep(act, target, t, iters = 30) {
  const slope = act.prm.a + act.prm.w * act.prm.r.length; // steepest possible dx/dV
  let v = act.v;
  for (let i = 0; i < iters; i++) {
    const e = target - act.position(t);
    if (Math.abs(e) < 1e-4) break;
    v = Math.min(P.V_MAX, Math.max(0, v + (0.8 * e) / slope));
    act.setVoltage(v, t);
  }
  return act.v;
}
