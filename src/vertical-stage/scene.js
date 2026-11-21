// Vertical stage geometry: primitives only. Units are millimetres, y is up.
// Layout, seen from the front: CrossFixx motor on the LEFT pressing a ceramic strip on the
// carriage; mass compensation (tension spring or magnet) on the RIGHT; payload on top.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export const BASE_Y = 6;            // top of the base plate
export const CAR_Y0 = 12;           // carriage bottom at z = 0
export const CAR_H = 56;            // carriage height
export const CAR_W = 34;
export const COL_TOP = 124;         // top of the fixed column
export const CONTACT_Y = 58;        // fixed height where the motor tip touches the strip
export const STRIP_X = -CAR_W / 2 - 1; // strip face (contact plane) on the carriage's left side
export const N_TO_MM = 9;           // force arrow length per newton

const mat = {
  base: new THREE.MeshPhysicalMaterial({ color: 0x2a3039, roughness: 0.5, metalness: 0.7 }),
  column: new THREE.MeshPhysicalMaterial({ color: 0x3a414c, roughness: 0.45, metalness: 0.75 }),
  carriage: new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.85 }),
  rail: new THREE.MeshPhysicalMaterial({ color: 0xc9cfd6, roughness: 0.18, metalness: 1.0 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf3f0ea, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
  piezo: new THREE.MeshPhysicalMaterial({ color: 0x7f7a72, roughness: 0.55, clearcoat: 0.35 }),
  housing: new THREE.MeshPhysicalMaterial({
    color: 0x2b3340, roughness: 0.45, metalness: 0.6, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
  }),
  steel: new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 1.0 }),
  magnet: new THREE.MeshPhysicalMaterial({ color: 0x8c96a4, roughness: 0.25, metalness: 0.9, clearcoat: 0.6 }),
  stator: new THREE.MeshPhysicalMaterial({ color: 0x5c6470, roughness: 0.35, metalness: 0.95 }),
  payload: new THREE.MeshPhysicalMaterial({ color: 0xc89a4a, roughness: 0.28, metalness: 1.0 }),
  stop: new THREE.MeshPhysicalMaterial({ color: 0x14171c, roughness: 0.8 }),
};

function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function box(w, h, d, material, x, y, z, opts) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material, opts);
  m.position.set(x, y, z);
  return m;
}

export function label(text, cls = '') {
  const div = document.createElement('div');
  div.className = `part-label ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

// Helix along +y from 0 to `length` (unit length by default; the preload spring is scaled).
export function helixGeometry(radius, wire, turns, length = 1) {
  class Helix extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      return target.set(Math.cos(a) * radius, t * length, Math.sin(a) * radius);
    }
  }
  return new THREE.TubeGeometry(new Helix(), turns * 32, wire, 8, false);
}

// Flat arrow made of a shaft and a cone, pointing +y. setForce() sets direction and length.
function forceArrow(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 12), m);
  const head = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 16), m);
  shaft.renderOrder = head.renderOrder = 10;
  g.add(shaft, head);
  g.setForce = (newtons) => {
    const len = Math.abs(newtons) * N_TO_MM;
    g.visible = len > 0.8;
    const dir = Math.sign(newtons) || 1;
    const shaftLen = Math.max(0.01, len - 5);
    shaft.scale.y = shaftLen;
    shaft.position.y = (dir * shaftLen) / 2;
    head.position.y = dir * (shaftLen + 2.5);
    head.rotation.z = dir > 0 ? 0 : Math.PI;
  };
  return g;
}

export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 500, 1100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(60, 140, 90);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -110, right: 110, top: 160, bottom: -40, near: 1, far: 400 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.1);
  rim.position.set(-80, 60, -100);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0c10, 0.3));

  const floor = mesh(new THREE.CircleGeometry(260, 64), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.9 }), { cast: false });
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const labels = {};
  const addLabel = (parent, key, text, pos, cls) => {
    const l = label(text, cls);
    l.position.copy(pos);
    parent.add(l);
    labels[key] = l;
    return l;
  };

  // ---------- Fixed parts ----------
  const fixed = new THREE.Group();
  scene.add(fixed);
  fixed.add(box(96, BASE_Y, 52, mat.base, 0, BASE_Y / 2, 0));
  const colH = COL_TOP - BASE_Y;
  fixed.add(box(CAR_W + 6, colH, 10, mat.column, 0, BASE_Y + colH / 2, -12));
  for (const sx of [-1, 1]) fixed.add(box(3, colH - 8, 3, mat.rail, sx * 12, BASE_Y + colH / 2, -5.5));
  // End stops (rubber bumpers) at the bottom and top of the stroke
  fixed.add(box(CAR_W - 6, 4, 6, mat.stop, 0, CAR_Y0 - 2, -2));
  fixed.add(box(48, 6, 26, mat.column, 8, COL_TOP + 3, -2)); // top bridge that carries the spring / stator
  addLabel(fixed, 'column', 'Fixed column + guide rails', new THREE.Vector3(34, BASE_Y + 4, 20));

  // ---------- Motor (fixed to the column, left side) ----------
  const motor = new THREE.Group();
  fixed.add(motor);
  const hx = STRIP_X - 14; // housing centre x
  motor.add(box(22, 24, 14, mat.housing, hx - 2, CONTACT_Y, 0, { cast: false }));
  motor.add(box(4, 30, 8, mat.column, hx - 12, CONTACT_Y, -6)); // bracket to column
  motor.add(box(Math.abs(hx - 12) - CAR_W / 2 - 3, 6, 6, mat.column, (hx - 12 - CAR_W / 2 - 3) / 2, CONTACT_Y + 14, -12));
  // Piezo plate stands vertical, its tip points +x into the strip
  const plateGroup = new THREE.Group();
  plateGroup.position.set(hx, CONTACT_Y, 0);
  motor.add(plateGroup);
  plateGroup.add(mesh(new THREE.BoxGeometry(2, 14, 10), mat.piezo));
  const tip = new THREE.Group();
  plateGroup.add(tip);
  const tipShank = mesh(new THREE.CylinderGeometry(0.9, 1.2, 9, 20), mat.ceramic);
  tipShank.rotation.z = -Math.PI / 2;
  tipShank.position.x = 5.5;
  tip.add(tipShank);
  const tipBall = mesh(new THREE.SphereGeometry(1.25, 24, 16), mat.ceramic);
  tipBall.position.x = STRIP_X - hx - 1.25;
  tip.add(tipBall);
  // Horizontal preload spring behind the plate (pushes the tip into the strip)
  const preload = mesh(helixGeometry(2.4, 0.35, 6), mat.steel);
  preload.rotation.z = Math.PI / 2;
  preload.scale.y = 9;
  preload.position.set(hx - 1.5, CONTACT_Y, 0);
  motor.add(preload);
  addLabel(motor, 'motor', 'CrossFixx motor', new THREE.Vector3(hx - 4, CONTACT_Y + 17, 0), 'left');
  addLabel(motor, 'preload', 'preload spring → friction', new THREE.Vector3(hx - 10, CONTACT_Y - 16, 0), 'left');

  // ---------- Carriage (moves with z) ----------
  const carriage = new THREE.Group();
  scene.add(carriage);
  carriage.add(box(CAR_W, CAR_H, 8, mat.carriage, 0, CAR_H / 2, 0));
  for (const sx of [-1, 1]) carriage.add(box(6, CAR_H - 6, 4, mat.carriage, sx * 12, CAR_H / 2, -5)); // rail blocks
  carriage.add(box(1.6, CAR_H - 4, 7, mat.ceramic, STRIP_X + 0.8, CAR_H / 2, 0)); // ceramic strip
  carriage.add(box(CAR_W, 3, 36, mat.carriage, 0, CAR_H + 1.5, 12)); // payload platform
  const lug = box(10, 6, 8, mat.carriage, CAR_W / 2 + 5, CAR_H - 3, 0); // compensation attachment
  carriage.add(lug);
  addLabel(carriage, 'strip', 'ceramic strip', new THREE.Vector3(STRIP_X - 2, CAR_H - 10, 6), 'left');

  // Payload: a brass block whose size follows its mass
  const payload = mesh(new THREE.BoxGeometry(1, 1, 1), mat.payload);
  carriage.add(payload);
  const payloadLabel = addLabel(carriage, 'payload', '', new THREE.Vector3(0, CAR_H + 30, 14));

  // ---------- Compensation (right side) ----------
  const LUG_X = CAR_W / 2 + 5;
  const spring = new THREE.Group();
  scene.add(spring);
  const coil = mesh(helixGeometry(3.6, 0.45, 14), mat.steel);
  spring.add(coil);
  const hookTop = box(1.2, 4, 1.2, mat.steel, 0, 0, 0);
  spring.add(hookTop);
  spring.position.x = LUG_X;

  const magnet = new THREE.Group();
  scene.add(magnet);
  const statorLen = COL_TOP - CAR_Y0;
  const stator = box(5, statorLen, 10, mat.stator, LUG_X + 9, CAR_Y0 + statorLen / 2, 0);
  magnet.add(stator);
  const magBlock = box(5, 14, 9, mat.magnet, 0, 0, 0); // NdFeB slider rides on the carriage
  magnet.add(magBlock);

  const compLabel = addLabel(scene, 'comp', '', new THREE.Vector3(LUG_X + 22, 100, 0), 'right');

  // ---------- Force arrows ----------
  const arrows = {
    weight: forceArrow(0xff6b8a),
    comp: forceArrow(0x5fd3ff),
    net: forceArrow(0xffb35c),
  };
  scene.add(arrows.weight, arrows.comp, arrows.net);
  const netLabel = label('', 'note');
  arrows.net.add(netLabel);
  netLabel.position.set(-2, -6, 0);

  // Sag note (display exaggeration of the µm-level elastic sag)
  const sagLabel = addLabel(scene, 'sag', '', new THREE.Vector3(STRIP_X - 34, CONTACT_Y - 30, 0), 'note left');

  return {
    scene,
    carriage,
    payload,
    payloadLabel,
    tip,
    tipBallX: tipBall.position.x,
    spring,
    coil,
    hookTop,
    magnet,
    magBlock,
    compLabel,
    arrows,
    netLabel,
    sagLabel,
    labels,
    LUG_X,
  };
}
