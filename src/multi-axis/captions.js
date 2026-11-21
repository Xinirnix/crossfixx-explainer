// The sentences in the left panel. `m` holds live numbers from main.js.
import { fmt } from './inset.js';

export function captions(state, m) {
  const out = [];
  const stack = { XY: 'X carries Y, and Y carries the tool', XYZ: 'X carries Y, Y carries an L-bracket with a vertical Z stage, and Z carries the tool', XYT: 'X carries Y, Y carries a rotary stage, and the rotary carries the tool' }[state.config];
  out.push(`A multi-axis stage built from single stages is a <b>serial stack</b>: ${stack}. Every stage rides on the errors of all the stages below it. (A hexapod moves one platform on six legs in parallel; this page is about stacks.)`);

  if (m.rot) {
    out.push(`No bearing turns perfectly. Besides the rotation you command, the axis wanders sideways (<b>radial run-out</b>), up and down (<b>axial run-out</b>), and tilts (<b>wobble</b>, or tilt error motion). Xeryon quotes the XRT-U-40 with precision bearing at &lt; 1 µm radial, &lt; 0.5 µm axial and &lt; 50 µrad wobble.`);
    const ratio = state.radial > 0 ? ` That is ${(m.rot.um / state.radial).toFixed(1)}× the radial run-out.` : '';
    out.push(`A sideways shift reaches the tip unchanged. A tilt does not: it is multiplied by the distance to the tip, <code>δ = L·ε</code>. ${state.wobble} µrad is only ${(state.wobble * 1e-6 * 180 / Math.PI).toFixed(4)}°, but at L = ${m.rot.L.toFixed(0)} mm from the bearing it moves the tip <b>${fmt(m.rot.um)}</b>.${ratio}`);
    if (state.arm === 'out') out.push(`With the arm sticking out sideways, the tilt mostly lifts and drops the tip once per turn, so the error shows up as height, not position.`);
    else out.push(`With the arm pointing up, the tilt swings the tip in a small circle once per turn. Run-out adds to it or partly cancels it depending on how the two line up (ψ).`);
  }

  out.push(`The same law is <b>Abbe error</b>. A linear stage's encoder measures along its guide. If the carriage pitches or yaws by α while the tip is h away from that line, the tip is off by <code>h·α</code>, and the encoder never sees it. In a stack the bottom stage has the longest lever, because everything above it is the arm: here the X stage's guide is ${m.hX.toFixed(0)} mm from the tip, worth <b>${fmt(m.abbeX)}</b> at α = ${state.lin} µrad.`);
  if (state.config === 'XYZ') out.push(`Z stands on an L-bracket, so an arm from Z puts the tip far from every guide below it, sideways as well as up. Z's own pitch acts over the arm length.`);
  out.push(`Rules that follow: keep the work point close to the axes (short arms, low stacks), put the best angular quality at the bottom of the stack, line the work point up with the measuring axis, and if the tip must be far out, measure at the tip.`);
  out.push(`<span style="color:var(--muted)">Angles and error motions are drawn ×1000 so you can see them; every number is real scale. Linear α is illustrative: check the stage datasheet.</span>`);
  return out.map((t) => `<p>${t}</p>`).join('');
}
