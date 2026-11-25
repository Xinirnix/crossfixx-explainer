// Scene construction. Units are millimetres.
// The machined parts are modelled in Blender (blender/crossfixx/build_parts.py) and loaded
// from assets/crossfixx-parts.glb into the named groups below; the overlays (tip path, labels,
// nodal probes, sparks, arrows) are built here. The motion is set live by main.js.
// The strip surface (contact plane) is y = 0; the tip touches it at the origin.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import partsUrl from './assets/crossfixx-parts.glb?url';
import studioHdrUrl from './assets/studio.hdr?url';
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
// These dimensions are mirrored in blender/crossfixx/build_parts.py; change both together.

// Floor height under each driven part (top of the floor = underside of its base).
export const FLOOR_Y = { linear: -12.6, rotary: -46 };

// Exploded offsets along Y, per part group.
export const EXPLODE = {
  frame: 26,
  plate: 15,
  tip: 7,
  strip: -5,
  driven: -12,
};

// Material presets, keyed by the material names used in blender/crossfixx/build_parts.py.
// Each loaded mesh gets a clone of its preset; only the baked AO map is kept from the GLB.
export const MATERIALS = {
  piezo: { color: 0x6c665d, roughness: 0.62, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  electrode: { color: 0xd6d8dc, roughness: 0.34, metalness: 1.0, emissive: 0x000000, emissiveIntensity: 1 },
  solder: { color: 0xd8dce2, roughness: 0.28, metalness: 1.0 },
  ceramic: { color: 0xf5f2ec, roughness: 0.3, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.12, sheen: 0.3, sheenColor: 0xffffff },
  strip: { color: 0xeae7e0, roughness: 0.4, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.25 },
  steel: { color: 0xc8cdd3, roughness: 0.22, metalness: 1.0 },
  blackOxide: { color: 0x363a42, roughness: 0.36, metalness: 0.85 },
  anodized: { color: 0x4a5466, roughness: 0.4, metalness: 0.7, clearcoat: 0.35, clearcoatRoughness: 0.3 },
  cut: { color: 0xc9ced6, roughness: 0.34, metalness: 0.6 },
  aluminium: { color: 0xb3b9c2, roughness: 0.5, metalness: 1.0 },
  bronze: { color: 0xc09a5e, roughness: 0.3, metalness: 1.0 },
  mark: { color: 0x14171c, roughness: 0.6, metalness: 0.3 },
  accent: { color: 0xffb35c, roughness: 0.4, metalness: 0.0, emissive: 0xff8a3d, emissiveIntensity: 0.6 },
  rubber: { color: 0x15161a, roughness: 0.85, metalness: 0.0 },
};

function presetMaterial(loaded) {
  const key = (loaded.name || '').split('.')[0];
  const preset = MATERIALS[key];
  if (!preset) return loaded;
  const m = new THREE.MeshPhysicalMaterial(preset);
  m.name = key;
  if (loaded.aoMap) {
    m.aoMap = loaded.aoMap;
    m.aoMapIntensity = 1;
  }
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
  scene.fog = new THREE.Fog(0x0a0c10, 120, 240);

  // Reflections: a studio HDR rendered in Blender (blender/crossfixx/build_env.py).
  // RoomEnvironment stands in until it has loaded.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 1.0;
  new RGBELoader().load(studioHdrUrl, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  });

  // Studio lights: warm soft key with shadows, cool rim, faint fill
  const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
  key.position.set(34, 70, 46);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 20, far: 200 });
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.04;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.2);
  rim.position.set(-40, 26, -55);
  scene.add(rim);
  const kick = new THREE.DirectionalLight(0xffc68a, 0.6);
  kick.position.set(60, 8, -20);
  scene.add(kick);
  scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0c10, 0.2));

  // Floor: soft radial falloff plus a shadow catcher; main.js keeps it under the driven part.
  const floor = new THREE.Group();
  floor.position.y = FLOOR_Y.rotary;
  scene.add(floor);
  const floorBase = new THREE.Mesh(
    new THREE.CircleGeometry(150, 96),
    new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.85, metalness: 0.0, map: radialTexture() }),
  );
  floorBase.rotation.x = -Math.PI / 2;
  floorBase.receiveShadow = true;
  floor.add(floorBase);

  const labels = [];
  const addLabel = (parent, text, pos, cls) => {
    const l = label(text, cls);
    l.position.copy(pos);
    parent.add(l);
    labels.push(l);
    return l;
  };

  // Group hierarchy. The meshes come from crossfixx-parts.glb (modelled in Blender) and are
  // dropped into these groups by name once loaded; main.js animates the groups every frame.
  const motor = new THREE.Group();
  scene.add(motor);
  const frame = new THREE.Group();
  motor.add(frame);
  const yTop = PLATE_CY + PLATE / 2 + 11;
  const springBottom = PLATE_CY + PLATE / 2 + 2.2;
  addLabel(frame, 'Preload spring', new THREE.Vector3(9, (springBottom + yTop) / 2, 3), 'right');
  addLabel(frame, 'Housing (cutaway)', new THREE.Vector3(-14, yTop + 4.5, 0), 'left');

  // Piezo plate on its centre clamp (nodal point of both modes)
  const plateGroup = new THREE.Group();
  plateGroup.position.y = PLATE_CY;
  motor.add(plateGroup);
  // Deforming part: matrix is set every frame from the two mode amplitudes
  const plateDeform = new THREE.Group();
  plateDeform.matrixAutoUpdate = false;
  plateGroup.add(plateDeform);
  const h = PLATE / 2;

  // Four front electrodes; diagonal pairs form drive phases A and B (meshes arrive with the GLB)
  const electrodes = [];
  const eSize = h - 1.4;
  const quads = [
    { x: -1, y: 1, phase: 'A' }, { x: 1, y: -1, phase: 'A' },
    { x: 1, y: 1, phase: 'B' }, { x: -1, y: -1, phase: 'B' },
  ];
  for (const q of quads) {
    const tag = label(q.phase, 'phase-tag');
    tag.position.set(q.x * (eSize / 2 + 0.9), q.y * (eSize / 2 + 0.9), PLATE_T / 2 + 0.4);
    plateDeform.add(tag);
  }
  // Nodal-point view: probe dots ride on the deforming plate, their full-cycle paths are drawn
  // in the fixed plate frame, and a ring marks the centre hole where both modes have zero motion.
  const nodal = new THREE.Group();          // fixed frame (does not deform)
  nodal.visible = false;
  plateGroup.add(nodal);
  const nodalProbes = new THREE.Group();    // deforms with the plate
  nodalProbes.visible = false;
  plateDeform.add(nodalProbes);
  const zFront = PLATE_T / 2 + 0.45;
  const probeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const nodeMat = new THREE.MeshBasicMaterial({ color: 0x6dffb0 });
  const probePaths = [];
  const PATH_N = 48;
  for (let iy = -2; iy <= 2; iy++) {
    for (let ix = -2; ix <= 2; ix++) {
      const px = ix * (h - 1.2) / 2;
      const py = iy * (h - 1.2) / 2;
      const centre = ix === 0 && iy === 0;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(centre ? 0.45 : 0.3, 12, 8), centre ? nodeMat : probeMat);
      dot.position.set(px, py, zFront);
      nodalProbes.add(dot);
      if (centre) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PATH_N + 1) * 3), 3));
      const r = Math.hypot(px, py) / (Math.SQRT2 * (h - 1.2));
      const c = new THREE.Color(0x5fd3ff).lerp(new THREE.Color(0xffb35c), r);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
      line.userData = { px, py, z: zFront };
      nodal.add(line);
      probePaths.push(line);
    }
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.18, 12, 48), nodeMat.clone());
  ring.material.transparent = true;
  ring.position.z = zFront + 0.1;
  nodal.add(ring);
  const nodeLabel = label('Node: zero motion in both modes → mount stays still', 'note node');
  nodeLabel.position.set(0, -2.9, zFront + 0.5);
  nodal.add(nodeLabel);
  nodal.userData = { ring, PATH_N, nodeLabel };

  addLabel(plateGroup, 'Piezo plate · 2 resonant modes', new THREE.Vector3(-h - 1, h - 2, 0), 'left');
  addLabel(plateGroup, 'Centre clamp (nodal point)', new THREE.Vector3(h + 1, 2.2, 0), 'right');

  // Ceramic tip; its group origin is the contact point
  const tipBase = new THREE.Group();
  motor.add(tipBase);
  const tip = new THREE.Group();
  tipBase.add(tip);
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
  const rodSlide = new THREE.Group();        // moves along x
  linDriven.add(rodSlide);
  const stripSlide = new THREE.Group();
  linStrip.add(stripSlide);
  const rodY = -STRIP_T - ROD_R + 0.9;
  addLabel(linStrip, 'Ceramic strip', new THREE.Vector3(-18, 0.2, 2.5), 'left');
  addLabel(linDriven, 'Rod (slides)', new THREE.Vector3(-36, rodY - 2, 3), 'left');

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
  const rotorBody = new THREE.Group();
  rotDriven.add(rotorBody);
  addLabel(rotStrip, 'Ceramic strip (on rim)', new THREE.Vector3(ROTOR_R * 0.72 + 2, ROTOR_R * 0.72, 2), 'right');
  addLabel(rotDriven, 'Rotor (turns)', new THREE.Vector3(-ROTOR_R - 2, -6, 2), 'left');

  const rotArrow = arcArrow(ROTOR_R + 6);
  rotArrow.position.z = 3;
  rotDriven.add(rotArrow);

  // ---------- Load the Blender parts into the groups ----------
  const targets = { frame, plateGroup, plateDeform, tip, stripSlide, rodSlide, linDriven, rotorSpin, rotorBody, rotDriven };
  const ready = new GLTFLoader().loadAsync(partsUrl).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    for (const [name, group] of Object.entries(targets)) {
      const empty = gltf.scene.getObjectByName(`G_${name}`);
      if (!empty) { console.warn(`crossfixx-parts.glb: no G_${name}`); continue; }
      for (const child of [...empty.children]) group.add(child); // keeps the local transform
    }
    for (const group of Object.values(targets)) {
      group.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.material = presetMaterial(o.material);
        const m = /^electrode_([AB])_/.exec(o.name);
        if (m) {
          o.userData.phase = m[1];
          o.castShadow = false;
          electrodes.push(o);
        }
        if (o.material.name === 'mark') o.castShadow = false;
      });
    }
  });
  ready.catch((err) => console.error('Could not load the motor parts', err));

  return {
    scene, ready, floor,
    groups: { frame, plateGroup, tipBase, linStrip, linDriven, rotStrip, rotDriven, linear, rotary },
    plateDeform, tip, electrodes, nodal, nodalProbes, probePaths, ghost, ghostN, ghostPos, ghostCol, ghostDot, scaleNote, labels,
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
