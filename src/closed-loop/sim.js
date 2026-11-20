// Closed-loop positioning of a Xeryon-style piezo stage: controller + motor + encoder.
//
// Everything here is plain math, no DOM, so it can be run and tested in Node:
//   node -e "import('./src/closed-loop/sim.js').then(m => console.log(m.simulate({ PROP: 2000 }).summary))"
//
// What comes from Xeryon's Controller & Connection Manual (rev 3.26), quoted in the page:
//   • Two zones around the target. |error| < ZON1 uses FREQ and PROP; |error| > ZON2 uses
//     FRQ2 and PRO2; in between the values are interpolated. Zone widths are in encoder units.
//   • PTOL: inside ±PTOL "the control is switched off and the 'position reached' flag is raised".
//   • PTO2 / TOUT: a timer starts when the stage is within ±PTO2; after TOUT ms, PTO2 becomes
//     the tolerance, so the stage does not vibrate "indefinitely around the desired position".
//   • ELIM: if the following error exceeds it, the controller goes to safe mode, motor off.
//   • DUCO = 1 uses amplitude in the loop; DUCO = 0 uses a fixed 50 % amplitude.
//   • SSPD is the travel speed (µm/s); MASS is raised by ~100 per 100 g of payload.
//   • Frequency a few kHz above resonance gives "more relaxed control with better landing";
//     too high gives "very limited force", too low gives "unstable behaviour".
//   • Higher proportional factors react stronger but can give "instability or noisy operation";
//     lower ones give "a more sluggish motion response with more overshoot".
//
// What is OUR model (Xeryon does not publish the internal control law):
//   • drive = PROP·e / GAIN_DIV, clamped to ±1, where e is the following error in encoder counts
//     against a trapezoidal setpoint (SSPD, ACCE). GAIN_DIV is chosen so the manual's defaults
//     behave sensibly. MASS tells the controller the payload: it caps the planned acceleration
//     and deceleration at F_PLAN / (carriage + MASS g), so a heavy stage is not asked to brake
//     harder than its tip can push, and adds speed damping (−MASS·KD·v̂) so the extra inertia does
//     not ring. That is our reading of MASS; treat it as illustrative.
//   • Drive → motor: |drive| becomes amplitude (DUCO=1) or the phase magnitude (DUCO=0, fixed
//     50 % amplitude), sign(drive) becomes the ±90° phase sign, i.e. the direction.
//   • Motor: the tip moves 2·A·sin φ per cycle (same tip equation as the CrossFixx page), so
//     the no-load speed is v0 = f · 2·A·sin φ. The tip can only push with a limited friction
//     force F = F_MAX·(A/A_MAX)·|sin φ|; the stage mass and any load limit how fast v reaches v0.
//   • Resonance: Lorentzian with Q, plus amplitude-dependent softening (resonance drifts down
//     as the vibration grows, as in real piezoceramics). That is why driving below resonance
//     runs away (more amplitude → closer to resonance → more amplitude) and above it is calm.

import { F0_KHZ, Q, TIP_AMP_UM } from '../crossfixx/physics.js';

// ---------- Plant constants (illustrative; check your stage datasheet) ----------
export const SOFTEN_KHZ = 5.0;     // resonance drops this much at full 1 µm amplitude
export const F_MAX_N = 4.0;        // friction drive force at full amplitude on resonance
export const F_HOLD_N = 4.0;       // static holding force with the motor off (self-locking preload)
export const F_RAIL_N = 0.03;      // rail / bearing friction that must be overcome to move
export const STAGE_KG = 0.05;      // moving carriage mass without payload

// ---------- Controller constants (our model) ----------
export const GAIN_DIV = 30000;     // drive = PROP·e / GAIN_DIV  (e in encoder counts)
export const F_PLAN_N = 2.0;       // force the controller plans to use when it shapes accel/decel
export const KD = 1;            // MASS damping: drive −= MASS·KD·v̂/GAIN_DIV, v̂ in counts/ms

export const ENCODERS_NM = [1250, 312, 78, 5, 1]; // resolutions Xeryon offers (manual §13)

export const DEFAULTS = {
  // controller (Xeryon names)
  FREQ: 170000, FRQ2: 170000, PROP: 100, PRO2: 100,
  ZON1: 100, ZON2: 1000, PTOL: 2, PTO2: 10, TOUT: 50, ELIM: 10000,
  SSPD: 10000, ACCE: 10, MASS: 0, DUCO: 1,   // ACCE here in m/s² for the profile
  // stage / move
  encNm: 312, payloadG: 0, loadN: 0, moveUm: 1000, durationMs: 250,
};

// Effective resonance factor 0..1 at drive frequency fHz with current tip amplitude aUm.
export function resonanceGain(fHz, aUm) {
  const f0 = F0_KHZ - SOFTEN_KHZ * (aUm / TIP_AMP_UM);
  const detune = (2 * Q * (fHz / 1000 - f0)) / f0;
  return 1 / Math.sqrt(1 + detune * detune);
}

// Zone interpolation (manual §13): returns { f, prop, w } where w=1 is zone 1, 0 is zone 2.
export function zoneParams(errCounts, p) {
  const e = Math.abs(errCounts);
  let w;
  if (e <= p.ZON1) w = 1;
  else if (e >= p.ZON2) w = 0;
  else w = 1 - (e - p.ZON1) / Math.max(1, p.ZON2 - p.ZON1);
  return { f: p.FRQ2 + (p.FREQ - p.FRQ2) * w, prop: p.PRO2 + (p.PROP - p.PRO2) * w, w };
}

// Trapezoidal setpoint profile from 0 to `dist` µm at speed vmax (µm/s) and accel a (µm/s²).
function makeProfile(dist, vmax, a) {
  const sgn = Math.sign(dist) || 1;
  const D = Math.abs(dist);
  let ta = vmax / a;
  let vpk = vmax;
  if (a * ta * ta > D) { ta = Math.sqrt(D / a); vpk = a * ta; }
  const tc = (D - a * ta * ta) / vpk;
  const T = 2 * ta + tc;
  return {
    T,
    at(t) {
      if (t <= 0) return 0;
      if (t < ta) return sgn * 0.5 * a * t * t;
      if (t < ta + tc) return sgn * (0.5 * a * ta * ta + vpk * (t - ta));
      if (t < T) { const r = T - t; return sgn * (D - 0.5 * a * r * r); }
      return sgn * D;
    },
  };
}

// Run one move. Returns sampled traces and a summary.
export function simulate(params) {
  const p = { ...DEFAULTS, ...params };
  const res = p.encNm / 1000;                  // µm per count
  const target = Math.round(p.moveUm / res);   // counts
  const mass = STAGE_KG + p.payloadG / 1000;   // kg
  const gForce = -p.loadN * Math.sign(p.moveUm || 1); // N, constant load opposing the move (spring, cable, gravity)
  const ctrlHz = 30000;                        // CFRQ default: 30 kHz control loop
  const dt = 1 / ctrlHz;
  const sub = 4;                               // mechanics sub-steps per control tick
  const h = dt / sub;
  const N = Math.round((p.durationMs / 1000) * ctrlHz);
  const aPlan = Math.min(p.ACCE, F_PLAN_N / (STAGE_KG + p.MASS / 1000)); // m/s²
  const prof = makeProfile(p.moveUm, p.SSPD, aPlan * 1e6);
  const tauMode = Q / (Math.PI * F0_KHZ * 1000); // mode ring-up time, ≈ 57 µs

  let x = 0, v = 0, aTip = 0, phiSign = 1, sinPhi = 0, fNow = p.FREQ;
  let on = true, tol = p.PTOL, timerStart = null, reachedAt = null, timeoutAt = null;
  const hist = new Int32Array(30); let vEst = 0;  // 1 ms window for the encoder speed estimate
  let maxOver = 0, elimAt = null; const faults = { saturated: 0, runaway: 0, forceLimited: 0 };
  let toggles = 0, offSince = null, stuckMs = 0, vSum = 0, vSq = 0, vN = 0;

  const stride = Math.max(1, Math.round(N / 1500));
  const out = { t: [], x: [], meas: [], sp: [], amp: [], phase: [], freq: [], on: [], zone: [] };

  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    const meas = Math.round(x / res);           // encoder counts
    const sp = Math.round(prof.at(t) / res);    // setpoint counts
    const errT = target - meas;                 // distance to final target
    const errF = sp - meas;                     // following error
    const slot = i % hist.length;
    vEst = i >= hist.length ? (meas - hist[slot]) / (hist.length * dt * 1000) : 0; // counts/ms
    hist[slot] = meas;

    // ---- error limit (ELIM): safe mode, motor signals off for the rest of the run ----
    if (elimAt === null && Math.abs(errF) > p.ELIM) elimAt = t;
    if (elimAt !== null) { on = false; offSince = null; }

    // ---- tolerance logic (manual §5.2 / §13) ----
    const profileDone = t >= prof.T;
    if (profileDone && Math.abs(errT) <= p.PTO2 && timerStart === null) timerStart = t;
    if (timerStart !== null && tol === p.PTOL && on && (t - timerStart) * 1000 >= p.TOUT) {
      tol = p.PTO2; timeoutAt = t;
    }
    if (elimAt !== null) { /* stays off */ } else if (profileDone && Math.abs(errT) <= tol) {
      if (on) { on = false; offSince = t; }
    } else if (!on && Math.abs(errT) > tol) {
      on = true; offSince = null; // carried or pushed out of tolerance: control re-engages
    }

    // ---- controller: error → drive → amplitude / phase / frequency ----
    let drive = 0;
    const z = zoneParams(profileDone ? errT : Math.max(Math.abs(errF), Math.abs(errT)), p);
    if (on) {
      drive = (z.prop * errF - p.MASS * KD * vEst) / GAIN_DIV;
      if (Math.abs(drive) >= 1) faults.saturated++;
      drive = Math.max(-1, Math.min(1, drive));
    }
    fNow = z.f;
    let ampCmd, phiMag;
    if (p.DUCO) { ampCmd = Math.abs(drive); phiMag = drive === 0 ? 0 : 1; }
    else { ampCmd = on ? 0.5 : 0; phiMag = Math.abs(drive); }
    const newSign = drive >= 0 ? 1 : -1;
    if (drive !== 0 && newSign !== phiSign) {
      if (t > prof.T * 0.9) toggles++;   // direction reversals while landing
      phiSign = newSign;
    }
    sinPhi = phiSign * phiMag;

    // ---- motor + stage mechanics ----
    for (let k = 0; k < sub; k++) {
      const gain = resonanceGain(fNow, aTip);
      const aTarget = ampCmd * TIP_AMP_UM * gain;
      aTip += (aTarget - aTip) * (h / tauMode);
      const v0 = fNow * 2 * aTip * sinPhi;                     // µm/s, no-load tip speed
      const Fcap = F_MAX_N * (aTip / TIP_AMP_UM) * Math.abs(sinPhi);
      const vms = v * 1e-6;
      let a;
      if (!on || aTip < 1e-4 || sinPhi === 0) {
        // Motor off: the preloaded tip clamps the strip (self-locking).
        const need = -gForce;                                // force to hold still
        if (Math.abs(vms) < 1e-6 && Math.abs(need) <= F_HOLD_N) { v = 0; a = 0; continue; }
        const fr = -Math.sign(vms || -gForce) * F_HOLD_N;
        a = (fr + gForce) / mass;
        const vn = vms + a * h;
        if (Math.sign(vn) !== Math.sign(vms) && vms !== 0 && Math.abs(gForce) <= F_HOLD_N) { v = 0; continue; }
        v = vn * 1e6; x += v * h; continue;
      }
      // Motor on: friction pulls the stage toward the tip speed, limited to ±Fcap.
      let Fneed = (mass * (v0 - v) * 1e-6) / (tauMode) - gForce;
      const Ff = Math.max(-Fcap, Math.min(Fcap, Fneed));
      if (Math.abs(Fneed) > Fcap) faults.forceLimited++;
      let Fnet = Ff + gForce;
      // rail friction
      if (Math.abs(v) < 1 && Math.abs(Fnet) < F_RAIL_N) { v = 0; continue; }
      Fnet -= Math.sign(v || Fnet) * F_RAIL_N;
      a = Fnet / mass;
      v += a * h * 1e6;
      x += v * h;
    }
    if (fNow < (F0_KHZ - SOFTEN_KHZ * aTip) * 1000 && aTip > 0.3) faults.runaway++;
    if (on && Math.abs(v) < 5 && Math.abs(errT) > tol && t > 0.005) stuckMs += dt * 1000;
    if (t > prof.T * 0.2 && t < prof.T * 0.8) { const vv = v / Math.max(1, p.SSPD); vSum += vv; vSq += vv * vv; vN++; }

    const over = (x / res - target) * Math.sign(target || 1);
    if (t > prof.T * 0.5 && over > maxOver) maxOver = over;

    if (i % stride === 0 || i === N) {
      out.t.push(t * 1000); out.x.push(x); out.meas.push(meas * res); out.sp.push(sp * res);
      out.amp.push(aTip); out.phase.push(sinPhi === 0 ? 0 : Math.sign(sinPhi) * Math.asin(Math.min(1, Math.abs(sinPhi))) * 180 / Math.PI);
      out.freq.push(fNow); out.on.push(on ? 1 : 0); out.zone.push(z.w);
    }
  }

  const finalErr = target - Math.round(x / res);
  reachedAt = offSince;
  const vMean = vN ? vSum / vN : 0;
  const jerk = vN ? Math.sqrt(Math.max(0, vSq / vN - vMean * vMean)) : 0;
  const summary = {
    target, res, profileMs: prof.T * 1000,
    reachedMs: reachedAt === null ? null : reachedAt * 1000,
    settleMs: reachedAt === null ? null : (reachedAt - prof.T) * 1000,
    landedOn: reachedAt === null ? 'none' : (timeoutAt !== null && reachedAt >= timeoutAt - 1e-9 ? 'PTO2' : 'PTOL'),
    timeoutMs: timeoutAt === null ? null : timeoutAt * 1000,
    overshootCounts: Math.max(0, maxOver),
    finalErrCounts: finalErr,
    reversals: toggles,
    stuckMs,
    elimMs: elimAt === null ? null : elimAt * 1000,
    speedRipple: jerk,               // std of speed during cruise, as a fraction of SSPD
    runaway: faults.runaway > 30,
  };
  summary.diagnosis = diagnose(summary, p);
  return { p, out, summary };
}

// Map a run onto the manual's symptom language.
export function diagnose(s, p) {
  const d = [];
  if (p.FREQ < F0_KHZ * 1000 && (s.runaway || s.speedRipple > 0.3 || s.overshootCounts > 3)) d.push({ key: 'unstable', text: 'FREQ is below the ${F0_KHZ} kHz resonance: as the vibration grows the resonance softens toward the drive frequency, so amplitude runs away and motion turns jerky. The manual: frequency too low gives "unstable behaviour". Raise FREQ / FRQ2 a few kHz above resonance.' });
  if (s.elimMs !== null) d.push({ key: 'force', text: `Following error passed ELIM at ${s.elimMs.toFixed(0)} ms, so the controller went to safe mode and switched the motor off. The tip could not push the load (insufficient force). The manual: frequency too high gives "very limited force". Lower FREQ / FRQ2 toward resonance or reduce the load.` });
  if (s.overshootCounts > Math.max(3, 2 * p.PTOL)) {
    const heavy = p.payloadG - p.MASS >= 200;
    d.push({ key: 'overshoot', text: heavy
      ? `Overshoot of ${s.overshootCounts.toFixed(0)} counts. The payload is ${p.payloadG} g but MASS is ${p.MASS}: the controller brakes as if the stage were light. Raise MASS (~100 per 100 g), then halve PROP / PRO2 if it still rings.`
      : `Overshoot of ${s.overshootCounts.toFixed(0)} counts: the stage arrives faster than its tip can brake within one loop delay. Lower PROP / PRO2, or check that MASS matches the payload.` });
  }
  if (s.reversals > 6) d.push({ key: 'hunting', text: `Landing oscillation: the stage reversed ${s.reversals} times around the target. Proportional factor too high for this encoder, or PTOL tighter than the stage can hold. Lower PROP or raise PTOL / PTO2.` });
  if (s.landedOn === 'PTO2') d.push({ key: 'pto2', text: `Did not land within PTOL in TOUT = ${p.TOUT} ms, so PTO2 = ±${p.PTO2} counts became the tolerance. That is the timeout doing its job.` });
  if (s.landedOn === 'none' && !d.length) {
    d.push({ key: 'stall', text: p.loadN > 0
      ? `Stopped ${Math.abs(s.finalErrCounts)} counts short, outside PTO2. A constant load needs a constant push, and a proportional controller only pushes while there is error, so it settles where PROP·error just balances the load. Raise PROP, move FREQ closer to resonance for more force, or reduce the load.`
      : `Stopped ${Math.abs(s.finalErrCounts)} counts short, outside PTO2. Near the target PROP·error is too small to beat friction, so the stage stalls. The manual: lower proportional factors give "a more sluggish motion response". Raise PROP / PRO2.` });
  }
  if (!d.length) d.push({ key: 'ok', text: `Landed within PTOL = ±${p.PTOL} counts, ${s.settleMs.toFixed(1)} ms after the profile ended. Control switched off; the preload holds the position.` });
  return d;
}

// ---------- Presets ----------
// Each preset is the defaults plus a few changes. `fix` is the change the manual recommends.
export const PRESETS = [
  { id: 'defaults', label: 'Xeryon defaults', symptom: 'Lands cleanly',
    params: {} },
  { id: 'hunting', label: 'Landing oscillation', symptom: 'Overshoots, reverses, hunts around the target',
    params: { PROP: 2000, PRO2: 2000 },
    fix: { PROP: 100, PRO2: 100 }, fixLabel: 'Lower PROP / PRO2' },
  { id: 'below', label: 'Frequency below resonance', symptom: 'Jerky, unstable landing',
    params: { FREQ: 163000, PROP: 900 },
    fix: { FREQ: 170000 }, fixLabel: 'Raise FREQ to 170 kHz' },
  { id: 'stall', label: 'Proportional too low', symptom: 'Creeps, stops short of the target',
    params: { PROP: 10, PRO2: 10 },
    fix: { PROP: 100, PRO2: 100 }, fixLabel: 'Raise PROP / PRO2' },
  { id: 'payload', label: '1 kg payload, MASS not set', symptom: 'Big overshoot, slow landing',
    params: { payloadG: 1000 },
    fix: { MASS: 1000 }, fixLabel: 'Set MASS = 1000' },
  { id: 'force', label: 'Insufficient force', symptom: 'Cannot push the load, error limit trips',
    params: { loadN: 1.5, FREQ: 176000, FRQ2: 176000 },
    fix: { FREQ: 166000, FRQ2: 166000 }, fixLabel: 'Lower FREQ / FRQ2 to resonance' },
];
