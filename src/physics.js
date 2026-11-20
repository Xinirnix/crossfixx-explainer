// Tip kinematics for a two-mode standing-wave ultrasonic motor (Xeryon CrossFixx style).
//
// Tangential (bending mode, parallel to the strip):   x = A * sin(ωt)
// Normal     (expansion mode, into the strip):        y = A * sin(ωt + φ)
//
// y > 0 means the tip is pressed into the strip (contact / push half).
// Averaged over one cycle, the tangential travel made while in contact is
//   ∫ dx over {θ : sin(θ+φ) > 0} = 2 A sin φ
// so net step per cycle ∝ sin φ: maximal at ±90°, zero at 0° and 180°,
// and its sign (direction) follows the sign of φ.

export const F0_KHZ = 166;          // shared resonance of both modes
export const Q = 30;                // mechanical quality factor (band ≈ F0/Q ≈ 5.5 kHz)
export const TIP_AMP_UM = 1.0;      // peak tip displacement at amplitude = 1, on resonance
export const EXAGGERATION = 1000;   // display scale for the tip motion and per-cycle travel
export const STALL = 0.12;          // fraction of full drive lost to preload friction / load
export const STICKSLIP_HZ = 2000;   // typical audible stick-slip drive rate, for contrast

const DEG = Math.PI / 180;

// Lorentzian amplitude response of a mode driven at f near its resonance f0.
export function resonance(fKHz) {
  const detune = (2 * Q * (fKHz - F0_KHZ)) / F0_KHZ;
  return 1 / Math.sqrt(1 + detune * detune);
}

// Effective peak tip amplitude in µm.
export function tipAmplitudeUm(amp, fKHz) {
  return amp * TIP_AMP_UM * resonance(fKHz);
}

// Tip position in µm at cycle angle θ = ωt (radians).
export function tipPosition(theta, Aum, phaseDeg) {
  return {
    x: Aum * Math.sin(theta),
    y: Aum * Math.sin(theta + phaseDeg * DEG),
  };
}

// Tangential velocity of the tip per radian of cycle (µm/rad).
export function tipDxDtheta(theta, Aum) {
  return Aum * Math.cos(theta);
}

// Fraction (0..1) of the ideal no-slip transfer that survives friction/load.
// Ideal drive is |sin φ| * (A / A_max); below STALL nothing moves.
export function transferFactor(Aum, phaseDeg) {
  const drive = Math.abs(Math.sin(phaseDeg * DEG)) * (Aum / TIP_AMP_UM);
  if (drive <= STALL) return 0;
  return (drive - STALL) / (drive * (1 - STALL));
}

// Net slider travel per cycle in µm (signed).
export function stepPerCycleUm(Aum, phaseDeg) {
  return 2 * Aum * Math.sin(phaseDeg * DEG) * transferFactor(Aum, phaseDeg);
}

// Stick-slip contrast: slow extend over `rise` of the cycle, fast retract.
// Returns tangential position (µm) and whether the slider is sticking.
export function stickSlip(theta, Aum, dir, rise = 0.85) {
  const u = ((theta / (2 * Math.PI)) % 1 + 1) % 1;
  let s;
  let sticking;
  if (u < rise) {
    s = -1 + (2 * u) / rise;
    sticking = true;
  } else {
    s = 1 - (2 * (u - rise)) / (1 - rise);
    sticking = false;
  }
  return { x: dir * Aum * s, y: 0, sticking };
}
