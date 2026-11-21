// Short sentences in the left panel that follow the current state.
import { D33, D31, T_MM, E_C, E_MAX_REC, E_MAX_OK, STACK_LAYERS, LAYER_MM, stack } from './physics.js';

const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const um = (v) => (Math.abs(v) < 1 ? `${fmt(v * 1000)} nm` : `${fmt(v, 2)} µm`);
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');

export function captions(s) {
  const lines = [];
  const d33 = fmt(D33 * 1e12); const d31 = fmt(-D31 * 1e12);

  lines.push('A PZT ceramic is a mass of tiny crystals. Below its Curie point each <em>unit cell</em> is slightly stretched and its central Zr/Ti ion sits off-centre, so every cell is a small electric dipole. Neighbouring cells line up in <em>domains</em>: the arrows.');

  if (s.state === 'unpoled') {
    lines.push(`Straight from the kiln, each grain's domain points along one of its own six crystal axes, and the grains point every which way. The dipoles cancel: net polarization ${fmt(s.p * 100)} %. Apply a voltage and the tiny expansions cancel too, so <b>nothing moves</b>. A raw ceramic is not piezoelectric until it is <em>poled</em>.`);
  } else if (s.state === 'partial') {
    lines.push(`Partly poled: ${fmt(Math.abs(s.p) * 100)} % net polarization. Only the grains whose coercive field was exceeded have turned, so the response is that fraction of the full d33 and d31.`);
  } else {
    lines.push(`Poled ${s.p > 0 ? 'up' : 'down'}: a strong DC field turned every domain to the crystal axis closest to it. They can't all point straight ${s.p > 0 ? 'up' : 'down'}, because each grain's axes are fixed, so with randomly oriented grains even a perfectly poled ceramic keeps only about 83 % of a single crystal's polarization (this page calls that 100 %). Remove the field and they stay: <em>remanent polarization</em>.`);
  }

  if (Math.abs(s.p) > 0.1 && Math.abs(s.V) > 1) {
    const along = Math.sign(s.V) === Math.sign(s.p);
    lines.push(`${fmt(Math.abs(s.V))} V across ${fmt(T_MM)} mm is ${fmt(Math.abs(s.E), 2)} kV/mm ${along ? 'along' : 'against'} the poling. Along axis 3 the plate gets ${s.dt > 0 ? 'thicker' : 'thinner'} by <em>d33·V = ${sgn(s.dt)}${um(Math.abs(s.dt))}</em> (d33 = ${d33} pm/V). Sideways, along 1 and 2, it gets ${s.dL < 0 ? 'narrower' : 'wider'} by <em>d31·V·L/t = ${sgn(s.dL)}${um(Math.abs(s.dL))}</em> (d31 = −${d31} pm/V). Same volume, roughly: what grows one way shrinks the other.`);
    lines.push(`Δt depends only on the voltage, not the thickness. To get more stroke from d33 you stack thin layers with electrodes between them: ${STACK_LAYERS} layers of ${fmt(LAYER_MM, 1)} mm reach the same field at only ${fmt(Math.abs(stack(s.E, s.p).V))} V and give ${um(Math.abs(stack(s.E, s.p).dx))}. The <a href="../piezo-drives/">stick-slip drive</a> uses a stack like this, in the shear mode (d15). ΔL grows with L/t (${fmt(s.L / T_MM, 1)} here): the sideways d31 mode wins for long, thin plates, which is what benders and plate motors use.`);
  } else if (Math.abs(s.p) > 0.1) {
    lines.push('Move the voltage slider. A field along the poling makes the plate thicker (d33) and narrower (d31); a field against it does the opposite.');
  }

  if (s.flipped) {
    lines.push(`<b>Repoled.</b> The field against the poling passed the coercive field (about ${fmt(E_C, 1)} kV/mm here), so the domains flipped. The plate is now poled ${s.p > 0 ? 'up' : 'down'}, and a voltage that used to shrink it now makes it <em>expand</em>. That is the butterfly in the chart. In use, keep fields against the poling below Ec: soft PZT depoles easily.`);
  }
  if (Math.abs(s.E) > E_MAX_OK) {
    lines.push(`<b>Over ${fmt(E_MAX_OK)} kV/mm.</b> CTS recommends ${fmt(E_MAX_REC)} kV/mm and calls ${fmt(E_MAX_OK)} normally acceptable with testing. Higher fields cut lifetime drastically.`);
  } else if (Math.abs(s.E) > E_MAX_REC) {
    lines.push(`Above the ${fmt(E_MAX_REC)} kV/mm CTS recommends. Up to ${fmt(E_MAX_OK)} kV/mm is normally acceptable, but test it.`);
  }

  if (s.ac) {
    lines.push('With AC the plate breathes in and out at the drive frequency, shown here slowed to under a hertz. Drive two such vibration modes at an ultrasonic resonance and you have the <a href="../crossfixx/">CrossFixx motor</a>: about a micrometre of tip motion.');
  }
  return lines;
}
