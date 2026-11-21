// Short sentences in the left panel that follow the current state.
import { DRIVE_N, HOLD_N, HOLD_STIFF, SPEC_FRACTION } from './physics.js';

const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function captions(s) {
  const lines = [];
  const absF = Math.abs(s.F);
  const dirWord = s.F > 0 ? 'down' : 'up';
  const spec = SPEC_FRACTION * DRIVE_N;

  // 1. What gravity does to a friction drive
  lines.push(`The motor does not grip the carriage with teeth or a screw. It only rubs on a ceramic strip, and that friction contact has to carry <em>everything that moves</em>: ${fmt(s.m * 1000)} g, or ${fmt(s.W, 2)} N of weight.`);

  // 2. Compensation
  if (s.compG > 0) {
    const how = s.type === 'spring'
      ? `A tension spring pulls up with ${fmt(s.C, 2)} N. Its force grows as the carriage drops and shrinks as it rises, so the balance is exact only at mid-stroke.`
      : `A magnetic counterweight (NdFeB slider on a steel stator) pulls up with ${fmt(s.C, 2)} N, nearly the same at every height.`;
    lines.push(how);
    lines.push(`That leaves only ${fmt(absF, 2)} N ${dirWord} for the motor. The window moves instead of growing: it now covers ${s.range ? `${fmt(s.range.lo)}–${fmt(s.range.hi)} g` : 'no payload'}, and an <em>empty</em> stage is pushed up just as hard as an overloaded one is pulled down.`);
  } else {
    lines.push(`No compensation: the full ${fmt(s.W, 2)} N lands on the contact. The motor's ${fmt(DRIVE_N)} N must lift it and still have force left to accelerate, which is why payload stops at about 100 g.`);
  }

  // 3. What happens right now
  switch (s.status) {
    case 'moving':
      lines.push(s.v > 0
        ? `Going up, the motor fights ${fmt(s.F, 2)} N, so it reaches ${fmt(s.v)} mm/s of its ${fmt(100)} mm/s.`
        : `Going down, ${s.F > 0 ? 'gravity helps' : `the compensation fights back with ${fmt(-s.F, 2)} N`}: ${fmt(-s.v)} mm/s.`);
      break;
    case 'stalled':
      lines.push(`<b>Stalled.</b> The load against the motor equals its ${fmt(DRIVE_N)} N driving force, so the tip ellipse rubs without moving the strip.`);
      break;
    case 'holding':
      lines.push(`Holding in closed loop: the encoder sees any drift and the motor pushes back with ${fmt(absF, 2)} N.`);
      break;
    case 'overloaded':
      lines.push(`<b>Overloaded.</b> ${fmt(absF, 2)} N is more than the ${fmt(DRIVE_N)} N the friction contact can transmit, so the carriage slides ${dirWord} even with the motor running${s.atBottom || s.atTop ? ', until the end stop catches it' : ''}.`);
      break;
    case 'locked':
      lines.push(`Power off: the preload spring still clamps the tip on the strip, so static friction holds the carriage. <em>Self-locking</em>, no current, no heat. It only sags elastically: ${fmt(absF, 2)} N ÷ ${fmt(HOLD_STIFF)} N/µm = ${fmt(absF / HOLD_STIFF, 2)} µm.`);
      break;
    case 'slipping':
      lines.push(`<b>Power off and slipping.</b> ${fmt(absF, 2)} N exceeds the ${fmt(HOLD_N)} N holding force, so self-locking gives way and the carriage slides ${dirWord}${s.atBottom || s.atTop ? ' onto the end stop' : ''}.`);
      break;
    default:
  }

  if (s.status !== 'overloaded' && s.status !== 'slipping' && absF > spec && absF <= DRIVE_N) {
    lines.push(`It works, but ${fmt(absF, 2)} N uses more than half the drive force, leaving little for acceleration. Outside the in-spec window.`);
  }
  return lines;
}
