// Short explanatory sentences that follow the current state.
import { F0_KHZ, STICKSLIP_HZ, EXAGGERATION } from './physics.js';

const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function captions(s) {
  const part = s.driven === 'linear' ? 'rod' : 'rotor';
  const fwd = s.driven === 'linear' ? 'right' : 'clockwise';
  const back = s.driven === 'linear' ? 'left' : 'counter-clockwise';
  const lines = [];

  if (s.mode === 'stickslip') {
    lines.push('<b>Not CrossFixx.</b> This is stick-slip, shown only for contrast.');
    lines.push(`The tip extends slowly, so friction makes the ${part} stick and follow.`);
    lines.push(`Then it snaps back so fast that the ${part}'s inertia lets it slip: one small net step per cycle.`);
    lines.push(`It runs at audible rates (~${fmt(STICKSLIP_HZ / 1000)} kHz here), wears the contact, and moves only a few mm/s.`);
    return lines;
  }

  if (s.nodal) {
    lines.push('<i>Nodal mount.</i> The plate is held only by a pin through its centre hole. That is not a weak spot: it is the one point that never moves.');
    lines.push('In the expansion mode the plate grows and shrinks about its centre; in the bending mode it shears about its centre. Both modes have a node at the same place, so their sum does too.');
    lines.push(`The dots trace their paths (×${EXAGGERATION}): bigger further out, zero at the centre. So the clamp passes no vibration to the housing and wastes no energy.`);
    return lines;
  }

  const sinP = Math.sin((s.phase * Math.PI) / 180);
  const absP = Math.abs(s.phase);
  const dir = s.step > 0 ? fwd : back;

  if (s.Aum < 0.02) {
    lines.push('The drive is off, so neither mode vibrates and the tip sits still on the strip.');
    lines.push(`The spring preload keeps the tip pressed on the ceramic strip, so friction holds the ${part}: it is self-locking with no power and no magnetic field.`);
    if (s.exploded) lines.push('Exploded view: the parts are separated along the motor axis, so nothing touches.');
    return lines;
  }

  lines.push(`Two standing-wave modes ring at the same ${fmt(s.f, 1)} kHz: the expansion mode moves the tip into the strip, and the bending mode moves it along the strip.`);

  if (absP > 75 && absP < 105) {
    lines.push(`With the modes ${fmt(s.phase)}° apart, the tip traces an ellipse. It presses into the strip while sweeping ${s.phase > 0 ? fwd : back}, then lifts off for the return stroke.`);
  } else if (absP < 12 || absP > 168) {
    lines.push(`At ${fmt(s.phase)}° the two modes are ${absP < 12 ? 'in phase' : 'in anti-phase'}, so the "ellipse" collapses to a slanted line. The tip pushes forward exactly as much as it pushes back.`);
  } else {
    lines.push(`At ${fmt(s.phase)}° the ellipse is tilted and thinner. Part of each contact pushes the wrong way, so the useful drive falls to about ${fmt(Math.abs(sinP) * 100)}% of the ±90° value.`);
  }

  if (s.exploded) {
    lines.push(`Exploded view: the tip still vibrates, but with no contact there is nothing to push, so the ${part} stays put.`);
  } else if (s.step === 0) {
    lines.push(`The drive is too weak to beat the friction and load, so the ${part} holds still. Flip the phase sign to reverse.`);
  } else {
    lines.push(`Friction acts only on the push half, so the ${part} moves ${dir} by about ${fmt(Math.abs(s.step) * 1000)} nm per cycle, which is ${fmt(Math.abs(s.speed))} mm/s at ${fmt(s.f * 1000)} cycles per second.`);
  }

  if (s.R < 0.5) {
    lines.push(`At ${fmt(s.f, 1)} kHz the drive is ${fmt(Math.abs(s.f - F0_KHZ), 1)} kHz off this example's ${F0_KHZ} kHz resonance (Xeryon motors resonate somewhere in 80–180 kHz). The modes barely respond, so the ellipse and the speed collapse.`);
  } else if (!s.exploded) {
    lines.push('Amplitude sets the size of the ellipse, and with it the speed and force. Because the drive frequency is ultrasonic, the motor is silent.');
  }
  return lines.slice(0, 5);
}
