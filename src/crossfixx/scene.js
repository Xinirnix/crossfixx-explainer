// Scene construction: primitive geometry only. Units are millimetres.
// The strip surface (contact plane) is y = 0; the tip touches it at the origin.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export const PLATE = 16;          // piezo plate edge
export const PLATE_T = 2;         // plate thickness
export const TIP_R = 1.3;         // tip radius
export const TIP_H = 2.4;         // tip shank height above its rounded end
export const PLATE_CY = TIP_R + TIP_H + PLATE / 2; // plate centre height
export const ROD_R = 3.5;
export const STRIP_T = 0.8;
export const ROTOR_R = 20;        // outer radius of the ceramic band on the rotor

// Exploded offsets along Y, per part group.
export const EXPLODE = {
  frame: 26,
  plate: 15,
  tip: 7,
  strip: -5,
  driven: -12,
};

const mat = {
  piezo: new THREE.MeshPhysicalMaterial({
    color: 0x7f7a72, roughness: 0.55, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.4,
  }),
  ceramic: new THREE.MeshPhysicalMaterial({
    color: 0xf3f0ea, roughness: 0.32, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.15, sheen: 0.2,
  }),
  strip: new THREE.MeshPhysicalMaterial({
    color: 0xe9ecef, roughness: 0.28, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.1,
  }),
  steel: new THREE.MeshPhysicalMaterial({
    color: 0xb8bec6, roughness: 0.22, metalness: 1.0, clearcoat: 0.2,
  }),
  darkSteel: new THREE.MeshPhysicalMaterial({
    color: 0x3a3f47, roughness: 0.35, metalness: 0.9,
  }),
  frame: new THREE.MeshPhysicalMaterial({
    color: 0x2b3340, roughness: 0.45, metalness: 0.6, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  mark: new THREE.MeshPhysicalMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.3 }),
};

function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function label(text, cls = '') {
  const div = document.createElement('div');
  div.className = `part-label ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 110, 220);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  // Studio lights
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(30, 60, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.2);
  rim.position.set(-40, 20, -50);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0c10, 0.25));

  // Floor with soft falloff
  const floorTex = radialTexture();
  const floor = mesh(
    new THREE.CircleGeometry(140, 64),
    new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.9, map: floorTex }),
    { cast: false },
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -46;
  scene.add(floor);

  const labels = [];
  const addLabel = (parent, text, pos, cls) => {
    const l = label(text, cls);
    l.position.copy(pos);
    parent.add(l);
    labels.push(l);
    return l;
  };

  // ---------- Motor ----------
  const motor = new THREE.Group();
  scene.add(motor);

  // Frame (cutaway: back wall and top only, front left open) + preload spring
  const frame = new THREE.Group();
  motor.add(frame);
  const yTop = PLATE_CY + PLATE / 2 + 11;
  const back = mesh(new THREE.BoxGeometry(28, yTop - 2, 1.2), mat.frame, { cast: false });
  back.position.set(0, (yTop + 2) / 2, -4.2);
  frame.add(back);
  const top = mesh(new THREE.BoxGeometry(28, 2, 9), mat.frame, { cast: false });
  top.position.set(0, yTop + 1, -0.2);
  frame.add(top);
  for (const sx of [-1, 1]) {
    const post = mesh(new THREE.BoxGeometry(1.2, yTop - 2, 9), mat.frame, { cast: false });
    post.position.set(sx * 13.4, (yTop + 2) / 2, -0.2);
    post.scale.z = 1;
    frame.add(post);
  }
  const springBottom = PLATE_CY + PLATE / 2 + 2.2;
  const spring = mesh(helixGeometry(2.6, 0.38, springBottom, yTop, 7), mat.steel);
  frame.add(spring);
  addLabel(frame, 'Preload spring', new THREE.Vector3(9, (springBottom + yTop) / 2, 3), 'right');
  addLabel(frame, 'Housing (cutaway)', new THREE.Vector3(-14, yTop + 3.5, 0), 'left');

  // Piezo plate on its centre clamp (nodal point of both modes)
  const plateGroup = new THREE.Group();
  plateGroup.position.y = PLATE_CY;
  motor.add(plateGroup);

  // Yoke: clamp pin -> rides up to the spring
  const yokeBar = mesh(new THREE.BoxGeometry(3, PLATE / 2 + 2.2, 1.4), mat.darkSteel);
  yokeBar.position.set(0, (PLATE / 2 + 2.2) / 2, -2.2);
  plateGroup.add(yokeBar);
  const yokeCap = mesh(new THREE.BoxGeometry(7, 0.8, 7), mat.darkSteel);
  yokeCap.position.set(0, PLATE / 2 + 2.2, -0.6);
  plateGroup.add(yokeCap);
  const pin = mesh(new THREE.CylinderGeometry(1.4, 1.4, PLATE_T + 4, 24), mat.steel);
  pin.rotation.x = Math.PI / 2;
  pin.position.z = -0.6;
  plateGroup.add(pin);

  // Deforming part: matrix is set every frame from the two mode amplitudes
  const plateDeform = new THREE.Group();
  plateDeform.matrixAutoUpdate = false;
  plateGroup.add(plateDeform);
  const plateShape = new THREE.Shape();
  const h = PLATE / 2;
  plateShape.moveTo(-h, -h); plateShape.lineTo(h, -h); plateShape.lineTo(h, h); plateShape.lineTo(-h, h); plateShape.lineTo(-h, -h);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 1.6, 0, Math.PI * 2, true);
  plateShape.holes.push(hole);
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: PLATE_T, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2, curveSegments: 32 });
  plateGeo.translate(0, 0, -PLATE_T / 2);
  const plate = mesh(plateGeo, mat.piezo);
  plateDeform.add(plate);

  // Four front electrodes; diagonal pairs form drive phases A and B
  const electrodes = [];
  const eSize = h - 1.4;
  const quads = [
    { x: -1, y: 1, phase: 'A' }, { x: 1, y: -1, phase: 'A' },
    { x: 1, y: 1, phase: 'B' }, { x: -1, y: -1, phase: 'B' },
  ];
  for (const q of quads) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xc9ccd2, metalness: 1.0, roughness: 0.3, emissive: 0x000000, emissiveIntensity: 1,
    });
    const e = mesh(new THREE.BoxGeometry(eSize, eSize, 0.08), m, { cast: false });
    e.position.set(q.x * (eSize / 2 + 0.9), q.y * (eSize / 2 + 0.9), PLATE_T / 2 + 0.2);
    e.userData.phase = q.phase;
    plateDeform.add(e);
    electrodes.push(e);
    const tag = label(q.phase, 'phase-tag');
    tag.position.set(e.position.x, e.position.y, e.position.z + 0.2);
    plateDeform.add(tag);
  }
  addLabel(plateGroup, 'Piezo plate · 2 resonant modes', new THREE.Vector3(-h - 1, h - 2, 0), 'left');
  addLabel(plateGroup, 'Centre clamp (nodal point)', new THREE.Vector3(h + 1, 2.2, 0), 'right');

  // Ceramic tip; its group origin is the contact point
  const tipBase = new THREE.Group();
  motor.add(tipBase);
  const tip = new THREE.Group();
  tipBase.add(tip);
  const cap = mesh(new THREE.SphereGeometry(TIP_R, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat.ceramic);
  cap.position.y = TIP_R;
  tip.add(cap);
  const shank = mesh(new THREE.CylinderGeometry(TIP_R, TIP_R, TIP_H + 0.4, 32), mat.ceramic);
  shank.position.y = TIP_R + (TIP_H + 0.4) / 2;
  tip.add(shank);
  addLabel(tipBase, 'Ceramic tip', new THREE.Vector3(-4.5, 2.4, 0), 'left');

  // Ghost ellipse: free tip path, exaggerated; recomputed each frame
  const ghostN = 160;
  const ghostPos = new Float32Array((ghostN + 1) * 3);
  const ghostCol = new Float32Array((ghostN + 1) * 3);
  const ghostGeo = new LineGeometry();
  ghostGeo.setPositions(ghostPos);
  ghostGeo.setColors(ghostCol);
  const ghost = new Line2(ghostGeo, new LineMaterial({
    vertexColors: true, linewidth: 2.5, transparent: true, opacity: 0.95, depthTest: false,
  }));
  ghost.renderOrder = 10;
  ghost.position.z = TIP_R + 0.6;
  ghost.frustumCulled = false;
  tipBase.add(ghost);
  const ghostDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  ghostDot.renderOrder = 11;
  ghost.add(ghostDot);
  const scaleNote = addLabel(tipBase, '', new THREE.Vector3(4.2, -1.9, TIP_R), 'note right');

  // Spark particles at the contact
  const sparkCount = 60;
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
  sparkGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(sparkCount), 1));
  const sparks = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(0xffb35c) } },
    vertexShader: `attribute float alpha; varying float vA;
      void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = 70.0 * alpha / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      gl_FragColor = vec4(color, vA * (1.0 - 2.0*d)); }`,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkState = Array.from({ length: sparkCount }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }));

  // ---------- Linear: ceramic strip on a rod ----------
  const linear = new THREE.Group();
  scene.add(linear);
  const linStrip = new THREE.Group();
  const linDriven = new THREE.Group();
  linear.add(linStrip, linDriven);
  const ROD_LEN = 400;
  const rodSlide = new THREE.Group();        // moves along x
  linDriven.add(rodSlide);
  const stripSlide = new THREE.Group();
  linStrip.add(stripSlide);
  const strip = mesh(new THREE.BoxGeometry(ROD_LEN, STRIP_T, 4.2), mat.strip);
  strip.position.y = -STRIP_T / 2;
  stripSlide.add(strip);
  const rod = mesh(new THREE.CylinderGeometry(ROD_R, ROD_R, ROD_LEN, 40), mat.steel);
  rod.rotation.z = Math.PI / 2;
  rod.position.y = -STRIP_T - ROD_R + 0.9;
  rodSlide.add(rod);
  for (let x = -ROD_LEN / 2 + 5; x < ROD_LEN / 2; x += 10) {
    const ring = mesh(new THREE.CylinderGeometry(ROD_R + 0.04, ROD_R + 0.04, 0.7, 40), mat.mark, { cast: false });
    ring.rotation.z = Math.PI / 2;
    ring.position.set(x, rod.position.y, 0);
    rodSlide.add(ring);
    const tick = mesh(new THREE.BoxGeometry(0.5, 0.05, 1.2), mat.mark, { cast: false });
    tick.position.set(x, 0.01, 1.4);
    stripSlide.add(tick);
  }
  for (const sx of [-1, 1]) {
    const guide = mesh(new THREE.BoxGeometry(8, 4, 10), mat.darkSteel);
    guide.position.set(sx * 24, rod.position.y - ROD_R - 1.6, 0);
    linDriven.add(guide);
  }
  addLabel(linStrip, 'Ceramic strip', new THREE.Vector3(-18, 0.2, 2.5), 'left');
  addLabel(linDriven, 'Rod (slides)', new THREE.Vector3(-36, rod.position.y - 2, 3), 'left');

  // Linear direction arrow
  const linArrow = straightArrow();
  linArrow.position.set(20, 4, 3);
  linDriven.add(linArrow);

  // ---------- Rotary: ceramic band on a rotor ----------
  const rotary = new THREE.Group();
  scene.add(rotary);
  const rotStrip = new THREE.Group();
  const rotDriven = new THREE.Group();
  rotary.add(rotStrip, rotDriven);
  rotStrip.position.y = -ROTOR_R;
  rotDriven.position.y = -ROTOR_R;
  const rotorSpin = new THREE.Group();      // rotates about z
  rotStrip.add(rotorSpin);
  const band = mesh(new THREE.CylinderGeometry(ROTOR_R, ROTOR_R, 4.2, 96, 1, true), mat.strip);
  band.rotation.x = Math.PI / 2;
  rotorSpin.add(band);
  const bandInner = mesh(new THREE.CylinderGeometry(ROTOR_R - STRIP_T, ROTOR_R - STRIP_T, 4.2, 96, 1, true),
    mat.strip.clone());
  bandInner.material.side = THREE.BackSide;
  bandInner.rotation.x = Math.PI / 2;
  rotorSpin.add(bandInner);
  const bandFace = new THREE.RingGeometry(ROTOR_R - STRIP_T, ROTOR_R, 96);
  for (const sz of [-1, 1]) {
    const f = mesh(bandFace, mat.strip, { cast: false });
    f.position.z = sz * 2.1;
    if (sz < 0) f.rotation.y = Math.PI;
    rotorSpin.add(f);
  }
  const rotorBody = new THREE.Group();
  rotDriven.add(rotorBody);
  const disc = mesh(new THREE.CylinderGeometry(ROTOR_R - STRIP_T, ROTOR_R - STRIP_T, 3.2, 96), mat.steel);
  disc.rotation.x = Math.PI / 2;
  rotorBody.add(disc);
  const torus = mesh(new THREE.TorusGeometry(12, 1.3, 20, 96), mat.darkSteel);
  torus.position.z = 1.6;
  rotorBody.add(torus);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.4, 24), mat.mark, { cast: false });
    m.rotation.x = Math.PI / 2;
    m.position.set(Math.cos(a) * 6.5, Math.sin(a) * 6.5, 0);
    rotorBody.add(m);
  }
  const axle = mesh(new THREE.CylinderGeometry(2.2, 2.2, 16, 32), mat.darkSteel);
  axle.rotation.x = Math.PI / 2;
  rotDriven.add(axle);
  addLabel(rotStrip, 'Ceramic strip (on rim)', new THREE.Vector3(ROTOR_R * 0.72 + 2, ROTOR_R * 0.72, 2), 'right');
  addLabel(rotDriven, 'Rotor (turns)', new THREE.Vector3(-ROTOR_R - 2, -6, 2), 'left');

  const rotArrow = arcArrow(ROTOR_R + 6);
  rotArrow.position.z = 3;
  rotDriven.add(rotArrow);

  return {
    scene,
    groups: { frame, plateGroup, tipBase, linStrip, linDriven, rotStrip, rotDriven, linear, rotary },
    plateDeform, tip, electrodes, ghost, ghostN, ghostPos, ghostCol, ghostDot, scaleNote, labels,
    sparks, sparkState,
    rodSlide, stripSlide, rotorSpin, rotorBody, linArrow, rotArrow,
  };
}

function straightArrow() {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.9 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 12, 16), m);
  shaft.rotation.z = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 24), m);
  head.rotation.z = -Math.PI / 2;
  head.position.x = 7.5;
  g.add(shaft, head);
  g.userData.material = m;
  return g;
}

function arcArrow(r) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0.9 });
  const arc = (50 * Math.PI) / 180;
  const start = (185 * Math.PI) / 180; // left side of the rotor, clear of the motor; sweeps clockwise
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 12, 64, arc), m);
  t.rotation.z = start - arc;
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 24), m);
  const endA = start - arc;
  head.position.set(Math.cos(endA) * r, Math.sin(endA) * r, 0);
  head.rotation.z = endA + Math.PI; // tangent pointing clockwise
  g.add(t, head);
  g.userData.material = m;
  return g;
}

// Coil spring as a tube along a helix (axis = y).
function helixGeometry(radius, wire, y0, y1, turns) {
  class Helix extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      return target.set(Math.cos(a) * radius, y0 + (y1 - y0) * t, Math.sin(a) * radius);
    }
  }
  return new THREE.TubeGeometry(new Helix(), turns * 40, wire, 10, false);
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, '#3a4252');
  g.addColorStop(0.5, '#1a1f28');
  g.addColorStop(1, '#0a0c10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
