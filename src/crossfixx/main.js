import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';
import {
  F0_KHZ, Q, EXAGGERATION, STICKSLIP_HZ,
  resonance, tipAmplitudeUm, tipPosition, transferFactor, stepPerCycleUm, stickSlip,
} from './physics.js';
import { buildScene, EXPLODE, ROTOR_R, PLATE, PLATE_CY, FLOOR_Y } from './scene.js';
import { createInset } from './inset.js';
import { captions } from './captions.js';

// ---------- State ----------
const state = {
  driven: 'linear',      // 'linear' | 'rotary'
  mode: 'standing',      // 'standing' (CrossFixx) | 'stickslip' (contrast)
  exploded: false,
  nodal: false,          // nodal-point fixation view
  paused: false,
  phase: 90,             // degrees, normal mode relative to bending mode
  amp: 1,                // 0..1 drive amplitude
  f: F0_KHZ,             // kHz
  rate: 0.5,             // displayed cycles per second
};
let theta = 0;           // displayed cycle angle ωt
let travel = 0;          // accumulated slider travel, display mm
let explodeT = 0;        // 0 assembled .. 1 exploded (animated)

const UM = 1e-3 * EXAGGERATION; // display mm per real µm

// ---------- Renderer / camera ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
app.appendChild(labelRenderer.domElement);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.5, 600);
const HOME = { pos: new THREE.Vector3(44, 26, 104), target: new THREE.Vector3(0, 4, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 15;
controls.maxDistance = 220;
controls.update();

const S = buildScene(renderer);
const { scene, groups: G } = S;

// Post: multisampled HDR render, a gentle bloom on the hot spots (sparks, live electrodes,
// specular glints), then tone mapping + sRGB in the output pass.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.25, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let floorT = state.driven === 'rotary' ? 1 : 0; // 0 linear .. 1 rotary floor height

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const drawInset = createInset($('inset'));

function bindSlider(id, key, toValue = Number, fromValue = (v) => v) {
  const el = $(id);
  el.value = fromValue(state[key]);
  el.addEventListener('input', () => { state[key] = toValue(el.value); syncHud(); });
  return el;
}
// Slow-motion slider is logarithmic: 0..1000 -> 0.1..20 displayed cycles/s
const RATE_MIN = 0.1;
const RATE_MAX = 20;
const rateTo = (v) => RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, v / 1000);
const rateFrom = (r) => (1000 * Math.log(r / RATE_MIN)) / Math.log(RATE_MAX / RATE_MIN);

const sliders = {
  phase: bindSlider('phase', 'phase'),
  amp: bindSlider('amp', 'amp'),
  f: bindSlider('freq', 'f'),
  rate: bindSlider('rate', 'rate', rateTo, rateFrom),
};

// Resonance band (half-power, f0 ± f0/2Q) highlighted on the frequency track
{
  const lo = ((F0_KHZ - F0_KHZ / (2 * Q) - 80) / 100) * 100;
  const hi = ((F0_KHZ + F0_KHZ / (2 * Q) - 80) / 100) * 100;
  const c = ((F0_KHZ - 80) / 100) * 100;
  const band = $('res-band');
  band.style.left = `${lo}%`;
  band.style.width = `${hi - lo}%`;
  $('res-mark').style.left = `${c}%`;
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
    if (g === 'driven') state.driven = b.dataset.value;
    if (g === 'view') state.exploded = b.dataset.value === 'exploded';
    if (g === 'mode') state.mode = b.dataset.value;
    syncHud();
  });
});
document.querySelectorAll('[data-phase]').forEach((b) => {
  b.addEventListener('click', () => setPhase(Number(b.dataset.phase)));
});
$('pause').addEventListener('click', () => { state.paused = !state.paused; syncHud(); });
$('reset').addEventListener('click', resetView);
$('nodal').addEventListener('click', () => setNodal(!state.nodal));

// Camera glide used by the nodal view (front close-up of the plate) and Reset view.
let camGoal = null;
const NODAL_VIEW = { pos: new THREE.Vector3(6, PLATE_CY + 4, 52), target: new THREE.Vector3(0, PLATE_CY - 1, 0) };
function setNodal(on) {
  state.nodal = on;
  if (on) { state.exploded = false; camGoal = NODAL_VIEW; } else { camGoal = HOME; }
  syncHud();
}

function setPhase(p) {
  state.phase = p;
  sliders.phase.value = p;
  syncHud();
}
function resetView() {
  camGoal = null;
  camera.position.copy(HOME.pos);
  controls.target.copy(HOME.target);
  controls.update();
}
controls.addEventListener('start', () => { camGoal = null; }); // user drag cancels the glide

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.code === 'Space') e.preventDefault();
  switch (e.key.toLowerCase()) {
    case 'l': state.driven = 'linear'; break;
    case 'r': state.driven = 'rotary'; break;
    case 'x': state.exploded = !state.exploded; break;
    case 'n': setNodal(!state.nodal); return;
    case 's': state.mode = state.mode === 'standing' ? 'stickslip' : 'standing'; break;
    case ' ': state.paused = !state.paused; e.preventDefault(); break;
    case '1': setPhase(-90); return;
    case '2': setPhase(0); return;
    case '3': setPhase(90); return;
    default: return;
  }
  syncHud();
});

const fmt = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function derived() {
  const R = resonance(state.f);
  const ss = state.mode === 'stickslip';
  const Aum = ss ? state.amp * 1.0 : tipAmplitudeUm(state.amp, state.f);
  const realHz = ss ? STICKSLIP_HZ : state.f * 1000;
  const dirSS = state.phase < 0 ? -1 : 1;
  const step = ss ? 2 * Aum * dirSS * (state.amp > 0 ? 1 : 0) : stepPerCycleUm(Aum, state.phase); // µm/cycle
  const speed = step * 1e-3 * realHz; // mm/s
  return { R, Aum, realHz, step, speed, dirSS };
}

let lastCaption = '';
function syncHud() {
  const d = derived();
  const ss = state.mode === 'stickslip';
  setSeg('driven', state.driven);
  setSeg('view', state.exploded ? 'exploded' : 'assembled');
  setSeg('mode', state.mode);
  document.body.classList.toggle('stickslip', ss);
  $('pause').textContent = state.paused ? 'Play' : 'Pause';
  $('nodal').classList.toggle('on', state.nodal);
  document.body.classList.toggle('nodal', state.nodal);
  S.nodal.visible = S.nodalProbes.visible = state.nodal;
  S.nodal.userData.nodeLabel.visible = state.nodal;
  for (const l of S.labels) l.visible = !state.nodal; // declutter the close-up
  updateElectrodePanel();
  $('pause').classList.toggle('on', state.paused);

  $('phase-val').textContent = `${state.phase > 0 ? '+' : ''}${fmt(state.phase)}°`;
  $('amp-val').textContent = fmt(state.amp, 2);
  $('freq-val').textContent = `${fmt(state.f, 1)} kHz`;
  $('rate-val').textContent = `${fmt(state.rate, state.rate < 1 ? 2 : 1)} cycles/s`;
  $('freq-row').classList.toggle('on-res', d.R > 0.707);

  $("real").textContent = `real: ${Math.round(d.realHz)} cycles/s`;
  $('slow').textContent = `shown: ${fmt(state.rate, state.rate < 1 ? 2 : 1)} cycles/s · slowed ${fmt(d.realHz / state.rate)}×`;
  $('r-ellipse').textContent = ss ? `${fmt(2 * d.Aum, 2)} µm stroke` : `${fmt(2 * d.Aum, 2)} µm wide · ${fmt(2 * d.Aum, 2)} µm tall`;
  $('r-res').textContent = ss ? 'n/a (quasi-static)' : `${fmt(d.R * 100)}% of peak`;
  $('r-speed').textContent = `${d.speed >= 0 ? '' : '−'}${fmt(Math.abs(d.speed), d.speed !== 0 && Math.abs(d.speed) < 10 ? 1 : 0)} mm/s`;
  $('r-step').textContent = `${fmt(Math.abs(d.step) * 1000)} nm / cycle`;
  $('mode-badge').textContent = ss ? 'Stick-slip · NOT CrossFixx' : 'CrossFixx · standing wave';
  $('mode-badge').classList.toggle('warn', ss);

  S.scaleNote.element.textContent = ss
    ? `tip stroke shown ~${EXAGGERATION}×`
    : `tip path shown ~${EXAGGERATION}× (real ≈ ${fmt(2 * d.Aum, 1)} µm)`;

  const html = captions({ ...state, ...d }).map((l) => `<p>${l}</p>`).join('');
  if (html !== lastCaption) {
    $('captions').innerHTML = html;
    lastCaption = html;
  }
}

// ---------- Electrode pattern panel (nodal view) ----------
// Front electrodes: diagonal pair A (top-left + bottom-right) and pair B (top-right + bottom-left).
// Expansion mode N = A + B, bending mode T = A − B. So A and B in phase drive only the expansion mode,
// 180° apart only the bending mode, and 90° apart both modes 90° apart: the ellipse.
const QUADS = [['A', 0, 0], ['B', 1, 0], ['B', 0, 1], ['A', 1, 1]];
function miniPlate(id, a, b, caption) {
  const fill = (v) => (v === 'q' ? '#b98cff' : v > 0 ? 'var(--hot)' : v < 0 ? 'var(--cool)' : 'rgba(255,255,255,0.12)');
  const val = { A: a, B: b };
  const cells = QUADS.map(([ph, cx, cy]) => `<rect x="${3 + cx * 22}" y="${3 + cy * 22}" width="20" height="20" rx="2" fill="${fill(val[ph])}" fill-opacity="0.85" data-ph="${ph}"/><text x="${13 + cx * 22}" y="${17 + cy * 22}">${ph}</text>`).join('');
  return `<figure id="${id}"><svg viewBox="0 0 48 48">${cells}<circle cx="24" cy="24" r="4" class="hole"/></svg><figcaption>${caption}</figcaption></figure>`;
}
$('electrodes').innerHTML = `
  <p class="el-title">Front electrodes: two diagonal pairs, A and B</p>
  <div class="el-row">
    ${miniPlate('el-inphase', 1, 1, '<b>A, B in phase</b>expansion mode only: tip moves into the strip')}
    ${miniPlate('el-anti', 1, -1, '<b>A, B 180° apart</b>bending mode only: tip moves along the strip')}
    ${miniPlate('el-quad', 1, 'q', '<b>A, B 90° apart</b>both modes, a quarter cycle apart: the ellipse')}
  </div>
  <div class="el-live"><svg id="el-live" viewBox="0 0 48 48"></svg><p id="el-live-text"></p></div>`;
function updateElectrodePanel() {
  if (!state.nodal) return;
  const ss = state.mode === 'stickslip';
  $('el-live-text').innerHTML = ss
    ? 'Stick-slip drives no resonant modes, so there is no shared node: this view only applies to CrossFixx.'
    : `Live drive on A and B. Every point of the plate traces its own path except the centre, where <b>both</b> modes are still.`;
}
const liveCells = QUADS.map(([ph, cx, cy]) => `<rect x="${3 + cx * 22}" y="${3 + cy * 22}" width="20" height="20" rx="2" data-ph="${ph}"/>`).join('');
$('el-live').innerHTML = `${liveCells}<circle cx="24" cy="24" r="4" class="hole node"/>`;
const liveRects = [...$('el-live').querySelectorAll('rect')];
function drawElectrodeLive(Nn, Tn, amp) {
  for (const r of liveRects) {
    const v = (r.dataset.ph === 'A' ? (Nn + Tn) / 2 : (Nn - Tn) / 2) * amp;
    r.setAttribute('fill', v >= 0 ? '#ff8a3d' : '#3db4ff');
    r.setAttribute('fill-opacity', (0.15 + 0.85 * Math.min(1, Math.abs(v))).toFixed(2));
  }
}

// ---------- Animation ----------
const tmp = new THREE.Vector3();
const red = new THREE.Color(0xff8a3d);
const blue = new THREE.Color(0x3db4ff);
const clock = new THREE.Clock();
let sparkCursor = 0;

function emitSpark(at, dirX) {
  const sp = S.sparkState[sparkCursor];
  sparkCursor = (sparkCursor + 1) % S.sparkState.length;
  sp.life = 1;
  sp.p.copy(at);
  sp.v.set(-dirX * (6 + Math.random() * 10), 4 + Math.random() * 9, (Math.random() - 0.3) * 10);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const d = derived();
  const ss = state.mode === 'stickslip';

  // Exploded transition
  const tgt = state.exploded ? 1 : 0;
  explodeT += (tgt - explodeT) * Math.min(1, dt * 5);
  if (Math.abs(tgt - explodeT) < 1e-3) explodeT = tgt;
  const e = explodeT * explodeT * (3 - 2 * explodeT);
  const inContactPossible = explodeT < 0.02;

  G.frame.position.y = e * EXPLODE.frame;
  G.plateGroup.position.y = PLATE_CY + e * EXPLODE.plate;
  G.tipBase.position.y = e * EXPLODE.tip;
  G.linStrip.position.y = e * EXPLODE.strip;
  G.linDriven.position.y = e * EXPLODE.driven;
  G.rotStrip.position.y = -ROTOR_R + e * EXPLODE.driven;
  G.rotDriven.position.y = -ROTOR_R + e * EXPLODE.driven;
  floorT += ((state.driven === 'rotary' ? 1 : 0) - floorT) * Math.min(1, dt * 6);
  S.floor.position.y = FLOOR_Y.linear + (FLOOR_Y.rotary - FLOOR_Y.linear) * floorT + e * EXPLODE.driven;
  G.linear.visible = state.driven === 'linear';
  G.rotary.visible = state.driven === 'rotary';

  // Advance the displayed cycle; integrate slider travel only while the tip is in contact.
  let pushing = false;
  let tipVx = 0;
  if (!state.paused) {
    const dTheta = 2 * Math.PI * state.rate * dt;
    const n = Math.max(1, Math.ceil(dTheta / 0.04));
    const k = ss ? 1 : transferFactor(d.Aum, state.phase);
    for (let i = 0; i < n; i++) {
      const t0 = theta + (dTheta * i) / n;
      const t1 = theta + (dTheta * (i + 1)) / n;
      if (ss) {
        const a = stickSlip(t0, d.Aum, d.dirSS);
        const b = stickSlip(t1, d.Aum, d.dirSS);
        if (a.sticking && b.sticking && inContactPossible) travel += (b.x - a.x) * UM;
      } else {
        const y = tipPosition((t0 + t1) / 2, d.Aum, state.phase).y;
        if (y > 0 && inContactPossible) {
          travel += d.Aum * (Math.sin(t1) - Math.sin(t0)) * UM * k;
        }
      }
    }
    theta = (theta + dTheta) % (Math.PI * 2 * 1000);
  }

  // Tip position (exact equation, exaggerated for display)
  let tx;
  let ty;
  let ssNow = null;
  if (ss) {
    ssNow = stickSlip(theta, d.Aum, d.dirSS);
    tx = ssNow.x; ty = 0;
    pushing = !ssNow.sticking && d.Aum > 0; // impact/slip phase
    tipVx = ssNow.sticking ? d.dirSS : -d.dirSS;
  } else {
    const p = tipPosition(theta, d.Aum, state.phase);
    tx = p.x; ty = p.y;
    pushing = p.y > 0 && d.Aum > 0.02;
    tipVx = Math.cos(theta);
  }
  S.tip.position.set(tx * UM, -ty * UM, 0);

  // Plate deformation: radial expansion (normal mode) + in-plane bending (tangential mode)
  const half = PLATE / 2;
  const ex = (ty * UM) / half;
  const sh = -(tx * UM) / half;
  S.plateDeform.matrix.set(1 + ex, sh, 0, 0, 0, 1 + ex, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  S.plateDeform.matrixWorldNeedsUpdate = true;

  // Nodal view: full-cycle path of each probe point, drawn in the fixed plate frame
  if (state.nodal) {
    const N = S.nodal.userData.PATH_N;
    const phi = ss ? null : (state.phase * Math.PI) / 180;
    for (const line of S.probePaths) {
      const { px, py, z } = line.userData;
      const arr = line.geometry.attributes.position.array;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        let x; let y;
        if (ss) { x = stickSlip(a, d.Aum, d.dirSS).x; y = 0; } else { x = d.Aum * Math.sin(a); y = d.Aum * Math.sin(a + phi); }
        const exA = (y * UM) / half;
        const shA = -(x * UM) / half;
        arr[i * 3] = px + exA * px + shA * py;
        arr[i * 3 + 1] = py + exA * py;
        arr[i * 3 + 2] = z;
      }
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
    S.nodal.userData.ring.material.opacity = 0.55 + 0.35 * Math.sin(clock.elapsedTime * 3);
  }
  if (camGoal) {
    const k = Math.min(1, dt * 4);
    camera.position.lerp(camGoal.pos, k);
    controls.target.lerp(camGoal.target, k);
    if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal = null;
  }

  // Electrode drive: A = (N+T)/2, B = (N-T)/2 → same signal excites expansion, opposite excites bending
  const A0 = Math.max(d.Aum, 1e-6);
  const Tn = ss ? tx / A0 : Math.sin(theta);
  const Nn = ss ? 0 : Math.sin(theta + (state.phase * Math.PI) / 180);
  const amp = state.amp; // electrode voltage is the drive; the tip response also depends on resonance
  for (const el of S.electrodes) {
    const v = (el.userData.phase === 'A' ? (Nn + Tn) / 2 : (Nn - Tn) / 2) * amp;
    el.material.emissive.copy(v >= 0 ? red : blue).multiplyScalar(Math.abs(v) * 0.9);
  }
  if (state.nodal) drawElectrodeLive(Nn, Tn, amp);

  // Ghost path
  const pos = S.ghostPos;
  const col = S.ghostCol;
  for (let i = 0; i <= S.ghostN; i++) {
    const a = (i / S.ghostN) * Math.PI * 2;
    let x; let y; let hot;
    if (ss) {
      const q = stickSlip(a, d.Aum, d.dirSS);
      x = q.x; y = 0; hot = q.sticking;
    } else {
      const q = tipPosition(a, d.Aum, state.phase);
      x = q.x; y = q.y; hot = q.y > 0;
    }
    pos[i * 3] = x * UM;
    pos[i * 3 + 1] = -y * UM;
    pos[i * 3 + 2] = 0;
    const c = hot ? [1.0, 0.7, 0.36] : [0.37, 0.83, 1.0];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  S.ghost.geometry.setPositions(pos);
  S.ghost.geometry.setColors(col);
  S.ghostDot.position.set(tx * UM, -ty * UM, 0);

  // Driven part
  const wrap = 10; // tick spacing; keeps the long rod centred
  const lin = ((travel % wrap) + wrap) % wrap;
  S.rodSlide.position.x = lin;
  S.stripSlide.position.x = lin;
  const ang = -travel / ROTOR_R;
  S.rotorSpin.rotation.z = ang;
  S.rotorBody.rotation.z = ang;

  // Direction arrows
  const sign = Math.sign(d.step);
  const strength = Math.min(1, Math.abs(d.step) / 2);
  for (const arrow of [S.linArrow, S.rotArrow]) {
    arrow.visible = sign !== 0;
    arrow.scale.x = sign < 0 ? -1 : 1;
    arrow.userData.material.opacity = (inContactPossible ? 0.35 : 0.15) + 0.6 * strength * (inContactPossible ? 1 : 0.3);
  }

  // Sparks only in the push half (or stick-slip impact), and only while touching
  if (pushing && inContactPossible && !state.paused && Math.random() < 0.6) {
    S.tip.getWorldPosition(tmp);
    tmp.z += 1.2;
    emitSpark(tmp, Math.sign(tipVx) || 1);
  }
  const sp = S.sparks.geometry.attributes.position.array;
  const al = S.sparks.geometry.attributes.alpha.array;
  S.sparkState.forEach((s, i) => {
    if (s.life > 0) {
      s.life -= dt * 2.6;
      s.v.y -= 30 * dt;
      s.p.addScaledVector(s.v, dt);
    }
    sp[i * 3] = s.p.x; sp[i * 3 + 1] = s.p.y; sp[i * 3 + 2] = s.p.z;
    al[i] = Math.max(0, s.life);
  });
  S.sparks.geometry.attributes.position.needsUpdate = true;
  S.sparks.geometry.attributes.alpha.needsUpdate = true;

  drawInset({ Aum: d.Aum, phase: state.phase, theta, mode: state.mode, ss: ssNow });

  controls.update();
  S.ghost.material.resolution.set(window.innerWidth, window.innerHeight);
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug/test hook: lets automated checks read state without affecting the UI.
window.__piezo = { state, get travel() { return travel; }, get explodeT() { return explodeT; }, tip: S.tip, setPhase, syncHud };

syncHud();
tick();
