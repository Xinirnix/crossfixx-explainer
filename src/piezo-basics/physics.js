// Piezo effect basics: poling and the converse effect, d33 vs d31. No DOM, runs in Node.
//
// Tags: [CTS] from CTS Corporation, "Piezoelectricity Basics"
//       (https://www.ctscorp.com/Resources/Blog/Piezo-Basics)
//       [physics] follows from the definitions
//       [assumed] typical value chosen for this page; CTS gives no number. Replace with a datasheet value.
//
// Axes [CTS]: 3 is the poling direction (up, +y in the scene), 1 and 2 are perpendicular and equivalent.
// d_ij [CTS]: first index = field direction, second = strain direction, unit m/V.
//   S3 = d33 · E3   strain along the field (thickness)            [physics]
//   S1 = d31 · E3   strain across the field (width and depth)      [physics]
// For a plate of thickness t and width L with voltage V across t (E3 = V / t):
//   Δt = S3 · t = d33 · V            does not depend on t           [physics]
//   ΔL = S1 · L = d31 · V · L / t    grows with the aspect ratio    [physics]

export const D33 = 400e-12;   // m/V  [assumed] soft PZT, order of magnitude
export const D31 = -180e-12;  // m/V  [assumed] soft PZT; negative = contracts sideways when it expands along 3
export const T_MM = 1;        // plate thickness, mm [assumed]
export const L_DEFAULT = 5;   // plate width (and depth), mm [assumed]

export const E_MAX_REC = 3;   // kV/mm, recommended max field [CTS]
export const E_MAX_OK = 4;    // kV/mm, "normally acceptable, testing recommended" [CTS]
export const E_C = 1.0;       // kV/mm, coercive field [assumed] (CTS: "low" for soft PZT, no number)
export const E_C_SPREAD = 0.5; // grains switch between 0.75·E_C and 1.25·E_C [assumed]
export const STACK_LAYERS = 100; // layers in the stack readout [assumed]
export const LAYER_MM = 0.1;     // layer thickness in that stack [assumed]

// A stack of STACK_LAYERS layers of LAYER_MM, wired in parallel, at the same field E (kV/mm):
// each layer needs only E·LAYER_MM, and the d33 strokes add up. [physics]
export function stack(E, p) {
  return { V: E * 1000 * LAYER_MM, dx: STACK_LAYERS * D33 * E * 1e6 * LAYER_MM * 1e-3 * p * 1e6 }; // V, µm
}

export const V_MIN = -1500;   // slider range, V across T_MM
export const V_MAX = 4000;

export const SHOW = 150;      // deformation drawn ×150 in the 3D view

export const fieldKVmm = (V) => V / 1000 / T_MM;          // kV/mm
const toVm = (kVmm) => kVmm * 1e6;                         // kV/mm → V/m

// Strains for field E (kV/mm) and net polarization p (−1 … +1, 1 = fully poled up).
// Linear model: the d coefficients scale with the net polarization. CTS lists 13–20 % hysteresis
// and creep for real material; this page leaves both out (see the closed-loop page for why that matters).
export function strains(E, p) {
  return { S3: D33 * toVm(E) * p, S1: D31 * toVm(E) * p };
}

// Real-size changes in µm for voltage V, polarization p and plate width L (mm).
export function changes(V, p, L) {
  const { S3, S1 } = strains(fieldKVmm(V), p);
  return { S3, S1, dt: S3 * T_MM * 1000, dL: S1 * L * 1000 };
}

// ---------- Domains ----------
// The ceramic is many randomly oriented grains [CTS: polycrystalline]. Below the Curie point each
// grain is tetragonal [CTS], so its polarization can point along any of its 6 cube axes (±a, ±b, ±c).
// Unpoled: a random axis per grain, net ≈ 0 [CTS]. Poling turns each grain to its axis closest to the
// field [physics]; because the grains themselves are not aligned, that is ~83 % of a single crystal.

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform random rotation (Shoemake), returned as its three column axes.
function randomAxes(r) {
  const u1 = r(); const u2 = r() * 2 * Math.PI; const u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1); const b = Math.sqrt(u1);
  const [x, y, z, w] = [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
  const col = (vx, vy, vz) => { // rotate a vector by quaternion (x,y,z,w)
    const ix = w * vx + y * vz - z * vy; const iy = w * vy + z * vx - x * vz;
    const iz = w * vz + x * vy - y * vx; const iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  const ax = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];
  return [...ax, ...ax.map((v) => v.map((c) => -c))]; // 6 allowed directions
}

export function createDomains(n, seed = 7) {
  const r = rng(seed);
  const grains = [];
  for (let i = 0; i < n; i++) {
    const axes = randomAxes(r);
    let up = 0; let down = 0;
    axes.forEach((v, k) => { if (v[1] > axes[up][1]) up = k; if (v[1] < axes[down][1]) down = k; });
    grains.push({ axes, up, down, ec: E_C * (1 - E_C_SPREAD / 2 + E_C_SPREAD * r()), dir: Math.floor(r() * 6), rand: r() });
  }
  // Net polarization of a fully poled sample, used to normalise p to 1.
  const poledMean = grains.reduce((s, g) => s + g.axes[g.up][1], 0) / n;
  return { grains, poledMean, r };
}

// Field E (kV/mm) along +3: every grain whose coercive field is exceeded turns to the axis nearest the field.
// Returns how many grains switched.
export function applyField(D, E) {
  let switched = 0;
  for (const g of D.grains) {
    const want = E > g.ec ? g.up : E < -g.ec ? g.down : -1;
    if (want >= 0 && g.dir !== want) { g.dir = want; switched++; }
  }
  return switched;
}

export function pole(D, sign = 1) { for (const g of D.grains) g.dir = sign > 0 ? g.up : g.down; }
export function depole(D) { for (const g of D.grains) g.dir = Math.floor(D.r() * 6); } // heat above Curie, cool without field

export function netPolarization(D) {
  return D.grains.reduce((s, g) => s + g.axes[g.dir][1], 0) / D.grains.length / D.poledMean;
}
