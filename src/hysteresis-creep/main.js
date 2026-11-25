// Hysteresis & creep explainer: state, controls, animation loop.
import './style.css';
import { P, Actuator, makeParams, closedLoopStep } from './model.js';
import { createScene } from './scene.js';
import { drawLoop, drawCreep, T_MIN } from './charts.js';

const $ = (id) => document.getElementById(id);
const view = createScene($('view'));

const S = {
  closed: false,
  speed: 10,         // simulated seconds per real second
  t: 0,              // simulated time, s
  cmd: 0,            // open loop: voltage; closed loop: target µm
  hyst: P.HYST,
  gamma: P.GAMMA,
  sweep: null,       // { lo, hi, phase } triangle sweep of the command
  paused: false,
  trace: [],
  change: { t: 0, ref: 0, step: 0 }, // last voltage/target change
  samples: [],
};
let act = new Actuator(makeParams(S.hyst), S.gamma);

// ---- controls -------------------------------------------------------------
const cmdIn = $('cmd');
function cmdLabel() {
  $('cmd-name').textContent = S.closed ? 'Target position' : 'Voltage';
  $('cmd-val').textContent = S.closed ? `${S.cmd.toFixed(1)} µm` : `${S.cmd.toFixed(1)} V`;
}
function setCmd(value, fromSweep = false) {
  const max = S.closed ? P.STROKE : P.V_MAX;
  value = Math.min(max, Math.max(0, value));
  if (value === S.cmd) return;
  S.cmd = value;
  cmdIn.value = (value / max) * 1000;
  if (!fromSweep) S.sweep = null;
  const before = act.position(S.t);
  apply();
  markChange(before);
  cmdLabel();
  syncButtons();
}
cmdIn.addEventListener('input', () => setCmd((cmdIn.value / 1000) * (S.closed ? P.STROKE : P.V_MAX)));

function apply() {
  if (S.closed) closedLoopStep(act, S.cmd, S.t);
  else act.setVoltage(S.cmd, S.t);
  S.trace.push({ v: act.v, x: act.position(S.t) });
  if (S.trace.length > 6000) S.trace.splice(0, S.trace.length - 6000);
}

// A change that follows the previous one within ~0.3 s of real time continues the same move
// (a drag or a sweep), so the creep chart measures from where the move started.
function markChange(before) {
  const continuing = !S.change.idle && S.t - S.change.t < 0.3 * S.speed;
  const ref = continuing ? S.change.ref : before;
  S.change = { t: S.t, ref, step: act.position(S.t) - ref };
  S.samples = [];
}

function setMode(closed) {
  S.closed = closed;
  S.sweep = null;
  // Keep the stage where it is; the slider now sets a position instead of a voltage
  S.cmd = closed ? act.position(S.t) : act.v;
  cmdIn.value = (S.cmd / (closed ? P.STROKE : P.V_MAX)) * 1000;
  S.change = { t: S.t, ref: act.position(S.t), step: 0, idle: true };
  S.samples = [];
  cmdLabel();
  syncButtons();
}

function reset() {
  act = new Actuator(makeParams(S.hyst), S.gamma);
  S.t = 0; S.cmd = 0; S.sweep = null; S.trace = [{ v: 0, x: 0 }];
  cmdIn.value = 0;
  S.change = { t: 0, ref: 0, step: 0, idle: true }; S.samples = [];
  cmdLabel(); syncButtons();
}

const actions = {
  'sweep-full': () => { S.sweep = { lo: 0, hi: S.closed ? P.STROKE : P.V_MAX, phase: 0 }; startSweep(); },
  'sweep-half': () => { S.sweep = { lo: 0, hi: (S.closed ? P.STROKE : P.V_MAX) / 2, phase: 0 }; startSweep(); },
  'sweep-mid': () => { const m = S.closed ? P.STROKE : P.V_MAX; S.sweep = { lo: m * 0.35, hi: m * 0.65, phase: 0 }; startSweep(); },
  'step-up': () => { reset(); setCmd(S.closed ? 0.6 * P.STROKE : 60); },
  'step-down': () => setCmd(S.closed ? 0.3 * P.STROKE : 30),
  reset: () => reset(),
  open: () => setMode(false),
  closed: () => setMode(true),
  pause: () => { S.paused = !S.paused; syncButtons(); },
};
function startSweep() {
  // Start the triangle at the current command so there is no jump
  const { lo, hi } = S.sweep;
  const u = Math.min(1, Math.max(0, (S.cmd - lo) / (hi - lo)));
  S.sweep.phase = u / 2;
  syncButtons();
}
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act]()));

function syncButtons() {
  document.body.classList.toggle('closed', S.closed);
  $('b-open').classList.toggle('on', !S.closed);
  $('b-closed').classList.toggle('on', S.closed);
  $('b-pause').textContent = S.paused ? 'Resume' : 'Pause';
  document.querySelectorAll('[data-sweep]').forEach((b) => {
    const m = S.closed ? P.STROKE : P.V_MAX;
    const on = S.sweep && Math.abs(S.sweep.hi - m * +b.dataset.hi) < 1e-9 && Math.abs(S.sweep.lo - m * +b.dataset.lo) < 1e-9;
    b.classList.toggle('on', !!on);
  });
  document.querySelectorAll('.unit').forEach((e) => { e.textContent = S.closed ? (e.dataset.cl ?? '') : (e.dataset.ol ?? ''); });
}

function bindRange(id, get, set, fmt) {
  const el = $(id), out = $(`${id}-val`);
  el.addEventListener('input', () => { set(+el.value); out.textContent = fmt(get()); });
  out.textContent = fmt(get());
}
bindRange('hyst', () => S.hyst, (v) => { S.hyst = v / 100; reset(); }, (v) => `${(v * 100).toFixed(0)} %`);
bindRange('gamma', () => S.gamma, (v) => { S.gamma = v / 1000; act.gamma = S.gamma; }, (v) => v.toFixed(3));
$('speed').addEventListener('change', (e) => { S.speed = +e.target.value; });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); actions.pause(); }
  else if (k === 'o') actions.open();
  else if (k === 'c') actions.closed();
  else if (k === '1') actions['sweep-full']();
  else if (k === '2') actions['sweep-half']();
  else if (k === '3') actions['sweep-mid']();
  else if (k === 's') actions['step-up']();
  else if (k === 'r') actions.reset();
});

// ---- readouts and captions ------------------------------------------------
const fmt = (x, d = 2) => (Math.abs(x) < 0.005 ? 0 : x).toFixed(d);
function readouts(x, guess) {
  const err = x - guess;
  const age = S.t - S.change.t;
  const creep = age > T_MIN ? x - (S.change.ref + S.change.step) : 0;
  const rows = [
    ['Voltage', `${fmt(act.v, 1)} V`],
    ['Straight-line guess', `${fmt(guess)} µm`],
    ['Actual position', `${fmt(x)} µm`],
    [S.closed ? 'Position error' : 'Error, % of stroke', S.closed
      ? `<span class="good">${fmt(x - S.cmd, 3)} µm</span>`
      : `<span class="${Math.abs(err) > 0.03 * P.STROKE ? 'bad' : Math.abs(err) > 0.01 * P.STROKE ? 'warn' : 'good'}">${err >= 0 ? '+' : ''}${fmt(err)} µm (${fmt((100 * err) / P.STROKE, 1)} %)</span>`],
    ['Since last change', `${age < 60 ? age.toFixed(1) + ' s' : age < 3600 ? (age / 60).toFixed(1) + ' min' : (age / 3600).toFixed(2) + ' h'}`],
    [S.closed ? 'Voltage drift' : 'Creep since then', S.closed
      ? `${fmt(act.v - (S.samples[0]?.v ?? act.v), 2)} V`
      : `${creep >= 0 ? '+' : ''}${fmt(creep, 3)} µm`],
  ];
  $('readout').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  let cap;
  if (S.closed) {
    cap = S.sweep
      ? 'The sensor reads the real position and the controller keeps adjusting the voltage, so the position follows the target on the straight line. The loop has moved into the voltage: going up and coming down need different voltages for the same position.'
      : age > 30
        ? `Holding ${fmt(S.cmd, 1)} µm. Creep would keep stretching the stack, so the controller has lowered the voltage by ${fmt(Math.abs(act.v - (S.samples[0]?.v ?? act.v)), 2)} V to stop it. The position doesn't move.`
        : 'Closed loop: the slider sets a position. The controller finds whatever voltage gets there, wherever the stack is on its loop.';
  } else if (S.sweep) {
    cap = 'The rising and falling paths don\'t meet. At the same voltage the stack sits lower on the way up than on the way down, so a voltage alone doesn\'t say where it is. Smaller sweeps give smaller loops inside the big one.';
  } else if (age > 1 && Math.abs(S.change.step) > 0.05) {
    cap = `The voltage hasn't changed for ${age < 60 ? age.toFixed(0) + ' s' : (age / 60).toFixed(0) + ' min'}, but the stack keeps moving ${S.change.step > 0 ? 'up' : 'down'}: about ${fmt(S.gamma * Math.abs(S.change.step), 2)} µm (${(S.gamma * 100).toFixed(1)} % of the step) every time the elapsed time grows tenfold.`;
  } else {
    cap = 'Open loop: you set a voltage and hope. Drag the slider up and back, or press a sweep, and compare the orange path with the blue straight line.';
  }
  $('caption').textContent = cap;
}

// ---- loop -----------------------------------------------------------------
let last = performance.now();
let lastSampleL = -Infinity;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!S.paused) {
    S.t += dt * S.speed;
    if (S.sweep) {
      S.sweep.phase = (S.sweep.phase + dt / 6) % 1; // one round trip every 6 s of real time
      const u = S.sweep.phase < 0.5 ? S.sweep.phase * 2 : 2 - S.sweep.phase * 2;
      const prevCmd = S.cmd, before = act.position(S.t);
      S.cmd = S.sweep.lo + u * (S.sweep.hi - S.sweep.lo);
      cmdIn.value = (S.cmd / (S.closed ? P.STROKE : P.V_MAX)) * 1000;
      cmdLabel();
      if (S.cmd !== prevCmd) { apply(); markChange(before); }
    } else if (S.closed) {
      closedLoopStep(act, S.cmd, S.t); // keep correcting creep while holding
    }
    const age = S.t - S.change.t;
    const l = Math.log10(Math.max(age, 1e-3));
    if (age >= T_MIN && l - lastSampleL > 0.006) {
      S.samples.push({ age, x: act.position(S.t), v: act.v });
      lastSampleL = l;
    }
    if (age < T_MIN) lastSampleL = -Infinity;
  }

  const x = act.position(S.t);
  const guess = Actuator.linearGuess(act.v);
  view.update(x, guess, act.v);
  drawLoop($('c-loop'), S.trace, { v: act.v, x, guess }, S.closed);
  const t0 = S.change.t;
  drawCreep($('c-creep'), {
    samples: S.samples,
    predict: S.closed ? null : (age) => act.position(t0 + age),
    ref: S.change.ref,
    step: S.change.step,
    age: S.t - t0,
    closed: S.closed,
  });
  readouts(x, guess);
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
