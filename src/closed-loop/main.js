import './style.css';
import { simulate, DEFAULTS, PRESETS, ENCODERS_NM } from './sim.js';
import { drawMove, drawLanding, drawDrive, drawTip } from './charts.js';

// ---------- Controls: Xeryon parameter names, ranges chosen for exploring ----------
const CONTROLS = [
  { group: 'Zone 1 · near the target' },
  { key: 'FREQ', label: 'FREQ', min: 160000, max: 180000, step: 500, fmt: (v) => `${(v / 1000).toFixed(1)} kHz`, hint: 'Drive frequency inside ZON1' },
  { key: 'PROP', label: 'PROP', min: 1, max: 3000, log: true, fmt: (v) => `${v}`, hint: 'Proportional factor inside ZON1' },
  { key: 'ZON1', label: 'ZON1', min: 5, max: 2000, log: true, fmt: (v) => `±${v} counts`, hint: 'Width of zone 1' },
  { group: 'Zone 2 · far from the target' },
  { key: 'FRQ2', label: 'FRQ2', min: 160000, max: 180000, step: 500, fmt: (v) => `${(v / 1000).toFixed(1)} kHz` },
  { key: 'PRO2', label: 'PRO2', min: 1, max: 3000, log: true, fmt: (v) => `${v}` },
  { key: 'ZON2', label: 'ZON2', min: 50, max: 20000, log: true, fmt: (v) => `±${v} counts` },
  { group: 'Landing' },
  { key: 'PTOL', label: 'PTOL', min: 0, max: 50, step: 1, fmt: (v) => `±${v} counts`, hint: 'Drive switches off inside this' },
  { key: 'PTO2', label: 'PTO2', min: 0, max: 200, step: 1, fmt: (v) => `±${v} counts`, hint: 'Fallback tolerance after TOUT' },
  { key: 'TOUT', label: 'TOUT', min: 0, max: 200, step: 5, fmt: (v) => `${v} ms` },
  { group: 'Motion and load' },
  { key: 'SSPD', label: 'SSPD', min: 1000, max: 100000, log: true, fmt: (v) => `${+(v / 1000).toFixed(1)} mm/s` },
  { key: 'MASS', label: 'MASS', min: 0, max: 2000, step: 50, fmt: (v) => `${v}` },
  { key: 'DUCO', label: 'DUCO', toggle: ['0 · fixed 50 % amplitude', '1 · amplitude in loop'] },
  { group: 'Stage (not a controller setting)' },
  { key: 'encNm', label: 'Encoder', select: ENCODERS_NM.map((n) => [n, `${n} nm / count`]) },
  { key: 'payloadG', label: 'Payload', min: 0, max: 2000, step: 50, fmt: (v) => `${v} g` },
  { key: 'loadN', label: 'Opposing load', min: 0, max: 3, step: 0.1, fmt: (v) => `${v.toFixed(1)} N` },
  { key: 'moveUm', label: 'Move', min: 10, max: 5000, log: true, fmt: (v) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} mm` : `${v} µm`) },
  { key: 'durationMs', label: 'Time shown', min: 60, max: 500, step: 10, fmt: (v) => `${v} ms` },
];

const params = { ...DEFAULTS };
let run = null;
let hoverT = null;
let activePreset = 'defaults';

// ---------- Build the control panel ----------
const controlsEl = document.getElementById('controls');
const inputs = {};
const toLog = (c, v) => Math.log(v / c.min) / Math.log(c.max / c.min);
const fromLog = (c, u) => Math.round(c.min * (c.max / c.min) ** u);

for (const c of CONTROLS) {
  if (c.group) { const h = document.createElement('h3'); h.textContent = c.group; controlsEl.append(h); continue; }
  const row = document.createElement('label'); row.className = 'ctl';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = c.label;
  if (c.hint) name.title = c.hint;
  const val = document.createElement('em');
  let input;
  if (c.toggle) {
    input = document.createElement('select');
    c.toggle.forEach((t, i) => input.append(new Option(t, i)));
    input.onchange = () => set(c.key, +input.value);
  } else if (c.select) {
    input = document.createElement('select');
    c.select.forEach(([v, t]) => input.append(new Option(t, v)));
    input.onchange = () => set(c.key, +input.value);
  } else {
    input = document.createElement('input'); input.type = 'range';
    if (c.log) { input.min = 0; input.max = 1; input.step = 0.001; }
    else { input.min = c.min; input.max = c.max; input.step = c.step; }
    input.oninput = () => set(c.key, c.log ? fromLog(c, +input.value) : +input.value);
  }
  row.append(name, val, input);
  controlsEl.append(row);
  inputs[c.key] = { c, input, val };
}

function syncControls() {
  for (const { c, input, val } of Object.values(inputs)) {
    const v = params[c.key];
    if (c.toggle || c.select) { input.value = String(v); val.textContent = ''; continue; }
    input.value = c.log ? toLog(c, v) : v;
    val.textContent = c.fmt(v);
  }
  for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('on', b.dataset.id === activePreset);
}

function set(key, value) {
  params[key] = value;
  activePreset = null;
  schedule();
}

function load(changes, presetId = null) {
  Object.assign(params, DEFAULTS, changes);
  activePreset = presetId;
  schedule();
}

// ---------- Presets and fault table ----------
const presetsEl = document.getElementById('presets');
for (const pr of PRESETS) {
  const b = document.createElement('button');
  b.textContent = pr.label; b.dataset.id = pr.id; b.title = pr.symptom;
  b.onclick = () => load(pr.params, pr.id);
  presetsEl.append(b);
}

const QUOTES = {
  hunting: ['Proportional factor too high', 'Higher proportional factors "can also lead to instability or noisy operation when chosen too high." If it still won\'t land: "try to increase the positioning tolerances PTOL and PTO2."'],
  below: ['Frequency below resonance', 'Too low a frequency and the motor will "feature unstable behaviour". Setting it "a few kHz above the resonant frequency often leads to a more relaxed control with better \'landing\' characteristics."'],
  stall: ['Proportional factor too low', 'Lower proportional factors give "a more sluggish motion response". Near the target the push gets too small to beat friction.'],
  payload: ['Payload added, MASS left at 0', '"For every 100g of mass you add, increase the MASS parameter with 100." Then, as "a first good practice", halve PROP and PRO2 and keep their ratio.'],
  force: ['Frequency too far above resonance', 'Too high a frequency and "the motor will have very limited force". The error limit ELIM then trips and the controller enters safe mode.'],
};
const table = document.getElementById('fault-table');
for (const pr of PRESETS) {
  if (!pr.fix) continue;
  const [cause, quote] = QUOTES[pr.id];
  const row = document.createElement('div'); row.className = 'fault';
  row.innerHTML = `<div class="sym"><b>${pr.symptom}</b><span>${cause}</span></div><p>${quote}</p>`;
  const btns = document.createElement('div'); btns.className = 'btns';
  const a = document.createElement('button'); a.textContent = 'Show it';
  a.onclick = () => { load(pr.params, pr.id); document.querySelector('.lab').scrollIntoView({ behavior: 'smooth' }); };
  const b = document.createElement('button'); b.textContent = pr.fixLabel; b.className = 'fix';
  b.onclick = () => { load({ ...pr.params, ...pr.fix }); document.querySelector('.lab').scrollIntoView({ behavior: 'smooth' }); };
  btns.append(a, b); row.append(btns); table.append(row);
}

// ---------- Run + draw ----------
const cMove = document.getElementById('c-move');
const cLand = document.getElementById('c-land');
const cDrive = document.getElementById('c-drive');
const cTip = document.getElementById('c-tip');
const readout = document.getElementById('readout');
const diag = document.getElementById('diagnosis');
let frames = {};
let pending = false;

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; run = simulate(params); syncControls(); renderSummary(); });
}

function renderSummary() {
  const s = run.summary;
  const nm = (counts) => `${Math.abs(counts * params.encNm) >= 1000 ? (Math.abs(counts * params.encNm) / 1000).toFixed(1) + ' µm' : Math.abs(Math.round(counts * params.encNm)) + ' nm'}`;
  const landed = s.elimMs != null ? '<span class="bad">safe mode (ELIM)</span>'
    : s.landedOn === 'none' ? '<span class="bad">not landed</span>'
    : s.landedOn === 'PTO2' ? `<span class="warn">PTO2, ±${params.PTO2}</span>` : `<span class="good">PTOL, ±${params.PTOL}</span>`;
  readout.innerHTML = `
    <dt>Landed on</dt><dd>${landed}</dd>
    <dt>Settle after profile</dt><dd>${s.settleMs == null ? '—' : s.settleMs.toFixed(1) + ' ms'}</dd>
    <dt>Overshoot</dt><dd>${s.overshootCounts.toFixed(0)} counts · ${nm(s.overshootCounts)}</dd>
    <dt>Final error</dt><dd>${s.finalErrCounts} counts · ${nm(s.finalErrCounts)}</dd>
    <dt>Reversals while landing</dt><dd>${s.reversals}</dd>
    <dt id="cur-label">Cursor</dt><dd id="cur"></dd>`;
  diag.innerHTML = s.diagnosis.map((d) => `<li class="${d.key}">${d.text}</li>`).join('');
}

function sampleAt(t) {
  const o = run.out;
  let lo = 0, hi = o.t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (o.t[m] < t) lo = m; else hi = m; }
  return hi;
}

let theta = 0, last = performance.now();
function tick(now) {
  const dtS = (now - last) / 1000; last = now;
  theta += dtS * 2 * Math.PI * 1.2; // displayed cycle rate; the real one is ~170 000 per second
  if (run) {
    const tEnd = run.out.t[run.out.t.length - 1];
    const tPlay = hoverT ?? ((now / 1000 / 5) % 1) * tEnd; // 5 s sweep when not hovering
    frames.move = drawMove(cMove, run, tPlay);
    frames.land = drawLanding(cLand, run, tPlay);
    frames.drive = drawDrive(cDrive, run, tPlay);
    const i = sampleAt(tPlay);
    const o = run.out;
    drawTip(cTip, o.amp[i], o.phase[i], theta);
    const cur = document.getElementById('cur');
    if (cur) {
      const err = Math.round(o.meas[i] / run.summary.res) - run.summary.target;
      cur.textContent = `${tPlay.toFixed(1)} ms · error ${err > 0 ? '+' : ''}${err} · A ${o.amp[i].toFixed(2)} µm · φ ${o.phase[i] > 0 ? '+90°' : o.phase[i] < 0 ? '−90°' : '—'} · ${(o.freq[i] / 1000).toFixed(1)} kHz${o.on[i] ? '' : ' · off'}`;
    }
  }
  requestAnimationFrame(tick);
}

for (const [cv, key] of [[cMove, 'move'], [cLand, 'land'], [cDrive, 'drive']]) {
  cv.addEventListener('pointermove', (e) => {
    const f = frames[key]; if (!f || !run) return;
    const r = cv.getBoundingClientRect();
    const tEnd = run.out.t[run.out.t.length - 1];
    hoverT = Math.max(0, Math.min(tEnd, f.inv(e.clientX - r.left)));
  });
  cv.addEventListener('pointerleave', () => { hoverT = null; });
}

load({}, 'defaults');
requestAnimationFrame(tick);
