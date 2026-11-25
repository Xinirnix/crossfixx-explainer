// Piezo plate geometry: primitives only. Units are millimetres, y (axis 3, poling) is up.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const GRID = { nx: 12, ny: 3, nz: 12 }; // grains drawn inside the plate
const ARROW = 0.34; // drawn domain-arrow length, mm
const ELECTRODE = 0.04;

export function label(text, cls = '') {
  const div = document.createElement('div');
  div.className = `part-label ${cls}`;
  div.textContent = text;
  return new CSS2DObject(div);
}

// Arrow pointing +y, centred on the origin, unit length.
function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8);
  shaft.translate(0, -0.2, 0);
  const head = new THREE.ConeGeometry(0.2, 0.4, 10);
  head.translate(0, 0.3, 0);
  return mergeGeometries([shaft, head]);
}

export function buildScene(renderer, nGrains) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x111318, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(6, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
  scene.add(key);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.6;
  floor.receiveShadow = true;
  scene.add(floor);

  // Plate: unit box scaled to L × t × L (deformed). Ceramic is drawn translucent so the domains show.
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhysicalMaterial({ color: 0xece6da, roughness: 0.35, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  plate.renderOrder = 2;
  scene.add(plate);

  // Undeformed outline, to compare against.
  const ghost = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x8b94a3, transparent: true, opacity: 0.55 }),
  );
  scene.add(ghost);

  // Electrodes on top and bottom faces.
  const elMat = () => new THREE.MeshPhysicalMaterial({ color: 0xc9cfd6, roughness: 0.25, metalness: 1, emissive: 0x000000 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1, ELECTRODE, 1), elMat());
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, ELECTRODE, 1), elMat());
  top.castShadow = bottom.castShadow = true;
  scene.add(top, bottom);

  // Domains: one instanced arrow per grain.
  const domains = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.5 }), nGrains);
  domains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  domains.renderOrder = 1;
  scene.add(domains);

  // Labels
  const lTop = label('+ electrode');
  const lBottom = label('0 V electrode');
  const lT = label('', 'note');
  const lL = label('', 'note');
  const lAxis3 = label('3 · poling axis, field');
  const lAxis1 = label('1');
  const lPoling = label('DC poling field', 'note');
  lPoling.visible = false;
  scene.add(lTop, lBottom, lT, lL, lAxis3, lAxis1, lPoling);

  // Axis arrows beside the plate
  const axisMat = new THREE.MeshBasicMaterial({ color: 0x8b94a3 });
  const axis3 = new THREE.Mesh(arrowGeometry(), axisMat);
  const axis1 = new THREE.Mesh(arrowGeometry(), axisMat);
  axis1.rotation.z = -Math.PI / 2;
  scene.add(axis3, axis1);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(ARROW, ARROW, ARROW);
  const col = new THREE.Color();
  const cUp = new THREE.Color(0xffb35c);
  const cDown = new THREE.Color(0x5fd3ff);
  const cSide = new THREE.Color(0x6a7280);

  // dims: { L, t } real mm; drawn: { L, t } deformed and exaggerated; dirs: current unit vectors per grain.
  function update({ L, t, drawnL, drawnT, dirs, V, polingFlash, dtLabel, dLLabel }) {
    plate.scale.set(drawnL, drawnT, drawnL);
    ghost.scale.set(L, t, L);
    top.scale.set(drawnL, 1, drawnL);
    bottom.scale.set(drawnL, 1, drawnL);
    top.position.y = drawnT / 2 + ELECTRODE / 2;
    bottom.position.y = -drawnT / 2 - ELECTRODE / 2;

    const glow = Math.min(1, Math.abs(V) / 3000);
    top.material.emissive.set(V >= 0 ? 0xffb35c : 0x5fd3ff).multiplyScalar(glow * 0.35 + polingFlash * 0.5);
    bottom.material.emissive.set(0x000000);
    lTop.element.textContent = `${V >= 0 ? '+' : '−'}${Math.abs(Math.round(V))} V`;

    let i = 0;
    const { nx, ny, nz } = GRID;
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++, i++) {
          pos.set(((ix + 0.5) / nx - 0.5) * drawnL, ((iy + 0.5) / ny - 0.5) * drawnT, ((iz + 0.5) / nz - 0.5) * drawnL);
          const d = dirs[i];
          q.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d);
          m4.compose(pos, q, scl);
          domains.setMatrixAt(i, m4);
          const y = d.y;
          col.copy(cSide).lerp(y >= 0 ? cUp : cDown, Math.abs(y) ** 1.5);
          domains.setColorAt(i, col);
        }
      }
    }
    domains.instanceMatrix.needsUpdate = true;
    domains.instanceColor.needsUpdate = true;

    const half = drawnL / 2;
    lTop.position.set(0, drawnT / 2 + 0.35, -half);
    lBottom.position.set(-half + 0.6, -drawnT / 2 - 0.35, half);
    lT.position.set(half + 0.25, 0, half);
    lT.element.textContent = dtLabel;
    lL.position.set(0, -drawnT / 2, half + 0.5);
    lL.element.textContent = dLLabel;

    axis3.position.set(half + 0.8, 0.4, -half);
    axis3.scale.set(0.5, 1.2, 0.5);
    lAxis3.position.set(half + 0.8, 1.45, -half);
    axis1.position.set(half + 0.3, -drawnT / 2 - 0.45, -half);
    axis1.scale.set(0.5, 1.0, 0.5);
    lAxis1.position.set(half + 1.05, -drawnT / 2 - 0.45, -half);

    lPoling.visible = polingFlash > 0.05;
    lPoling.position.set(0, drawnT / 2 + 0.9, 0);
  }

  return { scene, update };
}
