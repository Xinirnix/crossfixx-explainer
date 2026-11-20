import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './style.css';
import { PRESETS, EXAGGERATION, stackGeometry, stageErrors, tipError, tipAt, peakOverRevolution, wobbleLever, norm } from './errors.js';
import { buildWorld, buildStack, polyline, label } from './scene.js';
import { createInset, fmt } from './inset.js';
import { captions } from './captions.js';

// ---------- State ----------
const state = {
  config: 'XYT',   // 'XY' | 'XYZ' | 'XYT'
  arm: 'up',       // 'up' | 'out'
  length: 100,     // mm, arm length beyond the 4 mm clamp
  wobble: 50,      // µrad, rotary tilt error motion
  radial: 1,       // µm
  axial: 0.5,      // µm
  phase: 0,        // deg, run-out direction relative to wobble
  lin: 20,         // µrad, pitch and yaw of each linear stage (illustrative)
  paused: false,
};
const REV_PER_S = 0.2; // displayed rotation speed
let theta = 0;
const params = () => ({ wobble: state.wobble, radial: state.radial, axial: state.axial, phase: state.phase, linAngle: state.lin });

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

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 40;
controls.maxDistance = 1200;
const scene = buildWorld(renderer);

// ---------- Stack (rebuilt when config, arm direction or length changes) ----------
let geo, stack;
const trail = polyline(0xffb35c, 240);
const lever = polyline(0xffffff, 2, { dashed: true });
const leverLabel = label('', 'note');
scene.add(trail, lever, leverLabel);
let trailPts = [];

function rebuild() {
  if (stack) {
    scene.remove(stack.root);
    stack.root.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); });
  }
  geo = stackGeometry(state.config, { length: state.length, dir: state.arm });
  stack = buildStack(geo, state.arm, state.length);
  scene.add(stack.root);
  trailPts = [];
  document.body.classList.toggle('no-rotary', state.config !== 'XYT');
}

function frameCamera() {
  // Fit the nominal stack plus tip into the view, looking down from front-right.
  const box = new THREE.Box3().setFromObject(stack.root).expandByPoint(new THREE.Vector3(...geo.tip));
  if (geo.axis) for (let i = 0; i < 8; i++) box.expandByPoint(new THREE.Vector3(...tipAt(geo, (i * Math.PI) / 4))); // swept arm
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = 0.5 * Math.hypot(size.x, size.y, size.z);
  const vHalf = (camera.fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const narrow = window.innerWidth < 900; // phones: the free band between panels is short
  const d = (r / Math.sin(Math.min(vHalf, hHalf))) * (narrow ? 1.7 : 1.05);
  const dir = new THREE.Vector3(0.55, 0.38, 0.75).normalize();
  if (narrow) c.y += size.y * 0.18; // push the stack below the readout card
  controls.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, d);
  controls.update();
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const drawInset = createInset($('inset'));
const sliders = {};
function bind(id, key, fmtVal, rebuildOn = false) {
  const el = $(id);
  el.value = state[key];
  sliders[key] = el;
  el.addEventListener('input', () => {
    state[key] = Number(el.value);
    if (rebuildOn) rebuild();
    clearPreset();
    syncHud();
  });
  return (v) => ($(`${id}-val`).textContent = fmtVal(v));
}
const shows = {
  wobble: bind('wobble', 'wobble', (v) => `${v} µrad`),
  length: bind('arm', 'length', (v) => `${v} mm`, true),
  radial: bind('radial', 'radial', (v) => `${Number(v).toFixed(2)} µm`),
  axial: bind('axial', 'axial', (v) => `${Number(v).toFixed(2)} µm`),
  phase: bind('phase', 'phase', (v) => `${v}°`),
  lin: bind('lin', 'lin', (v) => `${v} µrad`),
};

function setSeg(name, value) {
  document.querySelectorAll(`.seg[data-seg='${name}'] button`).forEach((b) => b.classList.toggle('on', b.dataset.value === value));
}
function clearPreset() {
  const hit = Object.entries(PRESETS).find(([, v]) => v.radial === state.radial && v.axial === state.axial && v.wobble === state.wobble);
  setSeg('preset', hit ? hit[0] : '');
}
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  const seg = b.parentElement.dataset.seg;
  if (seg === 'config') { state.config = b.dataset.value; rebuild(); frameCamera(); }
  if (seg === 'arm') { state.arm = b.dataset.value; rebuild(); frameCamera(); }
  if (seg === 'preset') {
    Object.assign(state, PRESETS[b.dataset.value]);
    for (const k of ['wobble', 'radial', 'axial']) sliders[k].value = state[k];
  }
  syncHud();
}));
$('pause').addEventListener('click', () => { state.paused = !state.paused; syncHud(); });
$('reset').addEventListener('click', frameCamera);

let model; // cached per-turn analysis, recomputed when inputs change
function analyse() {
  const p = params();
  const turn = peakOverRevolution(geo, p);
  // Peak contribution of each stage over one turn, split into translation and tilt × lever.
  const parts = geo.stages.map((s) => ({ s, rot: 0, t: 0, L: 0 }));
  for (let i = 0; i < 72; i++) {
    const th = (i / 72) * Math.PI * 2;
    tipError(geo, th, p).parts.forEach((c, k) => {
      parts[k].rot = Math.max(parts[k].rot, norm(c.rot));
      parts[k].t = Math.max(parts[k].t, norm(c.err.t));
      parts[k].L = Math.max(parts[k].L, norm(c.lever));
    });
  }
  // Classic Abbe case: X-stage pitch α acting over the tip's height h above the X guide.
  const hX = geo.tip[1] - geo.stages[0].pivot[1];
  return { p, turn, parts, rot: wobbleLever(geo, p), hX, abbeX: hX * state.lin * 1e-3 };
}

function syncHud() {
  Object.entries(shows).forEach(([k, f]) => f(state[k]));
  setSeg('config', state.config);
  setSeg('arm', state.arm);
  $('pause').textContent = state.paused ? 'Play' : 'Pause';
  model = analyse();
  const m = model;

  // Headline formula
  if (m.rot) {
    $('formula').innerHTML = `δ = L·ε = ${m.rot.L.toFixed(1)} mm × ${state.wobble} µrad<br><span class="big">= ${fmt(m.rot.um)}</span><span class="sub">wobble alone, bearing centre to tip</span>`;
  } else {
    $('formula').innerHTML = `δ = h·α = ${m.hX.toFixed(1)} mm × ${state.lin} µrad<br><span class="big">= ${fmt(m.abbeX)}</span><span class="sub">Abbe error from X-stage pitch alone</span>`;
  }

  // Per-stage budget (peak over a turn)
  const rows = [];
  for (const q of m.parts) {
    if (q.s.kind === 'rotary') {
      rows.push([`θ wobble · ${q.L.toFixed(0)} mm`, q.rot]);
      rows.push(['θ run-out', q.t]);
    } else {
      rows.push([`${q.s.id} pitch/yaw · ${q.L.toFixed(0)} mm`, q.rot]);
    }
  }
  const big = Math.max(...rows.map((r) => r[1]), 1e-9);
  $('parts').innerHTML = rows.map(([n, v]) => `<dt>${n}</dt><dd><span class="bar" style="width:${(52 * v) / big}px"></span>${fmt(v)}</dd>`).join('');
  $('r-peak').textContent = fmt(m.turn.peak);
  $('r-split').textContent = `${fmt(m.turn.lat)} / ${fmt(m.turn.vert)}`;
  $('captions').innerHTML = captions(state, m);
}

// ---------- Keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
  const k = e.key.toLowerCase();
  const cfg = { 1: 'XY', 2: 'XYZ', 3: 'XYT' }[k];
  if (cfg) { state.config = cfg; rebuild(); frameCamera(); }
  else if (k === 'u') { state.arm = 'up'; rebuild(); frameCamera(); }
  else if (k === 'o') { state.arm = 'out'; rebuild(); frameCamera(); }
  else if (k === ' ') { e.preventDefault(); state.paused = !state.paused; }
  else if (k === 'r') frameCamera();
  else return;
  syncHud();
});

// ---------- Animation ----------
const K = EXAGGERATION;
const tmp = new THREE.Vector3();
const clock = new THREE.Clock();
function applyErrors(p) {
  for (const f of stack.frames) {
    const err = stageErrors(f.stage, theta, p);
    const pv = f.stage.pivot;
    f.outer.position.set(pv[0] + err.t[0] * 1e-3 * K, pv[1] + err.t[1] * 1e-3 * K, pv[2] + err.t[2] * 1e-3 * K);
    f.outer.rotation.set(err.omega[0] * 1e-6 * K, err.omega[1] * 1e-6 * K, err.omega[2] * 1e-6 * K);
  }
  if (stack.spin) stack.spin.rotation.y = theta;
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.paused && geo.axis) theta += dt * REV_PER_S * Math.PI * 2;
  const p = model.p;
  applyErrors(p);

  const nominal = tipAt(geo, theta);
  stack.ghost.position.set(...nominal);
  stack.root.updateMatrixWorld(true);
  stack.tipMesh.getWorldPosition(tmp);

  // Trail of the (exaggerated) tip over the last turn
  trailPts.push(tmp.x, tmp.y, tmp.z);
  if (trailPts.length > 240 * 3) trailPts.splice(0, 3);
  trail.geometry.attributes.position.array.set(trailPts);
  trail.geometry.attributes.position.needsUpdate = true;
  trail.geometry.setDrawRange(0, trailPts.length / 3);

  // Lever-arm dimension line: from the rotary bearing (or the X guide) to the tip
  // (no rotary: the Abbe offset h, drawn straight down from the tip to the X guide's height)
  const rotSt = geo.stages.find((s) => s.kind === 'rotary');
  const from = rotSt ? rotSt.pivot : [tmp.x, geo.stages[0].pivot[1], tmp.z];
  const lp = lever.geometry.attributes.position.array;
  lp.set([from[0], from[1], from[2], tmp.x, tmp.y, tmp.z]);
  lever.geometry.attributes.position.needsUpdate = true;
  lever.geometry.setDrawRange(0, 2);
  lever.computeLineDistances();
  leverLabel.position.set((from[0] + tmp.x) / 2 + 6, (from[1] + tmp.y) / 2, (from[2] + tmp.z) / 2);
  leverLabel.element.textContent = model.rot ? `L = ${model.rot.L.toFixed(0)} mm` : `h = ${model.hX.toFixed(0)} mm`;

  const now = tipError(geo, theta, p).total;
  $('r-now').textContent = fmt(norm(now));
  drawInset({ path: model.turn.path, now, theta, radial: state.radial, hasRotary: !!geo.axis });

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

rebuild();
frameCamera();
syncHud();
clearPreset();
requestAnimationFrame(tick);
