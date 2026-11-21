// Listen to the frame: plays the audible part (20 Hz – 20 kHz) of the simulated frame
// vibration at the real drive frequency. Harmonics above 20 kHz are dropped, so the
// ultrasonic drive plays nothing at all, which is the point.
import { P } from './model.js';

const REF_DB = 125; // level that plays at full volume (dB(A) re 1 nm/s); louder is clipped
let ac = null;
let osc = null;
let gain = null;

export function soundOn() { return !!ac && ac.state === 'running'; }

export async function toggleSound(res) {
  if (soundOn()) {
    await ac.suspend();
    return false;
  }
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(ac.destination);
  }
  await ac.resume();
  updateSound(res);
  return true;
}

export function updateSound(res) {
  if (!ac || !res) return;
  const f = res.params.f;
  const nyq = Math.min(P.AUDIBLE[1], ac.sampleRate / 2);
  const audible = res.spectrum.filter((h) => h.f >= P.AUDIBLE[0] && h.f <= nyq);
  const t = ac.currentTime;
  if (osc) { osc.stop(t + 0.03); osc = null; }
  if (!audible.length || !Number.isFinite(res.audibleDb)) {
    gain.gain.setTargetAtTime(0, t, 0.02);
    return;
  }
  const n = Math.round(audible[audible.length - 1].f / f) + 1;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (const h of audible) {
    const k = Math.round(h.f / f);
    re[k] = h.V * Math.cos(h.phase);
    im[k] = h.V * Math.sin(h.phase);
  }
  osc = ac.createOscillator();
  osc.setPeriodicWave(ac.createPeriodicWave(re, im)); // normalised; level set by gain below
  osc.frequency.value = f;
  osc.connect(gain);
  osc.start(t);
  const level = Math.min(1, 10 ** ((res.audibleDb - REF_DB) / 20));
  gain.gain.setTargetAtTime(0.3 * level, t, 0.03);
}
