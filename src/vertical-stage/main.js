import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './style.css';
import {
  G, DRIVE_N, HOLD_N, SPEC_FRACTION, STROKE, COMP_PRESETS,
  movingMass, compForce, weight, behaviour, specRange, speedAgainst, netLoad,
} from './physics.js';
import { buildScene, helixGeometry, CAR_Y0, CAR_H, COL_TOP, CONTACT_Y, STRIP_X } from './scene.js';
import { createChart } from './chart.js';
import { captions } from './captions.js';

// ---------- State ----------
const state = {
  payload: 150,        // g
  comp: 'off',         // key of COMP_PRESETS
  type: 'spring',      // 'spring' | 'magnet'
  powered: true,
  cmd: 'shuttle',      // 'up' | 'hold' | 'down' | 'shuttle'
  slow: 0.1,           // shown speed / real speed
  paused: false,
  arrows: true,
};
let z = STROKE / 2;    // carriage height, mm (real)
let vSlip = 0;         // mm/s while the contact is slipping
let shuttleDir = 1;
let stallTime = 0;     // display seconds spent stalled while shuttling
let tipPhase = 0;
const SAG_SHOW = 1000; // display exaggeration of the µm-level elastic sag

const compG = () => COMP_PRESETS[state.comp];

// ---------- Renderer / camera ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
app.appendChild(labelRenderer.domElement);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 1, 1200);
// Portrait screens need the camera further back to fit the whole stage.
const portrait = window.innerWidth / window.innerHeight < 0.8;
const HOME = { pos: new THREE.Vector3(120, 120, 300).multiplyScalar(portrait ? 1.7 : 1), target: new THREE.Vector3(-6, portrait ? 50 : 66, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 60;
controls.maxDistance = 900;
controls.update();

const S = buildScene(renderer);

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const drawChart = createChart($('chart'));
const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

// Slow-motion slider is logarithmic: 0..1000 -> 0.02..1
const SLOW_MIN = 0.02;
const slowTo = (v) => SLOW_MIN * Math.pow(1 / SLOW_MIN, v / 1000);
const slowFrom = (r) => (1000 * Math.log(r / SLOW_MIN)) / Math.log(1 / SLOW_MIN);

const payloadEl = $('payload');
payloadEl.value = state.payload;
payloadEl.addEventListener('input', () => { state.payload = Number(payloadEl.value); syncHud(); });
const slowEl = $('slow');
slowEl.value = slowFrom(state.slow);
slowEl.addEventListener('input', () => { state.slow = slowTo(Number(slowEl.value)); syncHud(); });
document.querySelectorAll('[data-payload]').forEach((b) => {
  b.addEventListener('click', () => setPayload(Number(b.dataset.payload)));
});
function setPayload(p) {
  state.payload = p;
  payloadEl.value = p;
  syncHud();
}

function setSeg(group, value) {
  document.querySelectorAll(`[data-seg="${group}"] button`).forEach((b) => {
    b.classList.toggle('on', b.dataset.value === String(value));
  });
}
document.querySelectorAll('[data-seg]').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const g = seg.dataset.seg;
    const v = b.dataset.value;
    if (g === 'powered') state.powered = v === 'on';
    if (g === 'cmd') setCmd(v);
    if (g === 'comp') state.comp = v;
    if (g === 'type') state.type = v;
    syncHud();
  });
});
function setCmd(v) {
  state.cmd = v;
  stallTime = 0;
  if (v === 'up') shuttleDir = 1;
  if (v === 'down') shuttleDir = -1;
}
$('pause').addEventListener('click', () => { state.paused = !state.paused; syncHud(); });
$('arrows').addEventListener('click', () => { state.arrows = !state.arrows; syncHud(); });
$('reset').addEventListener('click', () => {
  camera.position.copy(HOME.pos);
  controls.target.copy(HOME.target);
  controls.update();
});

const COMP_ORDER = ['off', 'mc1', 'mc2', 'max'];
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.code === 'Space') e.preventDefault();
  switch (e.key.toLowerCase()) {
    case 'arrowup': setCmd('up'); break;
    case 'arrowdown': setCmd('down'); break;
    case 'h': setCmd('hold'); break;
    case 'm': setCmd('shuttle'); break;
    case 'p': state.powered = !state.powered; break;
    case 'c': state.comp = COMP_ORDER[(COMP_ORDER.indexOf(state.comp) + 1) % COMP_ORDER.length]; break;
    case ' ': state.paused = !state.paused; break;
    default: return;
  }
  e.preventDefault();
  syncHud();
});

// Command the motor is following right now (shuttle resolves to up/down).
function activeCmd() {
  if (state.cmd === 'shuttle') return shuttleDir > 0 ? 'up' : 'down';
  return state.cmd;
}

function derived() {
  const cg = compG();
  const b = behaviour({ payloadG: state.payload, compG: cg, type: state.type, z, cmd: activeCmd(), powered: state.powered });
  const W = weight(state.payload, cg);
  const C = compForce(cg, state.type, z);
  const range = specRange(cg, state.type);
  const vUp = speedAgainst(b.F);
  const vDown = speedAgainst(-b.F);
  const atBottom = z <= 0.001;
  const atTop = z >= STROKE - 0.001;
  return { ...b, W, C, range, vUp, vDown, atBottom, atTop, compG: cg, m: movingMass(state.payload, cg) };
}

const BAR_MAX = 8; // N, full width of the force bars
{
  document.querySelector('.lim.spec').style.left = `${(SPEC_FRACTION * DRIVE_N / BAR_MAX) * 100}%`;
  document.querySelector('.lim.drive').style.left = `${(DRIVE_N / BAR_MAX) * 100}%`;
}

const STATUS_TEXT = {
  moving: 'moving',
  holding: 'holding (closed loop)',
  stalled: 'stalled',
  overloaded: 'overloaded: slipping',
  locked: 'unpowered: self-locked',
  slipping: 'unpowered: slipping',
};

let lastCaption = '';
function syncHud() {
  const d = derived();
  setSeg('powered', state.powered ? 'on' : 'off');
  setSeg('cmd', state.cmd);
  setSeg('comp', state.comp);
  setSeg('type', state.type);
  document.body.classList.toggle('comp-off', state.comp === 'off');
  $('pause').textContent = state.paused ? 'Play' : 'Pause';
  $('pause').classList.toggle('on', state.paused);
  $('arrows').classList.toggle('on', state.arrows);

  $('payload-val').textContent = `${fmt(state.payload)} g`;
  $('comp-val').textContent = d.compG ? `carries ${fmt(d.compG)} g` : 'none';
  $('slow-val').textContent = state.slow >= 0.995 ? 'real time' : `${fmt(state.slow, state.slow < 0.1 ? 2 : 1)}×`;

  const pct = (f) => `${Math.min(100, (Math.abs(f) / BAR_MAX) * 100)}%`;
  $('bar-w').style.width = pct(d.W);
  $('bar-c').style.width = pct(d.C);
  $('bar-n').style.width = pct(d.F);
  const absF = Math.abs(d.F);
  $('bar-n').className = `bar n ${absF > DRIVE_N ? 'bad' : absF > SPEC_FRACTION * DRIVE_N ? 'tight' : 'ok'}`;
  $('v-w').textContent = `${fmt(d.W, 2)} N`;
  $('v-c').textContent = `${fmt(d.C, 2)} N`;
  $('v-n').textContent = `${fmt(absF, 2)} N ${absF < 0.005 ? '' : d.F > 0 ? '↓' : '↑'}`;

  $('r-range').textContent = d.range ? `${fmt(d.range.lo)} – ${fmt(d.range.hi)} g` : 'none';
  $('r-speed').textContent = `${fmt(d.vUp)} / ${fmt(d.vDown)} mm/s`;
  $('r-off').textContent = absF <= HOLD_N
    ? `holds · sags ${fmt(absF, 2)} µm`
    : `slips (${fmt(absF, 1)} N > ${fmt(HOLD_N)} N)`;
  $('r-z').textContent = `${fmt(z, 1)} of ${STROKE} mm`;

  const badge = $('status-badge');
  badge.textContent = STATUS_TEXT[d.status] + (d.status === 'slipping' || d.status === 'overloaded' ? (d.atBottom || d.atTop ? ', on end stop' : '') : '');
  badge.className = `badge ${['stalled', 'overloaded', 'slipping'].includes(d.status) ? 'warn' : d.status === 'locked' ? 'lock' : ''}`;

  const html = captions({ ...state, ...d, z }).map((l) => `<p>${l}</p>`).join('');
  if (html !== lastCaption) {
    $('captions').innerHTML = html;
    lastCaption = html;
  }
  return d;
}

// ---------- Animation ----------
const clock = new THREE.Clock();
let hudTimer = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  let d = derived();

  if (!state.paused) {
    const dtReal = dt * state.slow; // real seconds that pass this frame
    if (d.v !== null) {
      vSlip = 0;
      z += d.v * dtReal;
    } else {
      vSlip += d.accel * 1000 * dtReal; // m/s² → mm/s²
      z += vSlip * dtReal;
    }
    if (z <= 0) { z = 0; vSlip = 0; }
    if (z >= STROKE) { z = STROKE; vSlip = 0; }

    // Shuttle: reverse at the ends, or after a second of stalling.
    if (state.cmd === 'shuttle') {
      if (shuttleDir > 0 && z >= STROKE - 0.5) shuttleDir = -1;
      else if (shuttleDir < 0 && z <= 0.5) shuttleDir = 1;
      stallTime = d.status === 'stalled' ? stallTime + dt : 0;
      if (stallTime > 1.2) { shuttleDir = -shuttleDir; stallTime = 0; }
    }
    // Commanded up/down stop at the end of travel and hold there.
    if ((state.cmd === 'up' && z >= STROKE) || (state.cmd === 'down' && z <= 0)) setCmd('hold');

    // Tip: shown ellipse whenever the motor is driving.
    const driving = state.powered && (d.status === 'moving' || d.status === 'stalled' || d.status === 'overloaded');
    if (driving) tipPhase += dt * 2 * Math.PI * 3;
  }
  hudTimer += dt;
  if (hudTimer > 0.1) { d = syncHud(); hudTimer = 0; }

  // Carriage position (+ elastic sag, exaggerated, while self-locked)
  const sagMm = d.status === 'locked' ? (d.sagUm * 1e-3 * SAG_SHOW) : 0;
  const carY = CAR_Y0 + z - sagMm;
  S.carriage.position.y = carY;

  // Payload block: brass (8.5 g/cm³) cube at true size
  const side = 10 * Math.cbrt(state.payload / 8.5);
  S.payload.visible = state.payload > 0;
  S.payload.scale.set(side, side, side);
  S.payload.position.set(0, CAR_H + 3 + side / 2, 12);
  S.payloadLabel.position.set(0, CAR_H + 3 + side + 7, 12);
  S.payloadLabel.element.textContent = `payload ${fmt(state.payload)} g`;
  S.payloadLabel.visible = state.payload > 0;

  // Tip ellipse (display only; the real one is ~1 µm at ultrasonic frequency)
  const moving = state.powered && d.status !== 'holding';
  const dir = activeCmd() === 'up' ? 1 : -1;
  const A = moving && !state.paused ? 0.9 : 0;
  S.tip.position.set(A * 0.5 * (Math.sin(tipPhase + (dir * Math.PI) / 2) - 1), A * Math.sin(tipPhase), 0);

  // Compensation hardware
  const lugTop = carY + CAR_H;
  const showComp = d.compG > 0;
  S.spring.visible = showComp && state.type === 'spring';
  S.magnet.visible = showComp && state.type === 'magnet';
  S.coil.position.y = lugTop;
  const springLen = Math.round((COL_TOP - lugTop) * 4) / 4; // rebuild the coil (wire stays round) when its length changes
  if (springLen !== S.coil.userData.len) {
    S.coil.geometry.dispose();
    S.coil.geometry = helixGeometry(3.6, 0.45, 14, springLen);
    S.coil.userData.len = springLen;
  }
  S.hookTop.position.y = COL_TOP - 1;
  S.magBlock.position.set(S.LUG_X + 3.5, lugTop - 7, 0);
  S.compLabel.visible = showComp;
  S.compLabel.position.set(S.LUG_X + 16, lugTop + 22, 0);
  S.compLabel.element.textContent = state.type === 'spring'
    ? `tension spring · ${fmt(d.C, 2)} N`
    : `magnetic counterforce · ${fmt(d.C, 2)} N`;

  // Force arrows
  for (const a of Object.values(S.arrows)) a.visible = state.arrows;
  if (state.arrows) {
    S.arrows.weight.position.set(0, CAR_H + 3 + carY - 2, 30);
    S.arrows.weight.setForce(-d.W);
    S.arrows.comp.position.set(S.LUG_X, lugTop - 6, 8);
    S.arrows.comp.setForce(d.C);
    S.arrows.net.position.set(STRIP_X - 0.5, CONTACT_Y, 9);
    S.arrows.net.setForce(-d.F);
    S.netLabel.element.textContent = `${fmt(Math.abs(d.F), 2)} N on the contact`;
    S.netLabel.position.set(-6, -Math.sign(d.F || 1) * (Math.abs(d.F) * 9 + 6), 0);
  }
  S.arrows.comp.visible = state.arrows && d.C > 0;

  // Sag note
  S.sagLabel.visible = d.status === 'locked' && Math.abs(d.sagUm) > 0.02;
  S.sagLabel.element.textContent = `elastic sag ${fmt(Math.abs(d.sagUm), 2)} µm (shown ×${SAG_SHOW})`;

  drawChart({
    payload: state.payload, compG: d.compG, type: state.type, z, F: d.F, range: d.range,
  });

  controls.update();
  renderer.render(S.scene, camera);
  labelRenderer.render(S.scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug/test hook for automated checks.
window.__vstage = {
  state, setPayload, setCmd, syncHud, camera, controls,
  get z() { return z; }, set z(v) { z = v; },
  netLoad: () => netLoad(state.payload, compG(), state.type, z),
  G,
};

syncHud();
tick();
