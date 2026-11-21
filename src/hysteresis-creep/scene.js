// 3D view: a piezo stack on a base, its top cap carrying a pointer over a scale.
// Units are millimetres, y is up. The length change is drawn EXAG times larger than real.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { P } from './model.js';

export const EXAG = 400;          // drawn length change per real length change
const N_LAYERS = 28;              // discs drawn (a real stack has hundreds of thinner layers)
const R = 7;                      // stack radius
const BASE_TOP = 0;
const SCALE_X = 20;               // x of the scale post
const UM = EXAG / 1000;           // mm drawn per µm

const mat = {
  base: new THREE.MeshPhysicalMaterial({ color: 0x2a3039, roughness: 0.5, metalness: 0.7 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0x8a847a, roughness: 0.6, clearcoat: 0.3 }),
  electrode: new THREE.MeshPhysicalMaterial({ color: 0xc9cfd6, roughness: 0.25, metalness: 1, emissive: 0xffb35c, emissiveIntensity: 0 }),
  cap: new THREE.MeshPhysicalMaterial({ color: 0xb8bec6, roughness: 0.22, metalness: 1 }),
  post: new THREE.MeshPhysicalMaterial({ color: 0x3a414c, roughness: 0.45, metalness: 0.75 }),
  hot: new THREE.MeshBasicMaterial({ color: 0xffb35c }),
  cool: new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.85 }),
  ghost: new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.12, depthWrite: false }),
  tick: new THREE.MeshBasicMaterial({ color: 0x8b94a3 }),
};

function label(text, cls = '') {
  const div = document.createElement('div');
  div.className = `part-label ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  const css = new CSS2DRenderer();
  css.domElement.className = 'labels';
  host.appendChild(css.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(30, 60, 40);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 1000);
  camera.position.set(28, 36, 108);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(8, 28, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 60;
  controls.maxDistance = 220;

  // Base and scale post
  const base = new THREE.Mesh(new THREE.BoxGeometry(56, 6, 26), mat.base);
  base.position.set(6, BASE_TOP - 3, 0);
  scene.add(base);
  const post = new THREE.Mesh(new THREE.BoxGeometry(3, 60, 3), mat.post);
  post.position.set(SCALE_X, 30, 0);
  scene.add(post);

  // Stack: ceramic discs with electrodes between them, in a group scaled along y.
  const stack = new THREE.Group();
  const layerH = P.STACK_MM / N_LAYERS;
  const discGeo = new THREE.CylinderGeometry(R, R, layerH * 0.86, 48);
  const elGeo = new THREE.CylinderGeometry(R * 0.98, R * 0.98, layerH * 0.14, 48);
  for (let i = 0; i < N_LAYERS; i++) {
    const d = new THREE.Mesh(discGeo, mat.ceramic);
    d.position.y = (i + 0.5) * layerH;
    const e = new THREE.Mesh(elGeo, mat.electrode);
    e.position.y = (i + 1) * layerH - layerH * 0.07;
    stack.add(d, e);
  }
  scene.add(stack);

  // Top cap with a pointer arm to the scale
  const top = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + 1, R + 1, 3, 48), mat.cap);
  cap.position.y = 1.5;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(SCALE_X - 2, 1.2, 1.2), mat.cap);
  arm.position.set((SCALE_X - 2) / 2 + 1, 1.5, 0);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 4), mat.hot);
  tip.position.set(SCALE_X, 1.5, 0);
  top.add(cap, arm, tip);
  scene.add(top);

  // Ghost: where the straight-line calibration says the top should be
  const ghost = new THREE.Group();
  const gCap = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.05, R + 1.05, 3, 48), mat.ghost);
  gCap.position.y = 1.5;
  const gTick = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 4.2), mat.cool);
  gTick.position.set(SCALE_X, 1.5, 0);
  ghost.add(gCap, gTick);
  scene.add(ghost);

  // Scale ticks every 5 µm, from the zero-voltage height
  const y0 = BASE_TOP + P.STACK_MM + 1.5;
  for (let um = 0; um <= 35; um += 5) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(um % 10 === 0 ? 3 : 1.8, 0.25, 0.3), mat.tick);
    t.position.set(SCALE_X + 2.6 + (um % 10 === 0 ? 0.6 : 0), y0 + um * UM, 1.6);
    scene.add(t);
    if (um % 10 === 0) {
      const l = label(`${um} µm`, 'tick');
      l.position.set(SCALE_X + 7.5, y0 + um * UM, 1.6);
      scene.add(l);
    }
  }

  const lActual = label('actual', 'hot');
  lActual.position.set(SCALE_X - 3, 3.8, 0);
  top.add(lActual);
  const lGhost = label('straight line', 'cool');
  lGhost.position.set(-R - 2, 1.5, 0);
  lGhost.center.set(1, 0.5);
  ghost.add(lGhost);
  const lStack = label('piezo stack', '');
  lStack.position.set(-R - 2, P.STACK_MM * 0.4, 0);
  lStack.center.set(1, 0.5);
  scene.add(lStack);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    css.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // x, guess in µm; v in volts
  function update(x, guess, v) {
    const L = P.STACK_MM + x * UM;
    stack.scale.y = L / P.STACK_MM;
    top.position.y = BASE_TOP + L;
    ghost.position.y = BASE_TOP + P.STACK_MM + guess * UM;
    mat.electrode.emissiveIntensity = 0.9 * (v / P.V_MAX);
    // Hide the guess label when the two are on top of each other
    lGhost.element.style.opacity = Math.abs(x - guess) * UM > 1.2 ? 1 : 0.35;
    controls.update();
    renderer.render(scene, camera);
    css.render(scene, camera);
  }

  return { update };
}
