import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css';
import { P, DRIVES, simulate, holdingForce } from './model.js';
import { buildScene, RING_PITCH } from './scene.js';
import { createWavePlot, createSpectrumPlot, fmtHz, fmtTime } from './plots.js';
import { captions } from './captions.js';
import { toggleSound, updateSound, soundOn } from './sound.js';

// ---------- State ----------
// Each drive keeps its own settings, so the comparison table can show all three at once.
const state = {
  drive: 'stickslip',
  params: Object.fromEntries(Object.entries(DRIVES).map(([k, d]) => [k, { f: d.f, amp: d.amp, shape: d.shape }])),
  load: 0,
  rate: 0.5,      // displayed cycles per second
  paused: false,
};
const UM = 1e6;           // display mm per real metre: 1 µm of motion is shown as 1 mm (1000×)
const FRAME_EXAG = 3e7;   // frame vibration is far smaller still: 1 nm is shown as 0.03 mm
const results = {};       // latest simulation per drive
let u = 0;                // position in the current cycle, 0..1
let travel = 0;           // accumulated rod travel, display mm

// ---------- Renderer ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 800);
const HOME = { pos: new THREE.Vector3(34, 34, 215), target: new THREE.Vector3(0, -6, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 20;
controls.maxDistance = 300;
controls.update();
// Keep the motor between the side panels on wide screens.
function frameView() {
  const w = window.innerWidth;
  camera.setViewOffset(w, window.innerHeight, 0, w > 900 ? 30 : 90, w, window.innerHeight);
}
frameView();

const S = buildScene(renderer);

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const wave = createWavePlot($('wave'));
const spectrum = createSpectrumPlot($('spectrum'));

// Frequency slider is logarithmic: 0..1000 -> 20 Hz .. 300 kHz
const F_MIN = 20;
const F_MAX = 300e3;
const fTo = (v) => F_MIN * (F_MAX / F_MIN) ** (v / 1000);
const fFrom = (f) => (1000 * Math.log(f / F_MIN)) / Math.log(F_MAX / F_MIN);
// Slow-motion slider: 0..1000 -> 0.1 .. 20 displayed cycles/s
const rateTo = (v) => 0.1 * 200 ** (v / 1000);
const rateFrom = (r) => (1000 * Math.log(r / 0.1)) / Math.log(200);

{
  const track = $('freq-track');
  const pct = (f) => `${(fFrom(f) / 10).toFixed(2)}%`;
  const band = track.querySelector('.audible-band');
  band.style.left = pct(P.AUDIBLE[0]);
  band.style.width = `calc(${pct(P.AUDIBLE[1])} - ${pct(P.AUDIBLE[0])})`;
  const tick = (f, cls, title) => {
    const t = document.createElement('span');
    t.className = `tick ${cls}`;
    t.style.left = pct(f);
    t.title = title;
    track.appendChild(t);
  };
  P.FRAME_MODES.forEach((m) => tick(m.f, '', `frame mode ${fmtHz(m.f)}`));
  tick(P.ACT_F0, '', `shear stack / leg resonance ${fmtHz(P.ACT_F0)}`);
  tick(P.US_F0, 'us', `CrossFixx resonance ${fmtHz(P.US_F0)}`);
}

const SHAPE = {
  stickslip: { name: 'Ramp fraction', min: 0.05, max: 0.95, step: 0.01, hint: 'share of the cycle spent on the slow ramp · 0.5 = no motion · <0.5 reverses', fmt: (v) => v.toFixed(2) },
  walking: { name: 'Gait phase φ', min: -180, max: 180, step: 1, hint: 'lift vs push timing of each leg · ±90° sets direction', fmt: (v) => `${v > 0 ? '+' : ''}${v}°` },
  ultrasonic: { name: 'Phase φ', min: -180, max: 180, step: 1, hint: 'between the two modes · ±90° sets direction', fmt: (v) => `${v > 0 ? '+' : ''}${v}°` },
};

function syncSliders() {
  const p = state.params[state.drive];
  const sh = SHAPE[state.drive];
  Object.assign($('shape'), { min: sh.min, max: sh.max, step: sh.step });
  $('shape').value = p.shape;
  $('shape-name').textContent = sh.name;
  $('shape-hint').textContent = sh.hint;
  $('freq').value = fFrom(p.f);
  $('amp').value = p.amp;
  $('load').value = state.load;
  $('rate').value = rateFrom(state.rate);
}

$('freq').addEventListener('input', (e) => { state.params[state.drive].f = fTo(+e.target.value); schedule(state.drive); });
$('amp').addEventListener('input', (e) => { state.params[state.drive].amp = +e.target.value; schedule(state.drive); });
$('shape').addEventListener('input', (e) => { state.params[state.drive].shape = +e.target.value; schedule(state.drive); });
$('load').addEventListener('input', (e) => { state.load = +e.target.value; schedule('all'); });
$('rate').addEventListener('input', (e) => { state.rate = rateTo(+e.target.value); syncHud(); });

function setDrive(d) {
  state.drive = d;
  syncSliders();
  for (const [k, v] of Object.entries(S.drives)) v.group.visible = k === d;
  document.body.classList.toggle('single', DRIVES[d].contacts === 1);
  applyPaths();
  updateSound(results[d]);
  syncHud();
}
document.querySelector('[data-seg="drive"]').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setDrive(b.dataset.value);
});
$('cmp').addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (tr) setDrive(tr.dataset.drive);
});
$('pause').addEventListener('click', () => { state.paused = !state.paused; syncHud(); });
const CLOSE = { pos: new THREE.Vector3(3, 5, 48), target: new THREE.Vector3(0, -1, 0) };
let zoomed = false;
function view(v) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); }
$('reset').addEventListener('click', () => { zoomed = false; view(HOME); syncHud(); });
$('zoom').addEventListener('click', () => { zoomed = !zoomed; view(zoomed ? CLOSE : HOME); syncHud(); });
async function sound() {
  await toggleSound(results[state.drive]);
  syncHud();
}
$('sound').addEventListener('click', sound);
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.code === 'Space') e.preventDefault();
  const k = e.key.toLowerCase();
  if (k === '1') setDrive('stickslip');
  else if (k === '2') setDrive('walking');
  else if (k === '3') setDrive('ultrasonic');
  else if (k === 'm') sound();
  else if (k === 'z') $('zoom').click();
  else if (k === ' ') { state.paused = !state.paused; e.preventDefault(); syncHud(); }
});

// ---------- Simulation scheduling ----------
// Sliders fire many events per frame; run the model at most once per frame per drive.
const pending = new Set();
function schedule(which) {
  if (which === 'all') Object.keys(DRIVES).forEach((d) => pending.add(d));
  else pending.add(which);
  syncHud(true);
}
function runPending() {
  if (!pending.size) return;
  // current drive first; the others (for the table) follow on later frames
  const d = pending.has(state.drive) ? state.drive : pending.values().next().value;
  pending.delete(d);
  results[d] = simulate(d, { ...state.params[d] }, state.load);
  if (d === state.drive) {
    applyPaths();
    updateSound(results[d]);
  }
  syncHud();
}

function applyPaths() {
  const res = results[state.drive];
  if (!res) return;
  const legs = S.drives[state.drive].legs;
  const colors = [0xffb35c, 0x5fd3ff];
  S.setPaths(res.contacts.map((c, i) => {
    const pts = [];
    for (let k = 0; k < P.STEPS; k += 6) pts.push([legs[i].x0 + c.x[k] * UM, (c.y[k] - c.yTouch) * UM]);
    return { pts, color: colors[i] };
  }), S.drives[state.drive].z);
}

// ---------- HUD text ----------
const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
function fmtSpeed(mms) {
  const a = Math.abs(mms);
  const s = a >= 100 ? fmt(a) : a >= 1 ? fmt(a, 1) : a >= 0.01 ? fmt(a, 2) : '0';
  return `${mms < 0 && s !== '0' ? '−' : ''}${s} mm/s`;
}
function fmtStep(m) {
  const nm = Math.abs(m) * 1e9;
  const s = nm >= 1000 ? `${fmt(nm / 1000, 2)} µm` : `${fmt(nm)} nm`;
  return `${m < 0 && nm >= 0.5 ? '−' : ''}${s} / cycle`;
}
const fmtDb = (db) => (Number.isFinite(db) && db > 0 ? `${fmt(db)} dB(A)` : 'silent');
const fmtWear = (r) => (Number.isFinite(r.workPerMm) && Math.abs(r.speed) > 1e-5 ? `${fmt(r.workPerMm * 1e3, r.workPerMm < 1e-3 ? 2 : 1)} mJ/mm` : 'no travel');

let lastCap = '';
function syncHud(busy = false) {
  const d = state.drive;
  const p = state.params[d];
  const res = results[d];
  document.querySelectorAll('[data-seg="drive"] button').forEach((b) => b.classList.toggle('on', b.dataset.value === d));
  $('pause').textContent = state.paused ? 'Play' : 'Pause';
  $('pause').classList.toggle('on', state.paused);
  $('sound').classList.toggle('on', soundOn());
  $('zoom').classList.toggle('on', zoomed);
  $('sound').textContent = soundOn() ? 'Listening' : 'Listen';

  const audible = p.f >= P.AUDIBLE[0] && p.f <= P.AUDIBLE[1];
  $('freq-val').textContent = `${fmtHz(p.f)}${audible ? ' · audible' : ''}`;
  $('freq-row').classList.toggle('audible', audible);
  $('amp-val').textContent = `${fmt(p.amp, 2)}`;
  $('shape-val').textContent = SHAPE[d].fmt(p.shape);
  $('load-val').textContent = `${fmt(state.load, 2)} N`;
  $('rate-val').textContent = `${fmt(state.rate, state.rate < 1 ? 2 : 1)} cycles/s`;

  $('r-drive').textContent = `${DRIVES[d].label} · ${fmt(p.f)} cycles/s`;
  const slow = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(p.f / state.rate);
  $('r-slow').textContent = `1 cycle = ${fmtTime(1 / p.f)} · slowed ${slow}×`;
  if (res && !busy) {
    $('r-step').textContent = fmtStep(res.step);
    $('r-speed').textContent = fmtSpeed(res.speed * 1e3);
    $('r-db').textContent = fmtDb(res.audibleDb);
    $('r-db').className = Number.isFinite(res.audibleDb) && res.audibleDb > 0 ? 'bad' : 'good';
    $('r-frame').textContent = `${fmt(res.frameRmsNm, res.frameRmsNm < 1 ? 2 : 0)} nm rms`;
    $('r-wear').textContent = `${fmtWear(res)} · ${fmt(res.frictionPower * 1e3, 1)} mW`;
    $('r-hold').textContent = `${fmt(holdingForce(), 1)} N (μ·N preload)`;
  }

  // comparison table
  const rows = Object.keys(DRIVES).map((k) => {
    const r = results[k];
    if (!r) return `<tr data-drive="${k}"><td>${DRIVES[k].label}</td><td colspan="3">…</td></tr>`;
    const mms = Math.abs(r.speed * 1e3);
    const sw = Math.max(0, Math.min(1, (Math.log10(Math.max(mms, 0.01)) + 2) / 5)) * 40; // 0.01..1000 mm/s
    const db = Number.isFinite(r.audibleDb) ? Math.max(0, r.audibleDb) : 0;
    const dw = Math.min(1, db / 130) * 30;
    return `<tr data-drive="${k}" class="${k === d ? 'on' : ''}">
      <td>${DRIVES[k].label}</td>
      <td><span class="bar" style="width:${sw}px"></span>${fmtSpeed(r.speed * 1e3)}</td>
      <td><span class="bar warn" style="width:${dw}px"></span>${fmtDb(r.audibleDb).replace(' dB(A)', '')}</td>
      <td>${fmtWear(r).replace(' mJ/mm', '')}</td></tr>`;
  });
  $('cmp').innerHTML = rows.join('');

  const cap = captions(d, res, results);
  if (cap !== lastCap) { $('captions').innerHTML = cap; lastCap = cap; }
}

// ---------- Animation ----------
const clock = new THREE.Clock();
const red = new THREE.Color(0xff6b8a);
const cyan = new THREE.Color(0x5fd3ff);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  runPending();
  const res = results[state.drive];
  if (res) {
    if (!state.paused) {
      u += state.rate * dt;
      while (u >= 1) { u -= 1; travel += res.step * UM; }
      travel %= RING_PITCH * 1000;
    }
    const k = Math.min(P.STEPS - 1, Math.floor(u * P.STEPS));
    const legs = S.drives[state.drive].legs;
    let lift = 0;
    res.contacts.forEach((c, i) => {
      const dy = state.drive === 'stickslip' ? 0 : (c.y[k] - c.yTouch) * UM;
      legs[i].col.userData.set(c.x[k] * UM, dy);
      lift = Math.max(lift, dy);
      const g = legs[i].glow;
      g.position.set(legs[i].x0 + c.x[k] * UM, -0.6, S.drives[state.drive].z + 0.05);
      const sliding = Math.abs(c.v[k] - res.vr[k]) > 5 * P.V_EPS;
      g.material.color.copy(sliding ? red : cyan);
      g.material.opacity = c.N[k] > 0.05 ? 0.95 : 0;
    });
    const x = travel + res.xr[k] * UM;
    S.rod.position.x = ((x % RING_PITCH) + RING_PITCH) % RING_PITCH;
    S.rod.position.y = 3.5 + Math.max(0, lift);
    S.frame.position.x = res.frameX[k] * FRAME_EXAG;
    wave.draw(res, u);
  }
  controls.update();
  renderer.render(S.scene, camera);
  requestAnimationFrame(frame);
}

let spectrumKey = null;
function drawSpectrum() {
  const res = results[state.drive];
  if (res !== spectrumKey) { spectrum.draw(res); spectrumKey = res; }
  requestAnimationFrame(drawSpectrum);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  frameView();
  camera.updateProjectionMatrix();
  wave.resize();
  spectrum.resize();
  spectrumKey = null;
});

setDrive('stickslip');
schedule('all');
frame();
drawSpectrum();
