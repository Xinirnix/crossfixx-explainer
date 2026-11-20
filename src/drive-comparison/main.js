import * as THREE from 'three';
import './style.css';
import {
  P, PERIOD_S, EARTH_FIELD_MT, command, createSim, step,
  piezoHoldN, screwInfo, wormInfo, dipoleFieldMT, trackFieldMT,
} from './model.js';
import { buildScenes } from './scenes.js';
import { createChart } from './chart.js';

const $ = (id) => document.getElementById(id);

// ---------- State ----------
const env = {
  powered: true,
  loadN: 0,
  probeMm: 10,
  backlashUm: P.screw.backlashUm,
  wormBacklashArcmin: P.worm.backlashArcmin,
  ballScrew: false,
  wormStarts: 1,
};
let sim = createSim();
let tCmd = 0;          // command clock; it stops while the power is off
let paused = false;
let scenario = 'reverse';
let cutAt = null;      // scenario 3 drops the power after a moment

const SCENARIOS = {
  reverse: {
    text: 'No load, power on. Each time the command reverses, the screw and the worm turn through their clearance before the payload moves again: a step in the error chart. The piezo and the linear motor push the payload directly and follow the command.',
    set() { Object.assign(env, { loadN: 0, powered: true }); cutAt = null; },
  },
  hold: {
    text: 'A 3 N load pulls toward −x, like gravity on a vertical axis. Compare the power needed to stand still: the linear motor needs current to make force, the stepper keeps its phases on, the self-locking worm and the piezo need none. The steady load also keeps the screw on one flank, which hides its backlash.',
    set() { Object.assign(env, { loadN: 3, powered: true }); cutAt = null; },
  },
  off: {
    text: 'Same 3 N load, then the power drops. The piezo holds on friction (3 N is below its 4 N holding force), the lead screw and the 1-start worm self-lock, and the linear motor falls to its end stop. Now try Ball screw, a 2-start worm, or a load above 4 N.',
    set() { Object.assign(env, { loadN: 3, powered: true }); cutAt = performance.now() + 1500; },
  },
};

// ---------- Renderer: one canvas, one viewport per panel ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scenes = buildScenes(renderer);

const panels = [...document.querySelectorAll('.panel')].map((el) => {
  const key = el.dataset.drive;
  const angular = key === 'worm';
  return {
    key, el,
    view: el.querySelector('.view'),
    ro: el.querySelector('.ro'),
    chart: createChart(el.querySelector('.chart'), {
      unit: angular ? 'arcmin' : 'µm',
      range: () => (angular ? Math.max(15, env.wormBacklashArcmin) : Math.max(60, env.backlashUm)),
      color: key === 'piezo' ? '#ffb35c' : '#5fd3ff',
    }),
  };
});

// ---------- Controls ----------
function bind(id, key, fmt) {
  const el = $(id);
  const out = $(`${id}-val`);
  const sync = () => { el.value = env[key]; out.textContent = fmt(env[key]); };
  el.addEventListener('input', () => { env[key] = Number(el.value); sync(); refreshStatic(); });
  sync();
  return sync;
}
const syncers = [
  bind('load', 'loadN', (v) => `${v.toFixed(1)} N`),
  bind('probe', 'probeMm', (v) => `${v} mm`),
  bind('bl', 'backlashUm', (v) => `${v} µm`),
  bind('wbl', 'wormBacklashArcmin', (v) => `${v} arcmin`),
];

function segment(id, attr, get, set) {
  const root = $(id);
  const sync = () => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(get())));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset[attr]);
    sync();
    refreshStatic();
  });
  sync();
  return sync;
}
const syncNut = segment('nut', 'v', () => (env.ballScrew ? 'ball' : 'plain'), (v) => { env.ballScrew = v === 'ball'; });
const syncStarts = segment('starts', 'v', () => env.wormStarts, (v) => { env.wormStarts = Number(v); });
const syncScn = segment('scenario', 'scn', () => scenario, (v) => startScenario(v));

function syncPower() {
  const b = $('power');
  b.textContent = env.powered ? 'Power: on' : 'Power: off';
  b.classList.toggle('off', !env.powered);
  document.body.classList.toggle('unpowered', !env.powered);
}
$('power').addEventListener('click', () => { env.powered = !env.powered; cutAt = null; syncPower(); });
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? 'Play' : 'Pause'; });

function startScenario(name) {
  scenario = name;
  SCENARIOS[name].set();
  sim = createSim();
  tCmd = 0;
  panels.forEach((p) => p.chart.clear());
  $('scn-text').textContent = SCENARIOS[name].text;
  syncers.forEach((s) => s());
  syncPower();
  syncScn?.();
  refreshStatic();
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
  if (e.key === '1') { startScenario('reverse'); syncScn(); }
  if (e.key === '2') { startScenario('hold'); syncScn(); }
  if (e.key === '3') { startScenario('off'); syncScn(); }
  if (e.key === 'p' || e.key === 'P') $('power').click();
  if (e.key === ' ') { e.preventDefault(); $('pause').click(); }
});

// ---------- Readouts ----------
const f2 = (v, d = 2) => v.toFixed(d);
function fieldText(mT) {
  if (mT <= 0) return 'none from the drive';
  const vs = mT / EARTH_FIELD_MT;
  const val = mT >= 1 ? `${f2(mT, 1)} mT` : `${f2(mT * 1000, 0)} µT`;
  return `${val} · ${vs >= 10 ? Math.round(vs) : f2(vs, 1)}× Earth`;
}

// Things that only change when a control changes.
let staticRows = {};
function refreshStatic() {
  const hold = piezoHoldN();
  const s = screwInfo(env.ballScrew);
  const w = wormInfo(env.wormStarts);
  const fricHides = env.loadN > P.screw.carriageFricN;
  staticRows = {
    piezo: {
      lost: 'none · direct drive',
      field: fieldText(0),
      lock: `<span class="yes">yes</span>, up to ${f2(hold, 1)} N <span class="eq">μ·F<sub>pre</sub> = ${P.piezo.mu}·${P.piezo.preloadN} N</span>`,
    },
    screw: {
      lost: env.backlashUm === 0 ? 'none' : fricHides ? `hidden by load (b = ${env.backlashUm} µm)` : `${env.backlashUm} µm per reversal`,
      field: fieldText(dipoleFieldMT(env.probeMm, P.screw)),
      lock: s.locks
        ? `<span class="yes">yes</span> <span class="eq">μ ${s.mu} &gt; tan λ ${f2(s.tanL, 3)}</span>`
        : `<span class="no">no, needs a brake</span> <span class="eq">μ ${s.mu} &lt; tan λ ${f2(s.tanL, 3)}</span>`,
    },
    worm: {
      lost: env.wormBacklashArcmin === 0 ? 'none' : env.loadN > 0.05 ? `hidden by load (b = ${env.wormBacklashArcmin}′)` : `${env.wormBacklashArcmin} arcmin per reversal`,
      field: fieldText(dipoleFieldMT(env.probeMm, P.worm)),
      lock: w.locks
        ? `<span class="yes">yes</span> <span class="eq">μ ${w.mu} &gt; tan λ ${f2(w.tanL, 3)}</span>`
        : `<span class="no">no</span> <span class="eq">μ ${w.mu} &lt; tan λ ${f2(w.tanL, 3)}</span>`,
    },
    magnet: {
      lost: 'none · direct drive',
      field: fieldText(trackFieldMT(env.probeMm)),
      lock: '<span class="no">no, needs a brake</span> <span class="eq">F = k<sub>f</sub>·I = 0 at I = 0</span>',
    },
  };
}

function errText(p, st) {
  if (p.key === 'worm') return `${f2(st.errArcmin, 1)} arcmin`;
  const d = Math.abs(st.err) < 10 ? 2 : 0;
  return `${f2(Math.abs(st.err) < 0.005 ? 0 : st.err, d)} µm`;
}
function holdText(key, st) {
  const W = st.holdW;
  const eq = {
    piezo: 'no current to hold',
    screw: `2·I²R = 2·${P.screw.holdCurrentA}²·${P.screw.phaseOhm} Ω`,
    worm: st.locks ? 'worm self-locks, motor rests' : 'I²R, back-driving torque',
    magnet: `R·(F/k<sub>f</sub>)² = ${P.magnet.phaseOhm}·(${f2(env.loadN, 1)}/${P.magnet.kf})²`,
  }[key];
  const val = W < 0.0005 ? '0 W' : W < 0.1 ? `${f2(W * 1000, 0)} mW` : `${f2(W, 2)} W`;
  const cls = W > 0.5 ? 'hot' : W > 0.0005 ? 'warm' : 'cool';
  return `<span class="${cls}">${val}</span> <span class="eq">${env.powered ? eq : 'power off'}</span>`;
}

function renderReadouts() {
  for (const p of panels) {
    const st = sim[p.key];
    const r = staticRows[p.key];
    p.ro.innerHTML = `
      <dt>State</dt><dd class="state s-${st.state.replace(/[^a-z]/g, '')}">${st.state}</dd>
      <dt>Position error</dt><dd>${errText(p, st)}</dd>
      <dt>Lost motion</dt><dd>${r.lost}</dd>
      <dt>Power to hold</dt><dd>${holdText(p.key, st)}</dd>
      <dt>Field at probe</dt><dd>${r.field}</dd>
      <dt>Holds at 0 W</dt><dd>${r.lock}</dd>`;
  }
}

// ---------- Loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
}

let last = performance.now();
let roTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  resize();

  if (cutAt && now >= cutAt) { env.powered = false; cutAt = null; syncPower(); }

  if (!paused) {
    if (env.powered) tCmd += dt;
    const cmd = command(tCmd);
    // Sub-step so backlash and slips resolve smoothly.
    const n = 4;
    for (let i = 0; i < n; i++) step(sim, dt / n, cmd, env);
    for (const p of panels) {
      const st = sim[p.key];
      p.chart.push(now / 1000, p.key === 'worm' ? st.errArcmin : st.err, env.powered);
    }
  }

  renderer.setScissor(0, 0, canvas.clientWidth, canvas.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const H = canvas.clientHeight;
  for (const p of panels) {
    const S = scenes[p.key];
    S.update(sim[p.key], env, paused ? 0 : dt);
    const r = p.view.getBoundingClientRect();
    if (r.bottom < 0 || r.top > H || r.width < 2) continue;
    const y = H - r.bottom;
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    S.camera.aspect = r.width / r.height;
    // Hold the horizontal field of view fixed so narrow panels still show the whole mechanism.
    S.camera.fov = (2 * Math.atan(0.74 / S.camera.aspect) * 180) / Math.PI;
    S.camera.updateProjectionMatrix();
    renderer.render(S.scene, S.camera);
  }
  for (const p of panels) p.chart.draw(now / 1000, PERIOD_S);

  roTimer += dt;
  if (roTimer > 0.1) { roTimer = 0; renderReadouts(); }
  requestAnimationFrame(frame);
}

startScenario('reverse');
step(sim, 0, command(0), env);
renderReadouts();
requestAnimationFrame(frame);
