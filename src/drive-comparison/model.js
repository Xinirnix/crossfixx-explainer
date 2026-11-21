// Four ways to move a payload along one axis, modelled with the same command,
// the same external load and the same power switch.
//
//   piezo  : direct piezo friction drive (Xeryon ultrasonic, XLA-class)
//   screw  : stepper motor turning a lead screw (or a ball screw)
//   worm   : DC servo motor driving a worm gear, load on an output arm
//   magnet : electromagnetic linear motor (coil forcer over a magnet track)
//
// Where a number comes from:
//   [Xeryon]  stated on xeryon.com/precision-motion-technology-comparison/ or
//             xeryon.com/technology/crossfixx-piezo-motor/
//   [physics] a textbook relation (screw/worm self-locking, I²R, field decay)
//   [assumed] a plausible example value for this demo. Replace it with the
//             datasheet value of the parts you actually care about.
//
// Linear positions are in µm, the worm output angle is in degrees.
// The external load always pulls toward −x (think: gravity on a vertical axis).

const DEG = Math.PI / 180;

// ---------- Shared scenario ----------
export const TRAVEL_UM = 2000;     // command swings ±2 mm               [assumed]
export const END_STOP_UM = 2600;   // hard stops at ±2.6 mm              [assumed]
export const WORM_SWING_DEG = 30;  // worm output swings ±30°            [assumed]
export const WORM_END_DEG = 40;
export const EARTH_FIELD_MT = 0.05; // Earth's field, for scale          [physics]

// Command profile, period 12 s: ramp up 4 s, dwell 2 s, ramp down 4 s, dwell 2 s.
// Returns u in [−1, 1] and du/dt sign (0 while dwelling).
export const PERIOD_S = 12;
export function command(t) {
  const p = ((t % PERIOD_S) + PERIOD_S) % PERIOD_S;
  if (p < 4) return { u: -1 + p / 2, dir: 1 };
  if (p < 6) return { u: 1, dir: 0 };
  if (p < 10) return { u: 1 - (p - 6) / 2, dir: -1 };
  return { u: -1, dir: 0 };
}

// ---------- Parameters (editable) ----------
export const P = {
  piezo: {
    mu: 0.25,            // friction coefficient, ceramic tip on ceramic strip   [assumed]
    preloadN: 16,        // spring preload pressing the tip on the strip        [assumed]
    encoderUm: 0.078,    // XLA encoder resolution, 78 nm                       [Xeryon]
    vmaxUmS: 400e3,      // XLA speed 400 mm/s                                  [Xeryon]
    slipUmS: 3000,       // speed at which an overloaded contact slides         [assumed]
  },
  screw: {
    leadMm: 1,           // travel per screw revolution                         [assumed]
    diaMm: 6,            // screw pitch diameter                                [assumed]
    muPlain: 0.15,       // bronze or polymer nut on steel                      [assumed]
    muBall: 0.005,       // recirculating ball nut                              [assumed]
    backlashUm: 40,      // plain nut, no anti-backlash preload                 [assumed]
    carriageFricN: 0.5,  // guide friction on the carriage                      [assumed]
    holdCurrentA: 0.8,   // stepper phase current at standstill                 [assumed]
    phaseOhm: 3.4,       // stepper winding resistance per phase                [assumed]
    vmaxUmS: 1400,       // stepper on a screw, 1.4 mm/s                        [Xeryon]
    motorFieldMT: 10,    // stray field at the motor housing surface            [assumed]
    motorRadiusMm: 20,
    motorToPayloadMm: 60,
  },
  worm: {
    module: 1,           // gear module, mm                                     [assumed]
    wormDiaMm: 16,       // worm pitch diameter                                 [assumed]
    teeth: 40,           // teeth on the wheel                                  [assumed]
    mu: 0.08,            // steel worm on bronze wheel, lubricated              [assumed]
    backlashArcmin: 10,  // at the output                                       [assumed]
    armMm: 25,           // load hangs on an arm of this length                 [assumed]
    kt: 0.01,            // DC motor torque constant, N·m/A                     [assumed]
    motorOhm: 5,         //                                                     [assumed]
    vmaxDegS: 30,
    motorFieldMT: 10,
    motorRadiusMm: 15,
    motorToPayloadMm: 50,
  },
  magnet: {
    kf: 10,              // force constant, N/A                                 [assumed]
    phaseOhm: 6,         // winding resistance                                  [assumed]
    B0mT: 500,           // field at the magnet track surface                   [assumed]
    polePitchMm: 12,     // magnet pole pitch τ                                 [assumed]
    payloadAboveTrackMm: 10,
    massKg: 0.4,         // moving mass                                         [assumed]
    fricN: 0.3,          // guide friction                                      [assumed]
    vmaxUmS: 2000e3,     // electromagnetic stage, 2000 mm/s                    [Xeryon]
  },
};

// ---------- Equations ----------

// Piezo friction drive. Holding force = μ·preload, and Xeryon states the motor
// "self-locks at rest with a holding force equal to its driving force".
export function piezoHoldN(p = P.piezo) {
  return p.mu * p.preloadN;
}

// Screw or worm: lead angle λ = atan(lead / (π·d)). A load cannot back-drive
// the screw when μ > tan λ (self-locking). Thread flank angle is ignored;
// it makes real Acme threads lock a little more readily.
export function leadAngle(leadMm, diaMm) {
  return Math.atan(leadMm / (Math.PI * diaMm));
}
export function selfLocks(mu, lambda) {
  return mu > Math.tan(lambda);
}
// Back-driving (reverse) efficiency: η_r = (1 − μ/tan λ) / (1 + μ·tan λ).
// ≤ 0 means the load cannot turn the screw: it self-locks.
export function reverseEfficiency(mu, lambda) {
  const t = Math.tan(lambda);
  return (1 - mu / t) / (1 + mu * t);
}

export function screwInfo(ball, p = P.screw) {
  const lambda = leadAngle(p.leadMm, p.diaMm);
  const mu = ball ? p.muBall : p.muPlain;
  return { lambda, mu, tanL: Math.tan(lambda), locks: selfLocks(mu, lambda), etaR: reverseEfficiency(mu, lambda) };
}

export function wormInfo(starts, p = P.worm) {
  const leadMm = starts * Math.PI * p.module;            // lead = starts × axial pitch
  const lambda = leadAngle(leadMm, p.wormDiaMm);
  const ratio = p.teeth / starts;
  return {
    lambda, ratio, mu: p.mu, tanL: Math.tan(lambda),
    locks: selfLocks(p.mu, lambda), etaR: reverseEfficiency(p.mu, lambda),
  };
}

// Joule heating P = I²R.
export const stepperHoldW = (p = P.screw) => 2 * p.holdCurrentA ** 2 * p.phaseOhm; // both phases on
export function magnetHoldW(loadN, p = P.magnet) {
  const I = loadN / p.kf;                                // F = k_f · I
  return p.phaseOhm * I * I;
}
export function wormHoldW(loadN, starts, p = P.worm) {
  const w = wormInfo(starts, p);
  if (w.locks) return 0;                                 // the gear carries the load, motor can rest
  const Tout = loadN * p.armMm * 1e-3;                   // N·m at the wheel
  const Tmotor = (Tout / w.ratio) * w.etaR;              // what leaks back to the worm shaft
  const I = Tmotor / p.kt;
  return p.motorOhm * I * I;
}

// Stray field at distance d (mm) above the payload.
// Motor housing ≈ dipole: B = Bs·(rs / (rs + r))³.
export function dipoleFieldMT(dMm, p) {
  const r = Math.hypot(p.motorToPayloadMm, dMm);
  return p.motorFieldMT * (p.motorRadiusMm / (p.motorRadiusMm + r)) ** 3;
}
// Periodic magnet track, pole pitch τ: the fundamental decays as B0·exp(−π·z/τ).
export function trackFieldMT(dMm, p = P.magnet) {
  const z = dMm + p.payloadAboveTrackMm;
  return p.B0mT * Math.exp((-Math.PI * z) / p.polePitchMm);
}

// ---------- Simulation ----------

function toward(x, target, maxStep) {
  const d = target - x;
  return Math.abs(d) <= maxStep ? target : x + Math.sign(d) * maxStep;
}

export function createSim() {
  const s = {
    piezo: { x: -TRAVEL_UM },
    screw: { drive: -TRAVEL_UM, x: -TRAVEL_UM - P.screw.backlashUm / 2, v: 0 },
    worm: { drive: -WORM_SWING_DEG, a: -WORM_SWING_DEG, w: 0 },
    magnet: { x: -TRAVEL_UM, v: 0 },
  };
  return s;
}

// env: { powered, loadN, ballScrew, wormStarts, backlashUm, wormBacklashArcmin }
export function step(s, dt, cmd, env) {
  const xCmd = cmd.u * TRAVEL_UM;
  const aCmd = cmd.u * WORM_SWING_DEG;
  const F = env.loadN;

  // --- Piezo friction drive: no gears, no screw, so no lost motion.
  {
    const p = P.piezo;
    const hold = piezoHoldN(p);
    const st = s.piezo;
    if (F > hold) {
      st.x = Math.max(-END_STOP_UM, st.x - p.slipUmS * dt); // load exceeds friction: contact slides
      st.state = 'slipping';
    } else if (env.powered) {
      st.x = toward(st.x, xCmd, p.vmaxUmS * dt);
      st.state = 'driving';
    } else {
      st.state = 'locked';                                // friction lock, zero power
    }
    st.xMeas = Math.round(st.x / p.encoderUm) * p.encoderUm;
    st.err = st.xMeas - xCmd;
    st.holdW = 0;                                         // "draws no current to stay put" [Xeryon]
    st.fieldMT = 0;                                       // ceramic, no coils, no magnets
  }

  // --- Lead / ball screw, open-loop stepper.
  {
    const p = P.screw;
    const st = s.screw;
    const info = screwInfo(env.ballScrew, p);
    const b = env.backlashUm;
    if (env.powered) {
      st.drive = toward(st.drive, xCmd, p.vmaxUmS * dt);
      st.v = 0;
      st.state = 'driving';
    } else if (!info.locks && F > p.carriageFricN) {
      // Load back-drives the screw. Speed limited by rotor inertia and friction; crude first-order model.
      st.v = Math.min(st.v + 20000 * dt, 20000);
      st.drive = Math.max(st.drive - st.v * dt, -END_STOP_UM + b / 2);
      st.state = 'back-driven';
    } else {
      st.state = info.locks ? 'self-locked' : 'holding by friction';
    }
    // Carriage inside the backlash gap: pulled onto the lower flank by the load,
    // otherwise it only moves when a flank pushes it.
    if (F > p.carriageFricN) st.x = st.drive - b / 2;
    else st.x = Math.min(Math.max(st.x, st.drive - b / 2), st.drive + b / 2);
    st.err = st.x - xCmd;
    st.gap = st.x - st.drive;                             // −b/2 .. +b/2
    st.holdW = env.powered ? stepperHoldW(p) : 0;
    st.locks = info.locks;
    st.info = info;
  }

  // --- Worm gear, DC servo motor, load on an arm.
  {
    const p = P.worm;
    const st = s.worm;
    const info = wormInfo(env.wormStarts, p);
    const bDeg = env.wormBacklashArcmin / 60;
    if (env.powered) {
      st.drive = toward(st.drive, aCmd, p.vmaxDegS * dt);
      st.w = 0;
      st.state = 'driving';
    } else if (!info.locks && F > 0.05) {
      st.w = Math.min(st.w + 120 * dt, 120);
      st.drive = Math.max(st.drive - st.w * dt, -WORM_END_DEG + bDeg / 2);
      st.state = 'back-driven';
    } else {
      st.state = info.locks ? 'self-locked' : 'holding by friction';
    }
    if (F > 0.05) st.a = st.drive - bDeg / 2;
    else st.a = Math.min(Math.max(st.a, st.drive - bDeg / 2), st.drive + bDeg / 2);
    st.errArcmin = (st.a - aCmd) * 60;
    st.gap = (st.a - st.drive) * 60;
    st.holdW = env.powered ? wormHoldW(F, env.wormStarts, p) : 0;
    st.locks = info.locks;
    st.info = info;
  }

  // --- Electromagnetic linear motor, closed-loop servo.
  {
    const p = P.magnet;
    const st = s.magnet;
    if (env.powered) {
      st.x = toward(st.x, xCmd, p.vmaxUmS * dt);
      st.v = 0;
      st.state = 'driving';
      st.holdW = magnetHoldW(F, p);
    } else {
      st.holdW = 0;
      const net = F - p.fricN;
      if (net > 0 && st.x <= -END_STOP_UM) {
        st.v = 0;
        st.state = 'on end stop';
      } else if (net > 0) {
        st.v += (net / p.massKg) * 1e6 * dt * 0.002;       // a = F/m, shown 500× slower so you can watch it fall
        st.x = Math.max(st.x - st.v * dt, -END_STOP_UM);
        st.state = 'falling';
      } else {
        st.v = 0;
        st.state = 'unpowered, free';
      }
    }
    st.err = st.x - xCmd;
  }
}

export const DEG_TO_RAD = DEG;
