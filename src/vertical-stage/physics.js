// Force balance of a Xeryon XVS-style vertical stage driven by a CrossFixx friction motor.
//
// Sign convention: z is carriage height (mm, 0 = bottom of stroke), forces are in newtons,
// and F_net > 0 means the net load on the drive pulls DOWN.
//
//   W      = (m_carriage + m_payload) · g             weight of everything that moves
//   F_comp = compensation force (up). Spring: F0 + k·(z_mid − z); magnet: F0 (nearly flat)
//   F_net  = W − F_comp                                what the friction contact must carry
//
// Powered:   the motor can push either way up to DRIVE_N (datasheet "driving force 3 N min.").
//            Speed falls linearly with the force it has to fight: v = V0 · (1 − F_against / DRIVE_N).
//            If |F_net| > DRIVE_N the stage cannot hold and is dragged in the direction of F_net.
// Unpowered: the spring-preloaded tip clamps the strip (self-locking). Static friction holds up
//            to HOLD_N ("holding force 3 N min."). Below that the only motion is elastic sag
//            F_net / HOLD_STIFF ("passive holding stiffness 1 N/µm typ."). Above it, the carriage slips.
//
// Values from Xeryon's XVS-3-40 datasheet (Xeryon_XVS_series.pdf, 2025) unless marked ASSUMED.

export const G = 9.81;
export const DRIVE_N = 3.0;          // driving force, N (datasheet: 3 N min.)
export const HOLD_N = 3.0;           // holding force, unpowered, N (datasheet: 3 N min.)
export const HOLD_STIFF = 1.0;       // passive holding stiffness, N/µm (datasheet: 1 N/µm typ.)
export const V0 = 100;               // no-load speed, mm/s (datasheet: 100 mm/s typ.)
export const STROKE = 40;            // travel, mm (XVS-3-40)
export const M_CARRIAGE = 0.040;     // moving carriage mass, kg. ASSUMED: datasheet gives only the 97 g total stage.
export const M_COMP_SLIDER = 0.020;  // extra moving mass of the compensation slider, kg. ASSUMED.
export const SLIP_KINETIC = 0.8;     // kinetic / static friction ratio once the contact slips. ASSUMED.
export const SPRING_K = 0.02;        // tension-spring rate, N/mm. ASSUMED; magnet version is taken as flat.
// Design rule used to draw the "in spec" window: gravity may use at most half the drive force,
// the other half is kept for acceleration (datasheet: 8.8 m/s² typ.) and margin. ASSUMED rule;
// it reproduces Xeryon's 0–100 g uncompensated range for XVS-3-40.
export const SPEC_FRACTION = 0.5;

// Reference ranges printed by Xeryon, for marks on the chart (net payload, g).
export const XERYON_RANGES = [
  { name: 'no comp.', lo: 0, hi: 100 },
  { name: 'MC1', lo: 150, hi: 250 },
  { name: 'MC2', lo: 250, hi: 350 },
];

// Compensation presets: the payload (g) the compensation is tuned to carry, at mid-stroke.
export const COMP_PRESETS = { off: 0, mc1: 200, mc2: 300, max: 450 };

export function movingMass(payloadG, compG) {
  return M_CARRIAGE + payloadG / 1000 + (compG > 0 ? M_COMP_SLIDER : 0);
}

// Upward compensation force at height z.
// Tuned so that at mid-stroke it exactly carries the carriage, its slider and `compG` grams of payload.
export function compForce(compG, type, z) {
  if (compG <= 0) return 0;
  const f0 = (M_CARRIAGE + M_COMP_SLIDER + compG / 1000) * G;
  if (type === 'magnet') return f0;
  return f0 + SPRING_K * (STROKE / 2 - z); // spring stretches more (pulls harder) as the carriage drops
}

export function weight(payloadG, compG) {
  return movingMass(payloadG, compG) * G;
}

export function netLoad(payloadG, compG, type, z) {
  return weight(payloadG, compG) - compForce(compG, type, z);
}

// Worst-case |F_net| over the whole stroke (springs are worst at an end, magnets are flat).
export function worstNet(payloadG, compG, type) {
  const a = netLoad(payloadG, compG, type, 0);
  const b = netLoad(payloadG, compG, type, STROKE);
  return Math.abs(a) > Math.abs(b) ? a : b;
}

// Payload range (g) for which |F_net| stays within SPEC_FRACTION·DRIVE_N over the whole stroke.
export function specRange(compG, type) {
  const lim = SPEC_FRACTION * DRIVE_N;
  let lo = null;
  let hi = null;
  for (let p = 0; p <= 800; p += 1) {
    if (Math.abs(worstNet(p, compG, type)) <= lim) {
      if (lo === null) lo = p;
      hi = p;
    }
  }
  return lo === null ? null : { lo, hi };
}

// Speed the motor reaches when it must push against `against` newtons (mm/s, ≥ 0).
export function speedAgainst(against) {
  if (against >= DRIVE_N) return 0;
  return V0 * Math.min(1, 1 - against / DRIVE_N);
}

// What the carriage does right now.
//   cmd: 'up' | 'hold' | 'down';  powered: boolean
// Returns { v (mm/s, + up), status, sagUm, mode }
export function behaviour({ payloadG, compG, type, z, cmd, powered }) {
  const F = netLoad(payloadG, compG, type, z);
  const m = movingMass(payloadG, compG);
  if (!powered) {
    if (Math.abs(F) <= HOLD_N) {
      return { F, v: 0, status: 'locked', sagUm: F / HOLD_STIFF, accel: 0 };
    }
    // slipping: kinetic friction resists, the rest accelerates the carriage
    const accel = -Math.sign(F) * (Math.abs(F) - SLIP_KINETIC * HOLD_N) / m; // m/s², + up
    return { F, v: null, status: 'slipping', sagUm: 0, accel };
  }
  if (Math.abs(F) > DRIVE_N) {
    const accel = -Math.sign(F) * (Math.abs(F) - SLIP_KINETIC * DRIVE_N) / m;
    return { F, v: null, status: 'overloaded', sagUm: 0, accel };
  }
  if (cmd === 'hold') return { F, v: 0, status: 'holding', sagUm: 0, accel: 0 };
  // Moving up the motor fights +F; moving down it fights −F.
  const against = cmd === 'up' ? F : -F;
  const v = speedAgainst(against);
  return { F, v: cmd === 'up' ? v : -v, status: v === 0 ? 'stalled' : 'moving', sagUm: 0, accel: 0 };
}
