// Four small scenes, one per drive. Primitive geometry only.
// Display units: 1 unit = 0.1 mm of real travel along x (so ±2 mm = ±20 units).
// The backlash callouts are magnified separately; see GAP_SCALE below.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { P, piezoHoldN } from './model.js';

export const UNIT_PER_UM = 0.01;
export const GAP_SCALE_UM = 0.06;       // callout units per µm of backlash  (×600 vs. travel)
export const GAP_SCALE_ARCMIN = 0.22;   // callout units per arcmin of worm backlash

const mat = {
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf1eee8, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  piezo: new THREE.MeshPhysicalMaterial({ color: 0x7f7a72, roughness: 0.55, clearcoat: 0.3 }),
  steel: new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, roughness: 0.25, metalness: 1 }),
  dark: new THREE.MeshPhysicalMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.8 }),
  base: new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.8, metalness: 0.2 }),
  bronze: new THREE.MeshPhysicalMaterial({ color: 0xb08a4e, roughness: 0.35, metalness: 0.9 }),
  payload: new THREE.MeshPhysicalMaterial({ color: 0x5fd3ff, roughness: 0.4, metalness: 0.1, clearcoat: 0.4 }),
  magN: new THREE.MeshStandardMaterial({ color: 0xc44a5c, roughness: 0.5, metalness: 0.3 }),
  magS: new THREE.MeshStandardMaterial({ color: 0x4a6fc4, roughness: 0.5, metalness: 0.3 }),
  tooth: new THREE.MeshStandardMaterial({ color: 0xffb35c, roughness: 0.5, emissive: 0x402000 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x8b94a3, roughness: 0.6 }),
  weight: new THREE.MeshPhysicalMaterial({ color: 0x9aa2ad, roughness: 0.3, metalness: 1 }),
};

// A motor body whose glow tracks the power it dissipates.
function heatMaterial() {
  return new THREE.MeshPhysicalMaterial({ color: 0x2e333b, roughness: 0.45, metalness: 0.7, emissive: 0xff5a1f, emissiveIntensity: 0 });
}
export function setHeat(material, watts) {
  // 0 W → no glow, 5 W → full glow. Purely visual.
  material.emissiveIntensity = Math.min(1, watts / 5) * 0.9;
}

function box(w, h, d, m) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.castShadow = o.receiveShadow = true;
  return o;
}
function cyl(r, len, m, seg = 32) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  o.castShadow = o.receiveShadow = true;
  return o;
}

// Helical thread as a tube wound around the x axis.
function helix(radius, length, pitch, tubeR, m) {
  const turns = length / pitch;
  const pts = [];
  const n = Math.ceil(turns * 24);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(-length / 2 + t * length, Math.cos(a) * radius, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const o = new THREE.Mesh(new THREE.TubeGeometry(curve, n, tubeR, 8, false), m);
  o.castShadow = true;
  return o;
}

// Backlash callout: two walls on the driven part, one tooth on the driving part.
function gapCallout() {
  const g = new THREE.Group();
  const walls = new THREE.Group();
  const w1 = box(0.6, 3, 1.4, mat.wall);
  const w2 = box(0.6, 3, 1.4, mat.wall);
  walls.add(w1, w2);
  const tooth = box(1, 2.2, 1.2, mat.tooth);
  g.add(walls, tooth);
  return {
    group: g,
    // gapUnits: full clearance in display units; offset: where the tooth sits, −1..1 of the clearance
    set(gapUnits, toothOffset) {
      const half = gapUnits / 2 + 0.5 + 0.3;
      w1.position.x = -half; w2.position.x = half;
      tooth.position.x = toothOffset;
    },
  };
}

function baseScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x101318, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(20, 40, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 40, bottom: -30 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  floor.receiveShadow = true;
  scene.add(floor);
  return scene;
}

function camera(pos, target) {
  const c = new THREE.PerspectiveCamera(30, 1, 1, 500);
  c.position.set(...pos);
  c.lookAt(new THREE.Vector3(...target));
  c.userData.target = new THREE.Vector3(...target);
  return c;
}

// ---------- Piezo friction drive ----------
function buildPiezo() {
  const scene = baseScene();
  const base = box(72, 3, 12, mat.base); base.position.y = -4.5; scene.add(base);

  const slider = new THREE.Group();
  const rod = box(56, 3, 6, mat.steel); slider.add(rod);
  const strip = box(56, 0.6, 4, mat.ceramic); strip.position.y = 1.8; slider.add(strip);
  const payload = box(8, 8, 8, mat.payload); payload.position.set(32, 2.5, 0); slider.add(payload);
  scene.add(slider);

  // Stationary motor: piezo plate standing on its edge, tip pressed onto the strip.
  const motor = new THREE.Group();
  const plate = box(12, 12, 2, mat.piezo); plate.position.y = 10.6; motor.add(plate);
  const tipShank = cyl(0.9, 2.2, mat.ceramic); tipShank.position.y = 3.6; motor.add(tipShank);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), mat.ceramic); tip.position.y = 2.6; tip.castShadow = true; motor.add(tip);
  const spring = helix(1.5, 6, 1, 0.25, mat.steel); spring.rotation.z = Math.PI / 2; spring.position.y = 19.6; motor.add(spring);
  const housing = box(16, 2, 8, mat.dark); housing.position.y = 23.5; motor.add(housing);
  scene.add(motor);

  const cam = camera([18, 30, 92], [4, 6, 0]);
  let phase = 0;
  return {
    scene, camera: cam,
    update(st, env, dt) {
      slider.position.x = st.x * UNIT_PER_UM;
      // Tip ellipse (1 µm real) shown hugely magnified, slowed down. Stops when powered off.
      if (env.powered && st.state === 'driving') phase += dt * 30;
      const amp = env.powered ? 0.35 : 0;
      motor.position.x = Math.sin(phase) * amp;
      motor.position.y = Math.sin(phase + Math.PI / 2) * amp * 0.6;
    },
  };
}

// ---------- Lead screw + stepper ----------
function buildScrew() {
  const scene = baseScene();
  const base = box(80, 3, 14, mat.base); base.position.y = -4.5; scene.add(base);
  const motorMat = heatMaterial();
  const motor = box(11, 11, 11, motorMat); motor.position.set(-40, 2.5, 0); scene.add(motor);
  const shaft = new THREE.Group(); shaft.position.y = 2.5; scene.add(shaft);
  const core = cyl(1.4, 66, mat.steel); core.rotation.z = Math.PI / 2; core.position.x = -1; shaft.add(core);
  const thread = helix(1.6, 66, 1.6, 0.35, mat.steel); thread.position.x = -1; shaft.add(thread);
  const flat = box(66, 0.3, 0.5, mat.tooth); flat.position.set(-1, 1.5, 0); shaft.add(flat); // shows rotation

  const carriage = new THREE.Group();
  const nut = box(7, 7, 7, mat.bronze); nut.position.y = 2.5; carriage.add(nut);
  const plate = box(14, 1.4, 12, mat.dark); plate.position.y = 6.7; carriage.add(plate);
  const payload = box(8, 8, 8, mat.payload); payload.position.y = 11.4; carriage.add(payload);
  scene.add(carriage);

  const callout = gapCallout(); callout.group.position.set(0, 21, 0); callout.group.scale.setScalar(1.6); carriage.add(callout.group);

  const cam = camera([10, 30, 98], [-2, 6, 0]);
  return {
    scene, camera: cam,
    update(st, env) {
      carriage.position.x = st.x * UNIT_PER_UM;
      shaft.rotation.x = (st.drive / (P.screw.leadMm * 1000)) * Math.PI * 2;
      const gapU = env.backlashUm * GAP_SCALE_UM;
      callout.set(gapU, -st.gap * GAP_SCALE_UM); // tooth moves with the screw, walls with the nut
      setHeat(motorMat, st.holdW);
    },
  };
}

// ---------- Worm gear + DC motor ----------
function buildWorm() {
  const scene = baseScene();
  const base = box(60, 3, 16, mat.base); base.position.y = -4.5; scene.add(base);
  const motorMat = heatMaterial();
  const motor = cyl(4.5, 10, motorMat); motor.rotation.z = Math.PI / 2; motor.position.set(-22, 2, 0); scene.add(motor);

  const worm = new THREE.Group(); worm.position.y = 2; scene.add(worm);
  const core = cyl(2, 24, mat.steel); core.rotation.z = Math.PI / 2; worm.add(core);
  let thread = helix(2.5, 22, 1.8, 0.55, mat.steel); worm.add(thread);

  const WHEEL_R = 11;
  const wheel = new THREE.Group(); wheel.position.set(0, 2 + 2.6 + WHEEL_R, 0); scene.add(wheel);
  const disc = cyl(WHEEL_R - 0.6, 3, mat.bronze, 48); disc.rotation.x = Math.PI / 2; wheel.add(disc);
  for (let i = 0; i < P.worm.teeth; i++) {
    const a = (i / P.worm.teeth) * Math.PI * 2;
    const t = box(0.9, 1.4, 3, mat.bronze);
    t.position.set(Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R, 0);
    t.rotation.z = a + Math.PI / 2;
    wheel.add(t);
  }
  const hub = cyl(1.6, 5, mat.steel); hub.rotation.x = Math.PI / 2; wheel.add(hub);
  // Output arm (the output shaft, in front of the wheel). Load hangs from its tip.
  const arm = new THREE.Group(); arm.position.copy(wheel.position); arm.position.z = 3.5; scene.add(arm);
  const bar = box(24, 1.6, 1.2, mat.payload); bar.position.x = 12; arm.add(bar);
  const string = cyl(0.12, 7, mat.wall, 6); scene.add(string);
  const weight = cyl(2, 3.5, mat.weight); scene.add(weight);

  const callout = gapCallout(); callout.group.position.set(-10, 32, 0); callout.group.scale.setScalar(1.6); scene.add(callout.group);

  const cam = camera([12, 24, 96], [4, 12, 0]);
  let starts = 1;
  return {
    scene, camera: cam,
    update(st, env) {
      if (env.wormStarts !== starts) {
        starts = env.wormStarts;
        worm.remove(thread);
        thread = helix(2.5, 22, 1.8 * starts, 0.55, mat.steel);
        worm.add(thread);
      }
      const ratio = P.worm.teeth / starts;
      worm.rotation.x = (st.drive * ratio * Math.PI) / 180;
      wheel.rotation.z = (st.a * Math.PI) / 180;
      arm.rotation.z = (st.a * Math.PI) / 180;
      const tipX = arm.position.x + Math.cos(arm.rotation.z) * 23;
      const tipY = arm.position.y + Math.sin(arm.rotation.z) * 23;
      string.position.set(tipX, tipY - 3.5, 3.5);
      weight.position.set(tipX, tipY - 8.5, 3.5);
      weight.visible = string.visible = env.loadN > 0.05;
      callout.set(env.wormBacklashArcmin * GAP_SCALE_ARCMIN, -st.gap * GAP_SCALE_ARCMIN);
      setHeat(motorMat, st.holdW);
    },
  };
}

// ---------- Electromagnetic linear motor ----------
function buildMagnet() {
  const scene = baseScene();
  const base = box(80, 3, 14, mat.base); base.position.y = -4.5; scene.add(base);
  const POLE = 5;
  for (let i = -7; i <= 7; i++) {
    const m = box(POLE - 0.3, 1.6, 10, i % 2 ? mat.magN : mat.magS);
    m.position.set(i * POLE, -2.2, 0);
    scene.add(m);
  }
  // Field map on a vertical plane behind the track: |B| ∝ exp(−π·y/τ), with the pole pattern.
  const fieldMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { tau: { value: POLE } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      uniform float tau; varying vec2 vP;
      void main(){
        float y = vP.y + 15.0;                       // plane spans y = −1.4 .. 28.6 above the track
        float b = exp(-3.14159 * y / (tau * 3.0)); // decay stretched ×3 so it reads at this scale
        float lines = 0.5 + 0.5 * cos(3.14159 * vP.x / tau);
        float a = clamp(b * (0.55 + 0.45 * lines) * 1.2, 0.0, 0.85);
        gl_FragColor = vec4(mix(vec3(0.37,0.83,1.0), vec3(1.0,0.42,0.54), clamp(b*2.0,0.,1.)), a);
      }`,
  });
  const field = new THREE.Mesh(new THREE.PlaneGeometry(76, 30), fieldMat);
  field.position.set(0, 13.6, -5.5);
  scene.add(field);

  const forcer = new THREE.Group();
  const coilMat = heatMaterial();
  coilMat.color.set(0x8a5a2b);
  const coil = box(15, 3.4, 9, coilMat); coil.position.y = 0.6; forcer.add(coil);
  const plate = box(16, 1.2, 12, mat.dark); plate.position.y = 2.9; forcer.add(plate);
  const payload = box(8, 8, 8, mat.payload); payload.position.y = 7.5; forcer.add(payload);
  scene.add(forcer);

  const cam = camera([10, 26, 98], [0, 5, 0]);
  return {
    scene, camera: cam,
    update(st) {
      forcer.position.x = st.x * UNIT_PER_UM;
      setHeat(coilMat, st.holdW);
    },
  };
}

export function buildScenes(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const all = { piezo: buildPiezo(), screw: buildScrew(), worm: buildWorm(), magnet: buildMagnet() };
  for (const k in all) {
    all[k].scene.environment = env;
  }
  return all;
}

export { piezoHoldN };
