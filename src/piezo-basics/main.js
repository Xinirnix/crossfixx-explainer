import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import './style.css';
import {
  T_MM, L_DEFAULT, SHOW, D33, D31, stack,
  fieldKVmm, changes, createDomains, applyField, pole, depole,
} from './physics.js';
import { buildScene, GRID } from './scene.js';
import { createChart } from './chart.js';
import { createCell } from './cell.js';
import { captions, um } from './captions.js';

// ---------- State ----------
const state = {
  V: 600,          // V across the plate (DC level, or AC amplitude)
  L: L_DEFAULT,    // plate width and depth, mm
  ac: true,
  paused: false,
};
const AC_HZ = 0.35; // shown drive frequency (slowed down)
const N = GRID.nx * GRID.ny * GRID.nz;
const D = createDomains(N);
let lastSwitch = 0;   // time of last field-driven flip of the net polarization
let polingFlash = 0;
let flipped = false;
let pSign = 0;

// Animated arrow directions follow each grain's target axis with a small random delay.
const dirs = D.grains.map((g) => new THREE.Vector3(...g.axes[g.dir]));
const target = D.grains.map((g) => g.dir);
const startAt = new Float32Array(N);
let time = 0;
function retarget(stagger = 0.8) {
  D.grains.forEach((g, i) => {
    if (target[i] !== g.dir) { target[i] = g.dir; startAt[i] = time + g.rand * stagger; }
  });
}
const tmp = new THREE.Vector3();
const side = new THREE.Vector3();
function animateDomains(dt) {
  let sum = 0;
  D.grains.forEach((g, i) => {
    if (time >= startAt[i]) {
      tmp.set(...g.axes[target[i]]);
      // A 180° flip would lerp straight through zero and never turn; nudge it via a 90° axis first.
      if (dirs[i].dot(tmp) < -0.95) dirs[i].addScaledVector(side.set(...g.axes[((target[i] % 3) + 1) % 3]), 0.4);
      dirs[i].lerp(tmp, 1 - Math.exp(-dt * 9)).normalize();
    }
    sum += dirs[i].y;
  });
  return sum / N / D.poledMean;
}

// ---------- Renderer / camera ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
app.appendChild(labelRenderer.domElement);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 200);
const portrait = window.innerWidth / window.innerHeight < 0.8;
const HOME = { pos: new THREE.Vector3(9.5, 6.5, 14.5).multiplyScalar(portrait ? 1.8 : 1), target: new THREE.Vector3(portrait ? 0 : 0.4, portrait ? -1.2 : -0.2, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 60;
controls.update();

const S = buildScene(renderer, N);

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const chart = createChart($('chart'));
const drawCell = createCell($('cell'));
const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

const vEl = $('volt');
vEl.value = state.V;
vEl.addEventListener('input', () => { state.V = Number(vEl.value); });
document.querySelectorAll('[data-volt]').forEach((b) => b.addEventListener('click', () => setV(Number(b.dataset.volt))));
function setV(v) { state.V = v; vEl.value = v; }
const lEl = $('width');
lEl.value = state.L;
lEl.addEventListener('input', () => { state.L = Number(lEl.value); });

function setSeg(group, value) {
  document.querySelectorAll(`[data-seg="${group}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.value === String(value)));
}
document.querySelectorAll('[data-seg]').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (seg.dataset.seg === 'poling') (b.dataset.value === 'poled' ? doPole : doDepole)();
    if (seg.dataset.seg === 'drive') state.ac = b.dataset.value === 'ac';
  });
});
function doPole() { pole(D, 1); retarget(); polingFlash = 1.6; flipped = false; chart.clear(); }
function doDepole() { depole(D); retarget(); flipped = false; chart.clear(); }
$('pause').addEventListener('click', () => { state.paused = !state.paused; });
$('reset').addEventListener('click', () => { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.update(); });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
  const k = e.key.toLowerCase();
  if (k === 'p') doPole();
  else if (k === 'u') doDepole();
  else if (k === 'a') state.ac = !state.ac;
  else if (k === '0') setV(0);
  else if (e.key === ' ') { state.paused = !state.paused; e.preventDefault(); }
});

function syncHud(s) {
  setSeg('poling', s.state === 'unpoled' ? 'unpoled' : s.state === 'poled' ? 'poled' : '');
  setSeg('drive', state.ac ? 'ac' : 'dc');
  $('pause').classList.toggle('on', state.paused);
  $('volt-val').textContent = `${state.ac ? '±' : ''}${fmt(state.V)} V · ${fmt(Math.abs(fieldKVmm(state.V)), 2)} kV/mm`;
  $('width-val').textContent = `${fmt(state.L, 1)} mm · L/t ${fmt(state.L / T_MM, 1)}`;
  const badge = $('status-badge');
  badge.textContent = s.state === 'unpoled' ? 'unpoled' : s.state === 'partial' ? 'partly poled' : `poled ${s.p > 0 ? '↑' : '↓'}`;
  badge.className = `badge ${s.state === 'unpoled' ? 'warn' : s.state === 'partial' ? 'lock' : ''}`;

  $('r-e').textContent = `${fmt(s.E, 2)} kV/mm`;
  $('r-p').textContent = `${fmt(s.p * 100)} %`;
  $('r-dt').textContent = `${s.dt >= 0 ? '+' : '−'}${um(Math.abs(s.dt))}`;
  $('r-dl').textContent = `${s.dL >= 0 ? '+' : '−'}${um(Math.abs(s.dL))}`;
  $('r-s').textContent = `${fmt(s.S3 * 1e6)} / ${fmt(s.S1 * 1e6)} µε`;
  const st = stack(s.E, s.p);
  $('r-stack').textContent = `${um(Math.abs(st.dx))} at ${fmt(Math.abs(st.V))} V`;
  $('bar-t').style.width = `${Math.min(100, (Math.abs(s.dt) / 1.6) * 100)}%`;
  $('bar-l').style.width = `${Math.min(100, (Math.abs(s.dL) / 1.6) * 100)}%`;
  // With AC the captions quote the peak, so the text (and its links) stays still.
  const c = state.ac ? { ...s, V: state.V, E: fieldKVmm(state.V), ...peak(s.p) } : s;
  const html = captions(c).map((l) => `<p>${l}</p>`).join('');
  if (html !== lastCaption) { $('captions').innerHTML = html; lastCaption = html; }
}
const peak = (p) => { const { dt, dL } = changes(state.V, p, state.L); return { dt, dL }; };
let lastCaption = '';
$('coeffs').textContent = `d33 = ${fmt(D33 * 1e12)} pm/V, d31 = ${fmt(D31 * 1e12)} pm/V, t = ${fmt(T_MM)} mm`;

// ---------- Loop ----------
const clock = new THREE.Clock();
let hudTimer = 1;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!state.paused) time += dt;
  polingFlash = Math.max(0, polingFlash - dt);

  const V = state.ac ? state.V * Math.sin(2 * Math.PI * AC_HZ * time) : state.V;
  const E = fieldKVmm(V);
  if (!state.paused && applyField(D, E) > 0) retarget(0.25);
  const p = animateDomains(state.paused ? 0 : dt);

  const sign = p > 0.5 ? 1 : p < -0.5 ? -1 : 0;
  if (sign && pSign && sign !== pSign) { flipped = true; lastSwitch = time; }
  if (sign) pSign = sign;
  if (flipped && time - lastSwitch > 10) flipped = false;

  const { S3, S1, dt: dT, dL } = changes(V, p, state.L);
  const drawnT = T_MM * (1 + S3 * SHOW);
  const drawnL = state.L * (1 + S1 * SHOW);
  S.update({
    L: state.L, t: T_MM, drawnL, drawnT, dirs, V, polingFlash,
    dtLabel: `t ${dT >= 0 ? '+' : '−'} ${um(Math.abs(dT))}`,
    dLLabel: `L ${dL >= 0 ? '+' : '−'} ${um(Math.abs(dL))}`,
  });
  if (!state.paused) chart.push(E, S3, S1);
  chart.draw(E, S3, S1);
  drawCell({ sign: Math.sign(p) || 1, S3, S1 });

  hudTimer += dt;
  if (hudTimer > 0.12) {
    hudTimer = 0;
    const s = {
      V, E, p, S3, S1, dt: dT, dL, L: state.L, ac: state.ac, flipped,
      state: Math.abs(p) < 0.15 ? 'unpoled' : Math.abs(p) < 0.85 ? 'partial' : 'poled',
    };
    syncHud(s);
  }

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

tick();
