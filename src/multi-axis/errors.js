// Error-motion model for a serial stack of stages (XY, XYZ, XYθ).
//
// Every stage carries everything above it. To first order, a stage that is off by a small
// rotation ω (rad, a vector) about its pivot p, plus a small translation t, moves the tip by
//
//     δ = t + ω × (tip − p)
//
// and the contributions of all stages simply add. The cross product is the lever-arm law:
// an angle of ε radians at a distance L moves the tip by L·ε. With L in mm and ε in µrad,
// L·ε·1e-3 is the error in µm (100 mm × 50 µrad = 5 µm). When the angle is measured or
// driven along an axis that is offset from the point you care about, this is Abbe error.
//
// Units in this file: positions in mm, angles in µrad, translations and errors in µm.
// Three.js convention: y is up. Linear stages: X moves along x, Y along z, Z along y.

// Figures quoted from Xeryon catalog pages (XRT-U-40, XRT-U-30, XRT-A).
export const PRESETS = {
  'XRT-U-40 -PB': { radial: 1.0, axial: 0.5, wobble: 50 },   // radial < 1 µm, axial < 0.5 µm, tilt < 50 µrad
  'XRT-U-40 -SB': { radial: 5.0, axial: 3.0, wobble: 50 },   // radial < 5 µm, axial < 3 µm (tilt only quoted for -PB)
  'XRT-A': { radial: 0.5, axial: 1.0, wobble: 100 },         // radial down to 500 nm, axial < 1 µm, tilt < 100 µrad
};

// Display exaggeration: angles and error translations are both multiplied by this,
// so the picture stays geometrically consistent (ω×r scales by the same factor).
export const EXAGGERATION = 1000;

// Stack geometry, mm (roughly XLS-1 and XRT-U-40 sized parts).
export const GEO = {
  linH: 12,       // linear stage height (body + carriage)
  linL: 60,       // linear stage length
  linW: 40,       // linear stage width
  rotH: 15,       // rotary stage height
  rotR: 20,       // rotary stage radius (Ø40)
  bracketH: 48,   // L-bracket height (XYZ)
  bracketX: -14,  // where the vertical Z stage sits
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Nominal geometry of the stack: each stage's pivot (where its angular error acts: the
 * guide or bearing centre), the top mounting point, and the tip.
 * config: 'XY' | 'XYZ' | 'XYT'. arm: { length (mm), dir: 'up' | 'out' }.
 */
export function stackGeometry(config, arm) {
  const g = GEO;
  const stages = [];
  let top = [0, 0, 0];

  stages.push({ id: 'X', kind: 'linear', axis: 'x', pivot: [0, g.linH / 2, 0], base: [...top] });
  top = [0, g.linH, 0];
  stages.push({ id: 'Y', kind: 'linear', axis: 'z', pivot: [0, top[1] + g.linH / 2, 0], base: [...top] });
  top = [0, 2 * g.linH, 0];

  if (config === 'XYZ') {
    // L-bracket on the Y carriage; Z stage stands vertically on it, carriage facing +x.
    const zx = g.bracketX;
    stages.push({ id: 'Z', kind: 'linear', axis: 'y', pivot: [zx + g.linH / 2, top[1] + 4 + g.linL / 2, 0], base: [...top] });
    top = [zx + g.linH + 4, top[1] + g.linL / 2, 0]; // tool clamp sits on the middle of the Z carriage face
  } else if (config === 'XYT') {
    stages.push({ id: 'θ', kind: 'rotary', axis: 'y', pivot: [0, top[1] + g.rotH / 2, 0], base: [...top] });
    top = [0, top[1] + g.rotH, 0];
  }

  // Tool arm: 'up' is a post along +y from the top mount; 'out' is a horizontal arm along +x.
  // An arm always starts with a 4 mm clamp block so length 0 is still a physical tip.
  const tip = arm.dir === 'up'
    ? add(top, [0, 4 + arm.length, 0])
    : add(top, [4 + arm.length, 4, 0]);
  const rot = stages.find((st) => st.kind === 'rotary');
  return { stages, top, tip, axis: rot ? [rot.pivot[0], rot.pivot[2]] : null };
}

/** Nominal tip at rotary angle θ: an arm on the rotary turns with it (Three.js y-rotation). */
export function tipAt(geo, theta) {
  if (!geo.axis) return geo.tip;
  const dx = geo.tip[0] - geo.axis[0];
  const dz = geo.tip[2] - geo.axis[1];
  const c = Math.cos(theta), s = Math.sin(theta);
  return [geo.axis[0] + c * dx + s * dz, geo.tip[1], geo.axis[1] - s * dx + c * dz];
}

/**
 * Error state of each stage at rotary angle θ (rad).
 * p: { wobble, radial, axial, linAngle, phase (deg: run-out direction relative to wobble) }
 * Returns per stage { omega: [µrad], t: [µm] }.
 */
export function stageErrors(stage, theta, p) {
  if (stage.kind === 'rotary') {
    // Tilt error motion: the axis leans by ε and the lean direction cones round once per
    // revolution (ISO 230-7 'tilt error motion', synchronous part).
    const omega = [p.wobble * Math.cos(theta), 0, p.wobble * Math.sin(theta)];
    // Radial run-out: the axis wanders sideways by r, once per revolution, shifted by ψ.
    const ps = theta + (p.phase * Math.PI) / 180;
    const t = [p.radial * Math.cos(ps), p.axial * Math.cos(ps), p.radial * Math.sin(ps)];
    return { omega, t };
  }
  // Linear stages: pitch and yaw of α each (the two angles that turn the payload as it
  // travels). Taken at their worst-case value; straightness is left out because it adds
  // directly and does not grow with the lever arm.
  const a = p.linAngle;
  const omega = stage.axis === 'x' ? [0, a, a] : stage.axis === 'z' ? [a, a, 0] : [a, 0, a];
  return { omega, t: [0, 0, 0] };
}

/** Tip error contribution of one stage, µm. ω (µrad) × r (mm) × 1e-3 → µm. */
export function contribution(stage, err, tip) {
  const lever = sub(tip, stage.pivot);
  const rot = scale(cross(err.omega, lever), 1e-3);
  return { lever, rot, total: add(err.t, rot) };
}

/** Full tip error at angle θ: total vector and per-stage parts. */
export function tipError(geo, theta, p) {
  const tip = tipAt(geo, theta);
  let total = [0, 0, 0];
  const parts = geo.stages.map((s) => {
    const err = stageErrors(s, theta, p);
    const c = contribution(s, err, tip);
    total = add(total, c.total);
    return { stage: s, err, ...c };
  });
  return { total, parts, tip };
}

/** Peak |δ| and lateral/vertical peaks over one revolution (sampled). */
export function peakOverRevolution(geo, p, N = 180) {
  let peak = 0, lat = 0, vert = 0;
  const path = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const d = tipError(geo, th, p).total;
    path.push(d);
    peak = Math.max(peak, norm(d));
    lat = Math.max(lat, Math.hypot(d[0], d[2]));
    vert = Math.max(vert, Math.abs(d[1]));
  }
  return { peak, lat, vert, path };
}

/** The headline lever-arm number: rotary wobble times the distance from bearing to tip. */
export function wobbleLever(geo, p) {
  const rot = geo.stages.find((s) => s.kind === 'rotary');
  if (!rot) return null;
  // Distance from the bearing centre to the tip. For an arm straight up or straight out the
  // tilt axis is perpendicular to it at some point in the turn, so the peak is ε × L.
  const L = norm(sub(geo.tip, rot.pivot));
  return { L, um: L * p.wobble * 1e-3 };
}
