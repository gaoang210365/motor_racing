// Open-world driving field (Phase 1): a large procedural terrain the car can
// roam freely on, decoupled from any track centerline. Provides the surface
// interface CarPhysics expects in world mode: heightAt / normalAt / surfaceAt
// / bounds. Terrain + sky + lighting + scenery are all self-contained here.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ---- deterministic value-noise fbm ----
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const sx = xf * xf * (3 - 2 * xf), sz = zf * zf * (3 - 2 * zf);
  const h = (a, b) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >> 13)) * 1274126177;
    return (((n ^ (n >> 16)) >>> 0) % 10000) / 10000;
  };
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.1 + 13, z * 2.1 + 7) * 0.28
       + vnoise(x * 4.3 + 41, z * 4.3 + 23) * 0.17;
}

const HILL_AMP = 34;   // metres of relief toward the rim
const ROAD_R = 620;    // radius of the paved ring road
const ROAD_HALF = 9;   // half-width of the paved band

export class OpenWorld {
  constructor(cfg = {}) {
    this.cx = 0; this.cz = 0;
    this.radius = cfg.radius ?? 1500;
    this.bounds = { cx: 0, cz: 0, radius: this.radius - 12 };
  }

  heightAt(x, z) {
    const r = Math.hypot(x - this.cx, z - this.cz);
    const rim = THREE.MathUtils.smoothstep(r, 260, this.radius);
    const rolling = (fbm(x * 0.0016 + 5, z * 0.0016 + 9) - 0.5) * 2;
    let y = rim * HILL_AMP + rolling * (6 + rim * HILL_AMP);
    y += (fbm(x * 0.02 + 50, z * 0.02 + 20) - 0.5) * 1.1;
    const dRoad = Math.abs(r - ROAD_R);
    if (dRoad < ROAD_HALF + 14) {
      const flat = rim * HILL_AMP * 0.35 + (fbm(x * 0.0016 + 5, z * 0.0016 + 9) - 0.5) * 4;
      const k = 1 - THREE.MathUtils.smoothstep(dRoad, ROAD_HALF, ROAD_HALF + 14);
      y = THREE.MathUtils.lerp(y, flat, k);
    }
    return y;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.2;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  surfaceAt(x, z) {
    const r = Math.hypot(x - this.cx, z - this.cz);
    return Math.abs(r - ROAD_R) < ROAD_HALF ? 'road' : 'grass';
  }

  spawn() { return { x: 0, z: ROAD_R, heading: Math.PI / 2 }; }
}
// ---------------------------------------------------------------- terrain mesh
function buildTerrainMesh(world) {
  const R = world.radius, seg = 200;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grass1 = new THREE.Color(0x4d8a3d).convertSRGBToLinear();
  const grass2 = new THREE.Color(0x3f7a33).convertSRGBToLinear();
  const rock = new THREE.Color(0x6b6256).convertSRGBToLinear();
  const road = new THREE.Color(0x3a3e45).convertSRGBToLinear();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = world.heightAt(x, z);
    pos.setY(i, y);
    const r = Math.hypot(x, z);
    if (Math.abs(r - ROAD_R) < ROAD_HALF) {
      c.copy(road).multiplyScalar(0.92 + vnoise(x * 0.1, z * 0.1) * 0.12);
    } else {
      const jit = 0.9 + vnoise(x * 0.08, z * 0.08) * 0.2;
      const rim = THREE.MathUtils.smoothstep(r, 300, R);
      c.copy(grass1).lerp(grass2, vnoise(x * 0.01, z * 0.01));
      c.lerp(rock, THREE.MathUtils.clamp(rim * 1.3 - 0.3, 0, 0.8));
      c.multiplyScalar(jit);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildSky(renderer, scene) {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1,
    THREE.MathUtils.degToRad(90 - 46), THREE.MathUtils.degToRad(150));
  u.sunPosition.value.copy(sunDir);
  let envTex = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tmp = new THREE.Scene(); tmp.add(sky);
    envTex = pmrem.fromScene(tmp, 0.06).texture;
    tmp.remove(sky); pmrem.dispose();
  }
  return { sky, envTex, sunDir };
}
// ---------------------------------------------------------------- scenery
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function buildScenery(world) {
  const group = new THREE.Group();
  const rnd = mulberry(1337);
  const N_TREES = 900, N_ROCKS = 260;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  // trees: trunk (cylinder) + canopy (cone), two instanced meshes
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.ConeGeometry(2.4, 6.2, 7);
  canopyGeo.translate(0, 5.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6d2a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREES);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, N_TREES);
  trunks.castShadow = canopies.castShadow = true;
  let ti = 0;
  for (let i = 0; i < N_TREES * 3 && ti < N_TREES; i++) {
    const a = rnd() * Math.PI * 2, r = 130 + rnd() * (world.radius - 200);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(Math.hypot(x, z) - ROAD_R) < ROAD_HALF + 6) continue; // clear the road
    const sc = 0.7 + rnd() * 0.9;
    _p.set(x, world.heightAt(x, z), z);
    _q.setFromAxisAngle(_up, rnd() * Math.PI * 2);
    _s.set(sc, sc * (0.85 + rnd() * 0.4), sc);
    _m.compose(_p, _q, _s);
    trunks.setMatrixAt(ti, _m); canopies.setMatrixAt(ti, _m); ti++;
  }
  trunks.count = canopies.count = ti;
  group.add(trunks, canopies);

  // rocks: instanced icosahedron
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x726a5e, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N_ROCKS);
  rocks.castShadow = rocks.receiveShadow = true;
  let ri = 0;
  for (let i = 0; i < N_ROCKS * 3 && ri < N_ROCKS; i++) {
    const a = rnd() * Math.PI * 2, r = 120 + rnd() * (world.radius - 180);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(Math.hypot(x, z) - ROAD_R) < ROAD_HALF + 3) continue;
    const sc = 0.6 + rnd() * 2.2;
    _p.set(x, world.heightAt(x, z) + sc * 0.3, z);
    _q.setFromAxisAngle(_up, rnd() * Math.PI * 2);
    _s.set(sc, sc * (0.6 + rnd() * 0.5), sc);
    _m.compose(_p, _q, _s);
    rocks.setMatrixAt(ri, _m); ri++;
  }
  rocks.count = ri;
  group.add(rocks);
  return group;
}

// ---------------------------------------------------------------- entry point
export function buildOpenWorld(scene, renderer) {
  const world = new OpenWorld({ radius: 1500 });
  const group = new THREE.Group();

  const { sky, envTex, sunDir } = buildSky(renderer, scene);
  group.add(sky);
  if (envTex) { scene.environment = envTex; if ('environmentIntensity' in scene) scene.environmentIntensity = 0.55; }
  scene.fog = new THREE.FogExp2(0xcdd8e6, 0.00035);

  const hemi = new THREE.HemisphereLight(0xbdd2ee, 0x5e6e52, 0.75);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = 90;
  sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);

  group.add(buildTerrainMesh(world));
  group.add(buildScenery(world));
  scene.add(group);

  const _t = new THREE.Vector3();
  return {
    world, group, sun, hemi,
    update(dt, carPos) {
      const snap = 4;
      _t.set(Math.round(carPos.x / snap) * snap, 0, Math.round(carPos.z / snap) * snap);
      sun.position.copy(_t).addScaledVector(sunDir, 300);
      sun.target.position.copy(_t);
    },
    dispose() {
      scene.remove(group);
      scene.environment = null; scene.fog = null;
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => x.dispose()); }
      });
      if (envTex) envTex.dispose();
    },
  };
}
