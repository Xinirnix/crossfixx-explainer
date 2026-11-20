// 3D scene: one rod in two bearings on a frame, with three interchangeable drives under it.
// Units are millimetres. The underside of the rod (the contact line) is y = 0.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const ROD_R = 3.5;
export const RING_PITCH = 8;    // spacing of the marks on the rod
export const BEARING_X = 42;

const mat = {
  piezo: new THREE.MeshPhysicalMaterial({ color: 0x7f7a72, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
  electrode: new THREE.MeshPhysicalMaterial({ color: 0xc9a86a, roughness: 0.3, metalness: 1 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf3f0ea, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
  rod: new THREE.MeshPhysicalMaterial({ color: 0xe9ecef, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
  steel: new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 1 }),
  dark: new THREE.MeshPhysicalMaterial({ color: 0x3a3f47, roughness: 0.35, metalness: 0.9 }),
  frame: new THREE.MeshPhysicalMaterial({ color: 0x2b3340, roughness: 0.45, metalness: 0.6 }),
  mark: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }),
};

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A column of `n` layers that can be sheared (top moves dx) and stretched (top moves dy).
function column({ w, h, d, n, top }) {
  const g = new THREE.Group();
  const layers = [];
  const ph = top.parameters.height;
  const lh = (h - ph) / n;
  for (let i = 0; i < n; i++) {
    const l = mesh(new THREE.BoxGeometry(w, lh * 0.82, d), mat.piezo);
    const e = mesh(new THREE.BoxGeometry(w * 1.01, lh * 0.18, d * 1.01), mat.electrode);
    e.position.y = lh * 0.5;
    l.add(e);
    g.add(l);
    layers.push(l);
  }
  const pad = mesh(top, mat.ceramic);
  g.add(pad);
  // dx, dy in display mm at the top of the column; the base is fixed at y = -h.
  g.userData.set = (dx, dy) => {
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      layers[i].position.set(dx * s, -h + (i + 0.5) * lh * (1 + dy / (h - ph)), 0);
      layers[i].scale.y = 1 + dy / (h - ph);
    }
    pad.position.set(dx, dy - ph / 2, 0);
  };
  g.userData.set(0, 0);
  return g;
}

function glowDisc() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0, depthWrite: false }),
  );
  m.renderOrder = 2;
  return m;
}

export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(30, 70, 50);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -80, right: 80, top: 60, bottom: -60, near: 1, far: 220 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.1);
  rim.position.set(-40, 20, -60);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0c10, 0.25));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x131820, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -34;
  floor.receiveShadow = true;
  scene.add(floor);

  // Everything that is bolted together shakes together.
  const frame = new THREE.Group();
  scene.add(frame);

  const base = mesh(new THREE.BoxGeometry(110, 5, 34), mat.frame);
  base.position.y = -30;
  frame.add(base);
  for (const sx of [-1, 1]) {
    const post = mesh(new THREE.BoxGeometry(8, 30 + ROD_R + 6, 16), mat.frame);
    post.position.set(sx * BEARING_X, (-27.5 + ROD_R + 6) / 2 - 0.5, 0);
    frame.add(post);
    const ring = mesh(new THREE.TorusGeometry(ROD_R + 1.2, 1.2, 12, 40), mat.dark);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(sx * BEARING_X - sx * 4.4, ROD_R, 0);
    frame.add(ring);
  }
  // Preload: a spring pushes a roller down on the rod, pressing it onto whichever drive is fitted.
  const roller = mesh(new THREE.CylinderGeometry(2.4, 2.4, 9, 24), mat.steel);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(0, 2 * ROD_R + 2.4, 0);
  frame.add(roller);
  const yoke = mesh(new THREE.BoxGeometry(3, 14, 12), mat.frame);
  yoke.position.set(0, 2 * ROD_R + 2.4 + 9, 0);
  frame.add(yoke);
  const bridge = mesh(new THREE.BoxGeometry(2 * BEARING_X + 8, 3, 16), mat.frame);
  bridge.position.set(0, 2 * ROD_R + 17.5, 0);
  frame.add(bridge);

  // The rod (moves along x). Marks every RING_PITCH mm make its travel visible.
  const rod = new THREE.Group();
  rod.position.y = ROD_R;
  frame.add(rod);
  const body = mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, 150, 40), mat.rod);
  body.rotation.z = Math.PI / 2;
  rod.add(body);
  for (let x = -72; x <= 72; x += RING_PITCH) {
    const mk = new THREE.Mesh(new THREE.CylinderGeometry(ROD_R + 0.03, ROD_R + 0.03, 0.7, 40), mat.mark);
    mk.rotation.z = Math.PI / 2;
    mk.position.x = x;
    rod.add(mk);
  }

  // ---------- drives (all sit on the base, top at y = 0) ----------
  const H = 24;
  const drives = {};

  // Stick-slip: a shear stack with a friction pad. Shear moves the pad along x.
  {
    const g = new THREE.Group();
    const col = column({ w: 10, h: H, d: 10, n: 6, top: new THREE.BoxGeometry(10, 1.6, 10) });
    g.add(col);
    const glow = glowDisc();
    g.add(glow);
    drives.stickslip = { group: g, z: 5.1, legs: [{ col, glow, x0: 0 }] };
  }
  // Walking: two bimorph legs, half a cycle apart.
  {
    const g = new THREE.Group();
    const legs = [];
    for (const x0 of [-6.5, 6.5]) {
      const col = column({ w: 5, h: H, d: 9, n: 6, top: new THREE.BoxGeometry(5, 1.6, 9) });
      col.position.x = x0;
      g.add(col);
      const glow = glowDisc();
      glow.position.x = x0;
      g.add(glow);
      legs.push({ col, glow, x0 });
    }
    drives.walking = { group: g, z: 4.6, legs };
  }
  // Ultrasonic (CrossFixx-style): a resonator plate on a stand with a ceramic tip on top.
  {
    const g = new THREE.Group();
    const stand = mesh(new THREE.BoxGeometry(4, H - 16, 6), mat.dark);
    stand.position.y = -H + (H - 16) / 2;
    g.add(stand);
    const plate = mesh(new THREE.BoxGeometry(16, 12, 2.4), mat.piezo);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const e = mesh(new THREE.BoxGeometry(7, 5, 0.1), mat.electrode);
      e.position.set(sx * 3.9, sy * 3, 1.25);
      plate.add(e);
    }
    plate.position.y = -9;
    g.add(plate);
    const tip = mesh(new THREE.SphereGeometry(1.4, 24, 16), mat.ceramic);
    const shank = mesh(new THREE.CylinderGeometry(1.1, 1.3, 2.2, 20), mat.ceramic);
    shank.position.y = -1.6;
    tip.add(shank);
    g.add(tip);
    const glow = glowDisc();
    g.add(glow);
    const col = {
      userData: {
        set(dx, dy) {
          tip.position.set(dx, dy - 1.4, 0);
          plate.position.set(dx * 0.35, -9 + dy * 0.35, 0);
          plate.rotation.z = -dx * 0.01;
        },
      },
    };
    col.userData.set(0, 0);
    drives.ultrasonic = { group: g, z: 1.6, legs: [{ col, glow, x0: 0 }] };
  }
  for (const d of Object.values(drives)) frame.add(d.group);

  // Ghost path of each contact over one cycle (display scale), redrawn when the model changes.
  const paths = new THREE.Group();
  frame.add(paths);

  function setPaths(list, z) {
    paths.clear();
    paths.position.z = z;
    for (const { pts, color } of list) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
      paths.add(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })));
    }
  }

  return { scene, frame, rod, drives, setPaths };
}
