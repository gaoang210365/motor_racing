// Open-world driving field (Phase 1): a large procedural terrain the car can
// roam freely on, decoupled from any track centerline. Provides the surface
// interface CarPhysics expects in world mode: heightAt / normalAt / surfaceAt
// / bounds. Terrain + sky + lighting + scenery are all self-contained here.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import treeUrl from './models/tree.glb?url';
import rockUrl from './models/rock.glb?url';
import barnUrl from './models/barn.glb?url';
import siloUrl from './models/silo.glb?url';
import grassUrl from './models/grass.glb?url';
import daisyUrl from './models/flower_daisy.glb?url';
import tulipUrl from './models/flower_tulip.glb?url';
import bluebellUrl from './models/flower_bluebell.glb?url';
import gasUrl from './models/gas_station.glb?url';
import lampUrl from './models/lamp.glb?url';

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
const ROAD2_HALF = 8;  // half-width of the straight cross highway (along x, z=0)

// distance from (x,z) to the nearest road centre-band (ring or straight).
// Returns the perpendicular distance to whichever road is closer.
function roadDist(x, z) {
  const r = Math.hypot(x, z);
  const dRing = Math.abs(r - ROAD_R);
  const dStraight = Math.abs(z);            // straight highway runs along +/-x at z=0
  return Math.min(dRing, dStraight);
}

export class OpenWorld {
  constructor(cfg = {}) {
    this.cx = 0; this.cz = 0;
    this.radius = cfg.radius ?? 1500;
    this.bounds = { cx: 0, cz: 0, radius: this.radius - 12 };
    // collider spatial hash: circular colliders bucketed into a grid so the
    // physics step only tests a handful of nearby props per frame
    this.cell = 40;
    this.grid = new Map();
    this.colliders = [];
  }

  addCollider(x, z, r) {
    const c = { x, z, r };
    this.colliders.push(c);
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(c);
  }

  // Resolve the car (a disc of radius carR at x,z) against nearby prop
  // colliders. Returns { nx, nz, pen } for the deepest overlap, or null.
  collide(x, z, carR) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = null, bestPen = 0;
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const list = this.grid.get(`${gx},${gz}`);
        if (!list) continue;
        for (const c of list) {
          const dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz);
          const minD = c.r + carR;
          if (d < minD) {
            const pen = minD - d;
            if (pen > bestPen) {
              bestPen = pen;
              const inv = d > 1e-4 ? 1 / d : 0;
              best = { nx: dx * inv, nz: dz * inv, pen };
            }
          }
        }
      }
    }
    return best;
  }

  heightAt(x, z) {
    const r = Math.hypot(x - this.cx, z - this.cz);
    const rim = THREE.MathUtils.smoothstep(r, 260, this.radius);
    const rolling = (fbm(x * 0.0016 + 5, z * 0.0016 + 9) - 0.5) * 2;
    let y = rim * HILL_AMP + rolling * (6 + rim * HILL_AMP);
    y += (fbm(x * 0.02 + 50, z * 0.02 + 20) - 0.5) * 1.1;
    // flatten a smooth corridor under whichever road is nearer
    const dRoad = roadDist(x, z);
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
    const onRing = Math.abs(r - ROAD_R) < ROAD_HALF;
    const onStraight = Math.abs(z) < ROAD2_HALF && Math.abs(x) < this.radius - 120;
    return (onRing || onStraight) ? 'road' : 'grass';
  }

  spawn() { return { x: 0, z: ROAD_R, heading: Math.PI / 2 }; }
}
// ---------------------------------------------------------------- terrain mesh
function buildTerrainMesh(world) {
  // finer grid: closer quads follow world.heightAt more faithfully, which also
  // stops props (placed at exact heightAt) poking through the mesh triangles.
  const R = world.radius, seg = 360;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  // a small palette of natural tones, mixed by layered noise
  const lush = new THREE.Color(0x4f9440).convertSRGBToLinear();
  const grass = new THREE.Color(0x407a33).convertSRGBToLinear();
  const dry = new THREE.Color(0x8a9445).convertSRGBToLinear();
  const dirt = new THREE.Color(0x6e5a3c).convertSRGBToLinear();
  const rock = new THREE.Color(0x6b6256).convertSRGBToLinear();
  const road = new THREE.Color(0x33373d).convertSRGBToLinear();
  const shoulder = new THREE.Color(0x5c5a4a).convertSRGBToLinear();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = world.heightAt(x, z);
    pos.setY(i, y);
    const r = Math.hypot(x, z);
    // distance to whichever road is nearer (ring or straight highway at z=0)
    const onStraightSpan = Math.abs(x) < R - 120;
    const dRoad = Math.min(Math.abs(r - ROAD_R), onStraightSpan ? Math.abs(z) : 1e9);
    if (dRoad < ROAD_HALF) {
      // asphalt with subtle grain + a centre-line lightening
      c.copy(road).multiplyScalar(0.88 + vnoise(x * 0.35, z * 0.35) * 0.14);
    } else if (dRoad < ROAD_HALF + 3.5) {
      // gravel shoulder easing off the tarmac
      const k = (dRoad - ROAD_HALF) / 3.5;
      c.copy(road).lerp(shoulder, k).multiplyScalar(0.9 + vnoise(x * 0.3, z * 0.3) * 0.18);
    } else {
      // grass: blend lush<->grass by broad patches, sprinkle dry + dirt patches
      const patch = vnoise(x * 0.006 + 3, z * 0.006 + 7);       // broad meadow patches
      const fine = vnoise(x * 0.09, z * 0.09);                  // blade-scale grain
      const dryN = vnoise(x * 0.013 + 20, z * 0.013 + 40);      // dry-grass regions
      const dirtN = vnoise(x * 0.02 + 60, z * 0.02 + 11);       // bare-earth spots
      c.copy(grass).lerp(lush, THREE.MathUtils.clamp(patch * 1.5 - 0.2, 0, 1));
      c.lerp(dry, THREE.MathUtils.clamp(dryN * 1.4 - 0.55, 0, 0.6));
      c.lerp(dirt, THREE.MathUtils.clamp(dirtN * 1.6 - 1.02, 0, 0.7));
      // rocky rim toward the far hills
      const rim = THREE.MathUtils.smoothstep(r, 320, R);
      c.lerp(rock, THREE.MathUtils.clamp(rim * 1.3 - 0.3, 0, 0.85));
      c.multiplyScalar(0.86 + fine * 0.26);                     // fine tonal grain
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

// Combined sky for a day/night cycle:
//  - daySky : three.js atmospheric Sky (drives daytime look + sun position)
//  - nightDome : deep-blue star dome with a warm horizon city-glow; fades in
//    at night via a uNight uniform (0 = clear/transparent, 1 = full night).
// Both env maps are baked once (day + night) so IBL can be blended cheaply.
function buildSkySystem(renderer, scene) {
  // daytime atmospheric sky
  const daySky = new Sky();
  daySky.scale.setScalar(4000);
  const u = daySky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;

  // night dome (transparent until night)
  const geo = new THREE.SphereGeometry(3600, 40, 24);
  const nightMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, transparent: true, fog: false,
    uniforms: { uNight: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float uNight;
      float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.05, 1.0);
        vec3 col = mix(vec3(0.10, 0.14, 0.24), vec3(0.02, 0.03, 0.07), pow(clamp(h,0.0,1.0), 0.45));
        float glow = smoothstep(0.16, -0.02, d.y);
        col = mix(col, vec3(0.22, 0.17, 0.13), glow * 0.75);
        vec3 sp = floor(d * 230.0);
        float star = step(0.9975, hash(sp));
        float tw = 0.55 + 0.45 * hash(sp + 3.0);
        col += vec3(0.9, 0.95, 1.0) * star * tw * smoothstep(0.06, 0.3, d.y);
        gl_FragColor = vec4(col, uNight);
      }`,
  });
  const nightDome = new THREE.Mesh(geo, nightMat);
  nightDome.renderOrder = -9; // in front of daySky

  // bake both env maps once
  let envDay = null, envNight = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(150));
    const t1 = new THREE.Scene(); t1.add(daySky); envDay = pmrem.fromScene(t1, 0.06).texture; t1.remove(daySky);
    nightMat.uniforms.uNight.value = 1;
    const t2 = new THREE.Scene(); t2.add(nightDome); envNight = pmrem.fromScene(t2, 0.06).texture; t2.remove(nightDome);
    nightMat.uniforms.uNight.value = 0;
    pmrem.dispose();
  }
  return { daySky, nightDome, nightMat, envDay, envNight };
}

// A distant ring of skyscrapers with lit windows, just past the world rim, to
// give the night horizon that glowing-city look (bloom picks up the windows).
function buildSkyline(world) {
  const group = new THREE.Group();
  const rnd = mulberry(4242);
  // lit-window texture shared by all towers
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#06080e'; g2.fillRect(0, 0, 128, 256);
  const winCols = ['#ffd9a0', '#cfe4ff', '#fff2cc', '#9fd8ff'];
  for (let y = 4; y < 252; y += 7) for (let x = 4; x < 124; x += 8) {
    if (rnd() < 0.44) {
      g2.fillStyle = winCols[(rnd() * 4) | 0];
      g2.globalAlpha = 0.5 + rnd() * 0.5;
      g2.fillRect(x, y, 5, 4); g2.globalAlpha = 1;
    }
  }
  const winTex = new THREE.CanvasTexture(cv);
  winTex.colorSpace = THREE.SRGBColorSpace;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9 });
  const winMat = new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false });
  winMat.color.setScalar(1.5); // bright -> feeds bloom

  const N = 90, bodies = [], windows = [];
  const rimIn = world.radius + 120, rimOut = world.radius + 900;
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rimIn + rnd() * (rimOut - rimIn);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 30 + rnd() * 46, dep = 30 + rnd() * 46, h = 80 + rnd() * 320;
    const body = new THREE.BoxGeometry(w, h, dep);
    body.translate(x, h / 2, z);
    bodies.push(body);
    for (const side of [1, -1]) {
      const pl = new THREE.PlaneGeometry(w * 0.92, h * 0.95);
      pl.rotateY(side > 0 ? 0 : Math.PI);
      pl.translate(x, h / 2, z + side * (dep / 2 + 0.5));
      windows.push(pl);
      const pl2 = new THREE.PlaneGeometry(dep * 0.92, h * 0.95);
      pl2.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      pl2.translate(x + side * (w / 2 + 0.5), h / 2, z);
      windows.push(pl2);
    }
  }
  const bodyMesh = new THREE.Mesh(mergeGeometries(bodies), bodyMat);
  const winMesh = new THREE.Mesh(mergeGeometries(windows), winMat);
  group.add(bodyMesh, winMesh);
  return group;
}
// ---------------------------------------------------------------- scenery
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// pull the single mesh (geometry + vertex-coloured material) out of a glb
async function loadPropGeo(loader, url) {
  const gltf = await loader.loadAsync(url);
  let mesh = null;
  gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  const geo = mesh.geometry;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  return { geo, mat };
}

// Scatter Blender-authored props with InstancedMesh and register a circular
// collider per instance so the car is stopped on impact.
async function buildScenery(world) {
  const group = new THREE.Group();
  const loader = new GLTFLoader();
  const [tree, rock, barn, silo, grass, daisy, tulip, bluebell, gas, lamp] = await Promise.all([
    loadPropGeo(loader, treeUrl), loadPropGeo(loader, rockUrl),
    loadPropGeo(loader, barnUrl), loadPropGeo(loader, siloUrl),
    loadPropGeo(loader, grassUrl), loadPropGeo(loader, daisyUrl),
    loadPropGeo(loader, tulipUrl), loadPropGeo(loader, bluebellUrl),
    loadPropGeo(loader, gasUrl), loadPropGeo(loader, lampUrl),
  ]);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();

  // Grounded placement: the terrain is a discrete triangle mesh, so a prop
  // dropped at the exact heightAt(x,z) can float above — or poke through — the
  // faceted surface on slopes. Sample the height at the base footprint (centre
  // + a ring) and seat the prop at the LOWEST corner, sunk a touch further by
  // `embed`, so its base always meets or dips below the rendered ground.
  function seatY(x, z, footR, embed) {
    let lo = world.heightAt(x, z);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const h = world.heightAt(x + Math.cos(a) * footR, z + Math.sin(a) * footR);
      if (h < lo) lo = h;
    }
    return lo - embed;
  }

  // generic scatterer: places `count` instances, optionally registers colliders.
  // `maxSlope` (0..1, tan of terrain angle) rejects spots too steep for a prop
  // to sit cleanly; `embed`/`footR` control how it's grounded (see seatY).
  function scatter(prop, count, { rMin, rMax, sMin, sMax, clearRoad, colliderR, seed, noCollide, maxSlope = 1, embed = 0.1, footR = 0.9 }) {
    const rnd = mulberry(seed);
    const inst = new THREE.InstancedMesh(prop.geo, prop.mat, count);
    inst.castShadow = !noCollide; inst.receiveShadow = true;
    let n = 0;
    for (let i = 0; i < count * 6 && n < count; i++) {
      const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (clearRoad && roadDist(x, z) < ROAD_HALF + clearRoad) continue;
      // reject slopes steeper than this prop tolerates (avoids hillside float)
      if (maxSlope < 1) {
        world.normalAt(x, z, _n);
        const slope = Math.hypot(_n.x, _n.z) / Math.max(_n.y, 0.05);
        if (slope > maxSlope) continue;
      }
      const sc = sMin + rnd() * (sMax - sMin);
      _p.set(x, seatY(x, z, footR * sc, embed * sc), z);
      _q.setFromAxisAngle(_up, rnd() * Math.PI * 2);
      _s.set(sc, sc, sc);
      _m.compose(_p, _q, _s);
      inst.setMatrixAt(n, _m);
      if (!noCollide) world.addCollider(x, z, colliderR * sc);
      n++;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return n;
  }

  const rMax = world.radius - 120;
  // trees: trunks read as vertical, so keep them off steep hillsides and sink
  // the base a little; rocks tolerate steeper ground and embed deeper so they
  // nestle into the terrain; barns need near-flat footings.
  scatter(tree, 900, { rMin: 130, rMax, sMin: 0.7, sMax: 1.7, clearRoad: 6, colliderR: 0.9, seed: 1337, maxSlope: 0.42, embed: 0.35, footR: 1.1 });
  scatter(rock, 240, { rMin: 120, rMax, sMin: 0.6, sMax: 2.6, clearRoad: 3, colliderR: 1.0, seed: 91, maxSlope: 0.75, embed: 0.6, footR: 1.2 });
  scatter(barn, 14, { rMin: 200, rMax: rMax - 60, sMin: 1.0, sMax: 1.5, clearRoad: 16, colliderR: 4.2, seed: 7, maxSlope: 0.22, embed: 0.3, footR: 4.0 });

  // ground cover: dense grass tufts + three flower species. No colliders —
  // you drive/walk right through them. `noCollide` skips collider registration.
  // A small embed keeps blades/petals rooted in slopes instead of hovering.
  scatter(grass, 4200, { rMin: 40, rMax, sMin: 0.7, sMax: 1.5, clearRoad: 2, colliderR: 0, seed: 555, noCollide: true, embed: 0.06, footR: 0.4 });
  scatter(daisy, 900, { rMin: 45, rMax, sMin: 0.8, sMax: 1.4, clearRoad: 2, colliderR: 0, seed: 202, noCollide: true, embed: 0.05, footR: 0.4 });
  scatter(tulip, 700, { rMin: 45, rMax, sMin: 0.8, sMax: 1.4, clearRoad: 2, colliderR: 0, seed: 303, noCollide: true, embed: 0.05, footR: 0.4 });
  scatter(bluebell, 600, { rMin: 45, rMax, sMin: 0.8, sMax: 1.4, clearRoad: 2, colliderR: 0, seed: 404, noCollide: true, embed: 0.05, footR: 0.4 });

  // gas stations beside the ring road — placed just off the paved band, with
  // a collider. Positions returned for the minimap.
  const gasStations = [];
  const gasInst = new THREE.InstancedMesh(gas.geo, gas.mat, 3);
  gasInst.castShadow = true; gasInst.receiveShadow = true;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.0;
    const r = ROAD_R + ROAD_HALF + 12;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    _p.set(x, world.heightAt(x, z), z);
    _q.setFromAxisAngle(_up, a + Math.PI / 2); // face the road
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    gasInst.setMatrixAt(i, _m);
    world.addCollider(x, z, 7.5);
    gasStations.push({ x, z });
  }
  gasInst.instanceMatrix.needsUpdate = true;
  group.add(gasInst);

  // silos as landmark checkpoints — placed on a wide ring, returned so the
  // session can use them as exploration goals
  const landmarks = [];
  const silosInst = new THREE.InstancedMesh(silo.geo, silo.mat, 6);
  silosInst.castShadow = true;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4, r = world.radius * 0.62;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sc = 1.3;
    _p.set(x, seatY(x, z, 2.6 * sc, 0.4), z);
    _q.setFromAxisAngle(_up, a);
    _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    silosInst.setMatrixAt(i, _m);
    world.addCollider(x, z, 2.6 * sc);
    landmarks.push({ x, z, reached: false });
  }
  silosInst.instanceMatrix.needsUpdate = true;
  group.add(silosInst);

  // ---- street lamps along BOTH roads ----
  // poles line the ring road and the straight highway; the arm reaches over
  // the tarmac. Glowing heads are a separate emissive instanced mesh; a small
  // point-light pool follows the nearest heads to the player at night.
  const lampXf = [];   // { x, z, faceIn } pole transforms
  const lampHeads = []; // world positions of each glowing head
  // ring road: alternate inner/outer
  const RING_N = 44;
  for (let i = 0; i < RING_N; i++) {
    const a = (i / RING_N) * Math.PI * 2;
    const side = i % 2 === 0 ? 1 : -1;
    const r = ROAD_R + side * (ROAD_HALF + 2.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const faceIn = side > 0 ? a + Math.PI : a;
    lampXf.push({ x, z, faceIn });
  }
  // straight highway (along x at z=0): lamps every ~70 m, alternating sides
  const halfSpan = world.radius - 130;
  for (let x = -halfSpan, k = 0; x <= halfSpan; x += 70, k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const z = side * (ROAD2_HALF + 2.5);
    // arm faces toward the road centre (z=0): +z if pole is at -z, else -z
    const faceIn = side > 0 ? Math.PI : 0;
    lampXf.push({ x, z, faceIn });
  }

  const N_LAMPS = lampXf.length;
  const lampPoles = new THREE.InstancedMesh(lamp.geo, lamp.mat, N_LAMPS);
  lampPoles.castShadow = true;
  const headGeo = new THREE.SphereGeometry(0.2, 10, 8);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c0, emissive: 0xffdf9e, emissiveIntensity: 0, roughness: 0.4,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, N_LAMPS);
  for (let i = 0; i < N_LAMPS; i++) {
    const { x, z, faceIn } = lampXf[i];
    const gy = world.heightAt(x, z);
    _p.set(x, gy, z); _q.setFromAxisAngle(_up, faceIn); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    lampPoles.setMatrixAt(i, _m);
    world.addCollider(x, z, 0.5);
    // head world pos = pole + arm offset (local (1.2, ~5.42)) rotated by faceIn
    const hx = x + Math.sin(faceIn) * 1.2, hz = z + Math.cos(faceIn) * 1.2;
    const hy = gy + 5.42;
    _p.set(hx, hy, hz); _q.identity(); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    heads.setMatrixAt(i, _m);
    lampHeads.push({ x: hx, y: hy, z: hz });
  }
  lampPoles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(lampPoles, heads);

  return { group, landmarks, gasStations, lampHeads, lampHeadMat: headMat };
}

// ---------------------------------------------------------------- entry point
export async function buildOpenWorld(scene, renderer) {
  const world = new OpenWorld({ radius: 1500 });
  const group = new THREE.Group();

  // day sky + night dome (night fades in via a uniform); both env maps baked
  const { daySky, nightDome, nightMat, envDay, envNight } = buildSkySystem(renderer, scene);
  group.add(daySky, nightDome);
  if (envDay) scene.environment = envDay;
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
  group.add(buildSkyline(world));
  const scenery = await buildScenery(world);
  group.add(scenery.group);
  scene.add(group);

  // pool of point lights that hop to the nearest lamps around the player (night)
  const POOL = 8;
  const poolLights = [];
  for (let i = 0; i < POOL; i++) {
    const pl = new THREE.PointLight(0xffe0b0, 0, 70, 1.5);
    group.add(pl); poolLights.push(pl);
  }
  const lampHeads = scenery.lampHeads || [];
  const lampHeadMat = scenery.lampHeadMat;

  world.mapData = {
    radius: world.radius, roadR: ROAD_R,
    landmarks: scenery.landmarks, gasStations: scenery.gasStations,
    spawn: world.spawn(),
  };

  // ---- day/night cycle ----
  // tod in [0,1): 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset. Loops every
  // DAY_SECONDS. Normal day; the pretty night fades in for the dark hours.
  const DAY_SECONDS = 240;
  let tod = 0.30;                       // start mid-morning
  let nightFactor = 0;                   // 0 = full day, 1 = full night
  const _t = new THREE.Vector3(), _sd = new THREE.Vector3();
  const dayFog = new THREE.Color(0xcdd8e6), nightFog = new THREE.Color(0x0c1220);
  const duskFog = new THREE.Color(0xe0a878);          // warm haze at the horizon
  const _fog = new THREE.Color();
  // sun tints: warm gold near the horizon -> neutral white overhead
  const sunLow = new THREE.Color(0xff9d52), sunHigh = new THREE.Color(0xfff4e2);
  const _sun = new THREE.Color();
  // hemisphere sky tint warms at dusk/dawn too
  const skyDay = new THREE.Color(0xbdd2ee), skyDusk = new THREE.Color(0xd7b48a);
  const _sky = new THREE.Color();
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
  let envIsDay = true;

  function applyTOD(carPos) {
    const ang = (tod - 0.25) * Math.PI * 2;   // 0 at sunrise, PI/2 at noon
    const elev = Math.sin(ang);               // -1..1 sun height
    const azi = THREE.MathUtils.degToRad(150 + tod * 40);
    const horiz = Math.cos(ang);
    _sd.set(horiz * Math.sin(azi), Math.max(elev, 0.02), horiz * Math.cos(azi)).normalize();

    // smooth day factor: gentle ramp through dawn/dusk instead of a hard step
    const day = smooth(elev * 1.6 + 0.28);    // ~0 at night, 1 in full day
    const night = 1 - day;
    // golden-hour weight peaks when the sun sits low but is still up
    const golden = clamp01(1 - Math.abs(elev) * 4.5) * clamp01(elev * 12 + 0.4);

    // sun light: fades below horizon, warms + dims toward the horizon
    sun.intensity = smooth(elev * 2.2 + 0.02) * 2.1;
    sun.visible = elev > -0.02;
    _sun.copy(sunLow).lerp(sunHigh, smooth(elev * 2.4));
    sun.color.copy(_sun);
    const snap = 4;
    _t.set(Math.round(carPos.x / snap) * snap, 0, Math.round(carPos.z / snap) * snap);
    sun.position.copy(_t).addScaledVector(_sd, 300);
    sun.target.position.copy(_t);

    // ambient + sky (sky tint warms during golden hour)
    hemi.intensity = 0.26 + day * 0.44;
    _sky.copy(skyDay).lerp(skyDusk, golden * 0.7);
    hemi.color.copy(_sky);
    if (daySky.material.uniforms) daySky.material.uniforms.sunPosition.value.copy(_sd);
    nightMat.uniforms.uNight.value = night;   // stars/glow fade in at night
    if ('environmentIntensity' in scene) scene.environmentIntensity = 0.30 + day * 0.30;
    // swap the baked IBL at the horizon crossing — the dimmest moment, so the
    // pop between day/night env maps is invisible (was mid-golden-hour before)
    const wantDay = elev > 0;
    if (wantDay !== envIsDay) { scene.environment = wantDay ? envDay : envNight; envIsDay = wantDay; }

    // fog: cool blue by day, warm at the horizon during golden hour, deep at
    // night. exposure lifts smoothly into the dark so night reads bright.
    _fog.copy(nightFog).lerp(dayFog, day).lerp(duskFog, golden * 0.5);
    if (scene.fog) { scene.fog.color.copy(_fog); scene.fog.density = 0.00035 + night * 0.00028; }
    if (renderer) renderer.toneMappingExposure = 0.5 + smooth(night) * 0.5;
    nightFactor = night;                      // exposed so main can drive bloom

    // street lamps glow from dusk; pool lights follow nearest heads
    const lampOn = clamp01(0.55 - elev * 2.2);
    if (lampHeadMat) lampHeadMat.emissiveIntensity = lampOn * 5.5;
    if (lampOn > 0.02 && lampHeads.length) {
      const near = lampHeads
        .map(h => ({ h, d: (h.x - carPos.x) ** 2 + (h.z - carPos.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
      for (let i = 0; i < poolLights.length; i++) {
        const src = near[i];
        if (src) { poolLights[i].position.set(src.h.x, src.h.y, src.h.z); poolLights[i].intensity = lampOn * 140; }
        else poolLights[i].intensity = 0;
      }
    } else {
      for (const pl of poolLights) pl.intensity = 0;
    }
  }

  return {
    world, group, sun, hemi,
    landmarks: scenery.landmarks, gasStations: scenery.gasStations,
    get timeOfDay() { return tod; },
    get nightFactor() { return nightFactor; },
    update(dt, carPos) {
      tod = (tod + dt / DAY_SECONDS) % 1;
      applyTOD(carPos);
    },
    dispose() {
      scene.remove(group);
      scene.environment = null; scene.fog = null;
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => x.dispose()); }
      });
      if (envDay) envDay.dispose(); if (envNight) envNight.dispose();
    },
  };
}
