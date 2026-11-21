// The sentences in the left panel. Each drive gets a fixed explanation, then one or two
// sentences that react to what the model is doing right now.
import { P } from './model.js';
import { fmtHz } from './plots.js';

const BASE = {
  stickslip: [
    'Stick-slip (inertia drive): one piezo shear stack, one friction pad, a constant preload. The pad creeps forward slowly and the rod <b>sticks</b> and rides along.',
    'Then the pad snaps back. The rod is too heavy to follow such a fast pull, friction can only supply μ·N, so it <b>slips</b> and stays roughly where it was. Net: one small step per cycle.',
    'The snap-back is a force impulse, rich in harmonics, delivered at a few kHz. That lands in the audible band and on the frame’s own resonances, and every step is paid for by sliding under full preload.',
  ],
  walking: [
    'Walking (piezo-legged) drive: two legs, each bending and stretching in a slow loop, half a cycle apart. One leg always clamps the rod and pushes while the other lifts and returns.',
    'In the ideal case nothing slides, so it is gentle on the contact. But the loop is quasi-static (well below the legs’ resonance), so the drive rate stays in the kHz range and each step is a few µm.',
    'Xeryon: “More durable than stick-slip, good precision” but “relatively slow, complex design.”',
  ],
  ultrasonic: [
    'Ultrasonic standing wave (CrossFixx): one resonator, two vibration modes, about 90° apart. The tip traces a ~1 µm ellipse, pressing on the push stroke and lifting off on the return.',
    'Because it runs at the structure’s resonance, the tip reaches that ellipse with modest voltage, and the cycle repeats well over 100,000 times a second. Small steps, very many of them: hence speed.',
    'Xeryon: “the surrounding mechanics cannot react to the vibrations they generate”, and the motor stays “quiet to the human ear.”',
  ],
};

export function captions(drive, res, cmp) {
  const out = [...BASE[drive]];
  if (!res) return out.map((s) => `<p>${s}</p>`).join('');
  const f = res.params.f;
  const audible = f >= P.AUDIBLE[0] && f <= P.AUDIBLE[1];
  const mms = Math.abs(res.speed * 1e3);
  const nearFrame = P.FRAME_MODES.find((m) => res.spectrum.some((h) => Math.abs(h.f / m.f - 1) < 0.5 / m.q * 2 && h.X > 1e-9));

  const live = [];
  if (drive === 'stickslip') {
    const sh = res.params.shape;
    if (Math.abs(sh - 0.5) < 0.04) live.push('Right now the ramp and the flyback take equally long: no stroke is fast enough to slip, so the rod just shuffles back and forth.');
    else if (mms < 0.05) live.push(`At ${fmtHz(f)} the flyback is too gentle: its acceleration never beats μ·N/m, so the rod follows the pad both ways and gets nowhere.`);
    else if (f > 12e3) live.push(`At ${fmtHz(f)} the stack (first resonance ${fmtHz(P.ACT_F0)}) cannot reproduce a sharp sawtooth any more. The flyback gets rounded off and ringing takes over; step size collapses or even reverses. This is the “prone to resonance effects” Xeryon mentions.`);
    else live.push(`At ${fmtHz(f)}: ${mms.toFixed(1)} mm/s, while sliding dissipates ${(res.workPerMm * 1e3).toFixed(1)} mJ per mm of travel.`);
  }
  if (drive === 'ultrasonic') {
    const off = Math.abs(f - P.US_F0) / P.US_F0 * 2 * P.US_Q;
    if (off > 1) live.push(`Off resonance (${fmtHz(f)}): the modes barely respond, the ellipse shrinks and the motor stalls. It only works in a narrow band around ${fmtHz(P.US_F0)}.`);
    else if (Math.abs(Math.sin(res.params.shape * Math.PI / 180)) < 0.2) live.push('Phase near 0° or 180°: the ellipse flattens into a line, the tip pushes forward and back equally hard, no net motion.');
    else live.push(`${mms.toFixed(0)} mm/s. All harmonics sit above ${fmtHz(f)}: above hearing and far above every frame mode.`);
  }
  if (drive === 'walking' && mms > 0) live.push(`${mms.toFixed(1)} mm/s at ${fmtHz(f)}, ${Math.abs(res.step * 1e6).toFixed(1)} µm per cycle.`);
  if (audible && drive !== 'ultrasonic') live.push(`<b>${fmtHz(f)} is audible</b>${nearFrame ? `, and its harmonics hit the frame mode at ${fmtHz(nearFrame.f)}` : ''}. Turn on Listen to hear the frame.`);
  if (cmp && drive !== 'ultrasonic' && cmp.ultrasonic && mms > 0.01) {
    const ratio = Math.abs(cmp.ultrasonic.speed * 1e3) / mms;
    if (ratio > 3) live.push(`The ultrasonic drive on the same rod: ${Math.round(ratio)}× faster.`);
  }
  return [...out, ...live].map((s) => `<p>${s}</p>`).join('');
}
