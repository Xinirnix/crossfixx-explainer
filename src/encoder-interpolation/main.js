import './style.css';
import { DEFAULTS, PRESETS, PERIODS_UM, FACTORS, analyse, measure } from './model.js';
import { drawScale, drawSignals, drawLissajous, drawError, fmtLen } from './charts.js';

const TAU = 2 * Math.PI;
const pct = (v) => `${(v * 100).toFixed(1)} %`;

const CONTROLS = [
  { group: 'Scale and interpolator' },
  { key: 'periodUm', label: 'Signal period', select: PERIODS_UM.map((o) => [o.v, o.label]) },
  { key: 'N', label: 'Interpolation', select: FACTORS.map((n) => [n, n === 4 ? '×4 · edge counting only' : `×${n} counts per period`]) },
  { group: 'Signal errors' },
  { key: 'offX', label: 'Offset on cos', min: -0.05, max: 0.05, step: 0.001, fmt: pct, hint: 'DC offset, as a fraction of the signal amplitude' },
  { key: 'offY', label: 'Offset on sin', min: -0.05, max: 0.05, step: 0.001, fmt: pct },
  { key: 'gain', label: 'Gain mismatch', min: -0.1, max: 0.1, step: 0.002, fmt: pct, hint: 'cos gets 1 + g/2, sin gets 1 − g/2' },
  { key: 'phaseDeg', label: 'Phase error', min: -6, max: 6, step: 0.1, fmt: (v) => `${v.toFixed(1)}°`, hint: 'sin leads cos by 90° + this' },
  { key: 'amp', label: 'Common amplitude', min: 0.3, max: 1.2, step: 0.01, fmt: pct, hint: 'Both signals together, e.g. a dirty scale' },
  { key: 'noise', label: 'Noise (rms)', min: 0, max: 0.02, step: 0.0005, fmt: pct },
];

const params = { ...DEFAULTS };
let an = analyse(params);
let activePreset = 'ideal';
let x = 3.3 * DEFAULTS.periodUm; // true position, µm
let speed = 4; // µm/s on screen; a real stage passes many periods per millisecond
let playing = true;
const noisy = [];
let exag = 10; // Lissajous distortion drawn this many times larger

// ---------- Controls ----------
const controlsEl = document.getElementById('controls');
const inputs = {};
for (const c of CONTROLS) {
  if (c.group) { const h = document.createElement('h3'); h.textContent = c.group; controlsEl.append(h); continue; }
  const row = document.createElement('label'); row.className = 'ctl';
  const name = document.createElement('span'); name.className = 'name'; name.textContent = c.label;
  if (c.hint) name.title = c.hint;
  const val = document.createElement('em');
  let input;
  if (c.select) {
    input = document.createElement('select');
    c.select.forEach(([v, t]) => input.append(new Option(t, v)));
    input.onchange = () => set(c.key, +input.value);
  } else {
    input = document.createElement('input'); input.type = 'range';
    input.min = c.min; input.max = c.max; input.step = c.step;
    input.oninput = () => set(c.key, +input.value);
  }
  row.append(name, val, input);
  controlsEl.append(row);
  inputs[c.key] = { c, input, val };
}

const correctBtn = document.getElementById('correct');
correctBtn.onclick = () => set('correct', !params.correct);
const playBtn = document.getElementById('play');
playBtn.onclick = () => { playing = !playing; sync(); };
const speedIn = document.getElementById('speed');
speedIn.oninput = () => { speed = +speedIn.value; };
const exagIn = document.getElementById('exag');
exagIn.onchange = () => { exag = +exagIn.value; };

const presetsEl = document.getElementById('presets');
for (const pr of PRESETS) {
  const b = document.createElement('button');
  b.textContent = pr.label; b.dataset.id = pr.id; if (pr.note) b.title = pr.note;
  b.onclick = () => { Object.assign(params, DEFAULTS, { periodUm: params.periodUm, N: params.N }, pr.params); activePreset = pr.id; update(); };
  presetsEl.append(b);
}

function set(key, value) {
  if (key === 'periodUm') x = (x / params.periodUm) * value; // keep the same place within the period
  params[key] = value;
  activePreset = null;
  update();
}

function update() { an = analyse(params); noisy.length = 0; sync(); }

function sync() {
  for (const { c, input, val } of Object.values(inputs)) {
    input.value = String(params[c.key]);
    val.textContent = c.select ? '' : c.fmt(params[c.key]);
  }
  correctBtn.classList.toggle('on', params.correct);
  correctBtn.textContent = params.correct ? 'Correction on' : 'Correct the ellipse';
  playBtn.textContent = playing ? 'Pause' : 'Play';
  for (const b of presetsEl.children) b.classList.toggle('on', b.dataset.id === activePreset);
  renderSummary();
}

// ---------- Readouts ----------
const readout = document.getElementById('readout');
const verdict = document.getElementById('verdict');
const nm = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} µm` : `${v.toFixed(v < 10 ? 2 : 1)} nm`);

function renderSummary() {
  const a = an;
  const total = Math.max(a.ppNm, 2 * a.jitterNm);
  readout.innerHTML = `
    <dt>Resolution</dt><dd>${params.periodUm} µm ÷ ${params.N} = <b>${nm(a.lsbNm)}</b> per count</dd>
    <dt>Cyclic error</dt><dd><b>${nm(a.ppNm)}</b> peak to peak</dd>
    <dt>· once per period</dt><dd>${nm(a.h1Nm)} <span class="dim">(first-order: ${nm(a.pred1Nm)})</span></dd>
    <dt>· twice per period</dt><dd>${nm(a.h2Nm)} <span class="dim">(first-order: ${nm(a.pred2Nm)})</span></dd>
    ${params.noise ? `<dt>Noise jitter</dt><dd>${nm(a.jitterNm)} rms</dd>` : ''}
    <dt id="now-l">Now</dt><dd id="now"></dd>`;
  let msg;
  if (params.N === 4) msg = `Edge counting alone resolves only a quarter period, ${nm(a.lsbNm)}. Interpolating the angle is what turns a ${params.periodUm} µm grating into a nanometre encoder.`;
  else if (total <= a.lsbNm) msg = 'The circle is clean: the error stays inside one count, so every count is real position.';
  else {
    const bits = Math.log2(total / a.lsbNm);
    msg = `The error is ${(total / a.lsbNm).toFixed(1)}× one count: the counter still steps in ${nm(a.lsbNm)}, but the last ${bits.toFixed(1)} bits are not real position. Resolution is not accuracy.`;
  }
  verdict.textContent = msg;
  verdict.className = params.N === 4 || total <= a.lsbNm ? 'ok' : 'bad';
}

// ---------- Draw loop ----------
const cScale = document.getElementById('c-scale');
const cSig = document.getElementById('c-signals');
const cLis = document.getElementById('c-lissajous');
const cErr = document.getElementById('c-error');
let lisFrame = null, scaleFrame = null;
let gaussSeed = 1;
const gauss = () => {
  gaussSeed = (gaussSeed * 1664525 + 1013904223) >>> 0; const u1 = (gaussSeed + 0.5) / 4294967296;
  gaussSeed = (gaussSeed * 1664525 + 1013904223) >>> 0; const u2 = (gaussSeed + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
};

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (playing && !dragging) x += speed * dt;
  const m = measure(x, params, params.noise ? gauss : null);
  if (params.noise) { noisy.push({ c: m.c, s: m.s, theta: m.theta }); if (noisy.length > 400) noisy.shift(); }
  scaleFrame = drawScale(cScale, params, x, m);
  drawSignals(cSig, params, x);
  lisFrame = drawLissajous(cLis, params, m, noisy, exag);
  drawError(cErr, an, x);
  const now$ = document.getElementById('now');
  if (now$) {
    const e = (m.xMeas - x) * 1000;
    now$.innerHTML = `true ${fmtLen(x)} · read ${fmtLen(m.xMeas)} · <span class="${Math.abs(e) > an.lsbNm * 1.01 ? 'bad' : 'good'}">${e >= 0 ? '+' : ''}${nm(e)}</span>`;
  }
  requestAnimationFrame(tick);
}

// ---------- Dragging: slide the scale, or turn the Lissajous point ----------
let dragging = null;
cScale.addEventListener('pointerdown', (e) => { dragging = { el: 'scale', x0: e.clientX, pos0: x }; cScale.setPointerCapture(e.pointerId); });
cLis.addEventListener('pointerdown', (e) => { dragging = { el: 'lis' }; cLis.setPointerCapture(e.pointerId); dragLis(e); });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (dragging.el === 'scale' && scaleFrame) x = dragging.pos0 - ((e.clientX - dragging.x0) / scaleFrame.W) * scaleFrame.span;
  if (dragging.el === 'lis') dragLis(e);
});
window.addEventListener('pointerup', () => { dragging = null; });
function dragLis(e) {
  if (!lisFrame) return;
  const r = cLis.getBoundingClientRect();
  const a = Math.atan2(-(e.clientY - r.top - lisFrame.cy), e.clientX - r.left - lisFrame.cx);
  const P = params.periodUm;
  const n = Math.floor(x / P);
  x = (n + ((a / TAU) % 1 + 1) % 1) * P;
}

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return;
  if (e.code === 'Space') { e.preventDefault(); playing = !playing; sync(); }
  if (e.key === 'c' || e.key === 'C') set('correct', !params.correct);
  const i = '123456'.indexOf(e.key);
  if (i >= 0 && PRESETS[i]) presetsEl.children[i].click();
});

sync();
requestAnimationFrame(tick);
