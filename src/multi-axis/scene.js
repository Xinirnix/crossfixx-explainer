// Scene: a serial stack built from primitive geometry. Units are millimetres, y is up.
// Each stage is a pair of groups: `outer` sits at the stage's pivot and carries its (exaggerated)
// error rotation and translation; `inner` undoes the pivot offset, so child parts are placed in
// nominal world coordinates. Children of a stage go inside its `inner`, so errors accumulate
// up the stack exactly as δ = Σ t + ω × (tip − pivot) says.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GEO } from './errors.js';

const mat = {
  body: new THREE.MeshPhysicalMaterial({ color: 0x2a2f37, roughness: 0.45, metalness: 0.7 }),
  carriage: new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, roughness: 0.25, metalness: 1.0, clearcoat: 0.2 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf3f0ea, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 }),
  bracket: new THREE.MeshPhysicalMaterial({ color: 0x5a6472, roughness: 0.4, metalness: 0.8 }),
  arm: new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, roughness: 0.2, metalness: 1.0 }),
  tip: new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xffb35c, emissiveIntensity: 0.6 }),
  ghost: new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.55, depthWrite: false }),
  mark: new THREE.MeshPhysicalMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.3 }),
};

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function label(text, cls = '') {
  const div = document.createElement('div');
  div.className = `part-label ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(80, 160, 90);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 500 });
  scene.add(key, new THREE.HemisphereLight(0x9fb4d0, 0x101317, 0.6));

  const floor = mesh(new THREE.CircleGeometry(260, 64), new THREE.MeshStandardMaterial({ color: 0x0f1217, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  scene.add(floor);
  const grid = new THREE.GridHelper(400, 40, 0x1c222b, 0x151a21);
  grid.position.y = 0;
  scene.add(grid);
  return scene;
}

// A linear stage lying along `axis` ('x' | 'z'), or standing ('y'), with its base at `base`.
function linearStage(axis, name) {
  const g = new THREE.Group();
  const { linH: H, linL: L, linW: W } = GEO;
  const bodyH = H * 0.55;
  const dims = axis === 'x' ? [L, bodyH, W] : [W, bodyH, L];
  const body = mesh(new THREE.BoxGeometry(...dims), mat.body);
  body.position.y = bodyH / 2;
  const car = mesh(new THREE.BoxGeometry(axis === 'x' ? L * 0.55 : W * 0.9, H - bodyH, axis === 'x' ? W * 0.9 : L * 0.55), mat.carriage);
  car.position.y = bodyH + (H - bodyH) / 2;
  // ceramic drive strip along the travel direction, on the side
  const strip = mesh(new THREE.BoxGeometry(axis === 'x' ? L * 0.9 : 0.8, bodyH * 0.5, axis === 'x' ? 0.8 : L * 0.9), mat.ceramic);
  if (axis === 'x') strip.position.set(0, bodyH / 2, W / 2 + 0.4); else strip.position.set(W / 2 + 0.4, bodyH / 2, 0);
  g.add(body, car, strip);
  const lab = label(name);
  lab.position.set(axis === 'x' ? L / 2 + 4 : -W / 2 - 4, H / 2, axis === 'x' ? 0 : L / 2 + 4);
  g.add(lab);
  return g;
}

function rotaryStage() {
  const g = new THREE.Group();
  const { rotH: H, rotR: R } = GEO;
  const body = mesh(new THREE.CylinderGeometry(R, R, H * 0.6, 64), mat.body);
  body.position.y = H * 0.3;
  g.add(body);
  const lab = label('Rotary stage (XRT-U-40 class)');
  lab.position.set(-R - 6, H / 2, 0);
  g.add(lab);
  return g;
}

/**
 * Build the stack for a config. Returns the root group and handles:
 * frames: [{ stage, outer, inner }] in stack order; spin: the group the rotary turns;
 * tipMesh, ghost (nominal tip), and label anchors.
 */
export function buildStack(geo, armDir, armLength) {
  const root = new THREE.Group();
  const frames = [];
  let parent = root;
  let spin = null;

  for (const st of geo.stages) {
    const outer = new THREE.Group();
    outer.position.set(...st.pivot);
    const inner = new THREE.Group();
    inner.position.set(-st.pivot[0], -st.pivot[1], -st.pivot[2]);
    outer.add(inner);
    parent.add(outer);

    if (st.kind === 'linear' && st.axis !== 'y') {
      const part = linearStage(st.axis, st.axis === 'x' ? 'X stage (XLS)' : 'Y stage (XLS)');
      part.position.set(...st.base);
      inner.add(part);
    } else if (st.kind === 'linear') {
      // Z: L-bracket on the Y carriage, Z stage standing against it, carriage facing +x.
      const b = new THREE.Group();
      b.position.set(...st.base);
      const foot = mesh(new THREE.BoxGeometry(34, 4, 34), mat.bracket);
      foot.position.set(GEO.bracketX + 13, 2, 0);
      const wall = mesh(new THREE.BoxGeometry(4, GEO.bracketH + 20, 34), mat.bracket);
      wall.position.set(GEO.bracketX - 2, 4 + (GEO.bracketH + 20) / 2, 0);
      b.add(foot, wall);
      inner.add(b);
      const z = linearStage('x', 'Z stage on L-bracket');
      z.rotation.z = Math.PI / 2; // lay the x-stage on its back: travel now along y, carriage faces -x
      z.rotation.y = Math.PI;      // turn it so the carriage faces +x
      z.position.set(GEO.bracketX, st.base[1] + 4 + GEO.linL / 2, 0);
      inner.add(z);
    } else {
      // The stator does not wobble; it sits in the frame below. Only what the bearing carries does.
      const part = rotaryStage();
      part.position.set(...st.base);
      parent.add(part);
      // Ideal axis (fixed) and actual axis (carried by the error frame), as vertical lines.
      const yTop = geo.tip[1] + 25;
      const ideal = axisLine(st.pivot, st.pivot[1] - 12, yTop, 0x5fd3ff, true);
      parent.add(ideal);
      const actual = axisLine(st.pivot, st.pivot[1] - 12, yTop, 0xffb35c, false);
      inner.add(actual);
      // the turning platter + everything on it
      spin = new THREE.Group();
      spin.position.set(st.pivot[0], 0, st.pivot[2]);
      const spinInner = new THREE.Group();
      spinInner.position.set(-st.pivot[0], 0, -st.pivot[2]);
      spin.add(spinInner);
      const platter = mesh(new THREE.CylinderGeometry(GEO.rotR * 0.92, GEO.rotR * 0.92, GEO.rotH * 0.4, 64), mat.carriage);
      platter.position.set(st.base[0], st.base[1] + GEO.rotH * 0.8, st.base[2]);
      const tick = mesh(new THREE.BoxGeometry(GEO.rotR * 0.6, 0.4, 1.6), mat.mark);
      tick.position.set(st.base[0] + GEO.rotR * 0.55, st.base[1] + GEO.rotH + 0.2, st.base[2] + 6);
      spinInner.add(platter, tick);
      inner.add(spin);
      frames.push({ stage: st, outer, inner: spinInner });
      parent = spinInner;
      continue;
    }
    frames.push({ stage: st, outer, inner });
    parent = inner;
  }

  // Tool arm, attached to the top stage (inside its frame, so it inherits every error).
  const arm = new THREE.Group();
  const top = geo.top;
  const clamp = mesh(new THREE.BoxGeometry(8, 8, 8), mat.bracket);
  const r = 1.6;
  let rod;
  if (armDir === 'up') {
    clamp.position.set(top[0], top[1] + 4, top[2]);
    rod = mesh(new THREE.CylinderGeometry(r, r, Math.max(armLength, 0.01), 24), mat.arm);
    rod.position.set(top[0], top[1] + 4 + armLength / 2, top[2]);
  } else {
    clamp.position.set(top[0], top[1] + 4, top[2]);
    rod = mesh(new THREE.CylinderGeometry(r, r, Math.max(armLength, 0.01), 24), mat.arm);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(top[0] + 4 + armLength / 2, top[1] + 4, top[2]);
  }
  rod.visible = armLength > 0.5;
  const tipMesh = mesh(new THREE.SphereGeometry(2.2, 24, 16), mat.tip);
  tipMesh.position.set(...geo.tip);
  const tipLabel = label('tip');
  tipLabel.position.set(4, 4, 0);
  tipMesh.add(tipLabel);
  arm.add(clamp, rod, tipMesh);
  parent.add(arm);

  // Ghost: where the tip would be with perfect stages (world space, set every frame).
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), mat.ghost);
  const ghostLabel = label('ideal');
  ghostLabel.position.set(0, -6, 0);
  ghost.add(ghostLabel);
  root.add(ghost);

  return { root, frames, spin, tipMesh, ghost };
}

function axisLine(p, y0, y1, color, dashed) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p[0], y0, p[2]), new THREE.Vector3(p[0], y1, p[2])]);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2.5, transparent: true, opacity: 0.8 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const l = new THREE.Line(geo, m);
  if (dashed) l.computeLineDistances();
  return l;
}

// Polyline helper for the tip trail and the axis lines.
export function polyline(color, n, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const m = opts.dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.7 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  const line = new THREE.Line(geo, m);
  line.frustumCulled = false;
  return line;
}
