// Per-track environments: gradient sky with sun, shadowed sunlight that
// follows the car, clouds, trees, grandstands with voxel crowds, sponsor
// boards, corner-name boards, start gantry with the 5-light rig, pit
// buildings — plus Monaco's city blocks / harbor / tunnel, Suzuka's
// figure-8 bridge / ferris wheel, and Silverstone's Wing.
import * as THREE from 'three';

// ---------------------------------------------------------------- utilities
const FACE_SHADE = { px: 0.84, nx: 0.78, py: 1.0, ny: 0.5, pz: 0.92, nz: 0.7 };

class Mesher {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  pushBox(cx, cy, cz, sx, sy, sz, color, rotY = 0, jitter = 0) {
    const c = new THREE.Color(color);
    if (jitter) c.multiplyScalar(1 + (Math.random() - 0.5) * jitter);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
    const rot = (x, z) => [cx + x * cosR + z * sinR, cz - x * sinR + z * cosR];
    const faces = [
      ['px', [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      ['nx', [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      ['py', [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      ['ny', [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      ['pz', [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
      ['nz', [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
    ];
    for (const [dir, corners] of faces) {
      const shade = FACE_SHADE[dir];
      const base = this.pos.length / 3;
      for (const [x, y, z] of corners) {
        const [wx, wz] = rot(x, z);
        this.pos.push(wx, cy + y, wz);
        this.col.push(c.r * shade, c.g * shade, c.b * shade);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  build(opts = {}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness ?? 0.92, metalness: opts.metalness ?? 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = opts.receiveShadow ?? true;
    return mesh;
  }
}

function textTexture(lines, { w = 512, h = 128, bg = '#ffffff', fg = '#111111', border, font, pad = 0 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = h * 0.07; ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth); }
  ctx.fillStyle = fg;
  const arr = Array.isArray(lines) ? lines : [lines];
  const fh = (h - pad * 2) / arr.length;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  arr.forEach((line, i) => {
    ctx.font = font || `900 ${Math.floor(fh * 0.62)}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(line, w / 2, pad + fh * (i + 0.5), w * 0.94);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- sky
function makeSky(sky) {
  const geo = new THREE.SphereGeometry(3200, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(sky.top) },
      horizonColor: { value: new THREE.Color(sky.horizon) },
      sunDir: { value: new THREE.Vector3(...sky.sun).normalize() },
      sunColor: { value: new THREE.Color(sky.sunColor) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 topColor, horizonColor, sunDir, sunColor;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.6));
        col = mix(col, horizonColor * 0.94, smoothstep(0.02, -0.1, d.y));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(sd, 500.0) * 2.2 + pow(sd, 10.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}

// ---------------------------------------------------------------- pieces
function makeClouds(center) {
  const m = new Mesher();
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(250, 1400);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = rand(140, 260);
    const s = rand(18, 44);
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffs; p++) {
      m.pushBox(x + rand(-s, s), y + rand(-3, 5), z + rand(-s * 0.5, s * 0.5), rand(s * 0.7, s * 1.4), rand(5, 9), rand(s * 0.5, s), 0xffffff, 0, 0.05);
    }
  }
  const mesh = m.build({ castShadow: false, receiveShadow: false, roughness: 1 });
  mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, transparent: true, opacity: 0.92 });
  const grp = new THREE.Group();
  grp.position.set(center.x, 0, center.z);
  mesh.position.set(-center.x, 0, -center.z);
  grp.add(mesh);
  return grp;
}

function groundYAt(track, sm, side, dist) {
  // mirror of the apron height profile
  const wall = side > 0 ? sm.wallL : sm.wallR;
  const apron = track.skipApron[sm.idx] ? 0.01 : (sm.apronW ?? track.cfg.apron);
  const baseY = sm.p.y - 6;
  const t = (dist - wall) / apron;
  if (t <= 0) return sm.p.y - 0.02;
  if (t < 0.45) return THREE.MathUtils.lerp(sm.p.y, Math.max(baseY, sm.p.y - 3), t / 0.45 * 0.5);
  return Math.max(baseY, sm.p.y - 6) - 0.5;
}

function makeTrees(track, count, reject) {
  const trunkGeo = new THREE.BoxGeometry(0.5, 2.6, 0.5);
  trunkGeo.translate(0, 1.3, 0);
  const canGeo = (() => {
    const a = new THREE.BoxGeometry(3.4, 2.6, 3.4); a.translate(0, 3.6, 0);
    const b = new THREE.BoxGeometry(2.2, 1.8, 2.2); b.translate(0, 5.6, 0);
    const pos = [...a.attributes.position.array, ...b.attributes.position.array];
    const idxA = [...a.index.array], idxB = [...b.index.array].map(i => i + a.attributes.position.count);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex([...idxA, ...idxB]);
    g.computeVertexNormals();
    return g;
  })();
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }), count);
  const canopies = new THREE.InstancedMesh(canGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), count);
  canopies.castShadow = true; trunks.castShadow = true;
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 30) {
    const frac = Math.random();
    const side = Math.random() > 0.5 ? 1 : -1;
    const at = track.placeAt(frac, 0);
    const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
    const dist = rand(wall + 5, wall + track.cfg.apron * 1.35);
    const p = at.p.clone().addScaledVector(at.n, side * dist);
    p.y = groundYAt(track, at.sm, side, dist);
    if (reject && reject(p, frac, side, dist)) continue;
    const q = track.query(p, at.sm.idx);
    if (Math.abs(q.lat) < track.width / 2 + 7) continue;
    const s = rand(0.8, 1.6);
    mtx.makeRotationY(Math.random() * Math.PI * 2).scale(new THREE.Vector3(s, s * rand(0.9, 1.2), s)).setPosition(p);
    trunks.setMatrixAt(placed, mtx);
    canopies.setMatrixAt(placed, mtx);
    col.setHSL(0.29 + Math.random() * 0.06, rand(0.4, 0.55), rand(0.28, 0.42));
    canopies.setColorAt(placed, col);
    placed++;
  }
  trunks.count = placed; canopies.count = placed;
  return [trunks, canopies];
}

function makeGrandstands(track, defs, crowdColors) {
  const m = new Mesher();
  const crowdSpots = [];
  for (const def of defs) {
    const f0 = def.f0, f1 = def.f1 < f0 ? def.f1 + 1 : def.f1;
    const step = 4.5 / track.length;
    for (let f = f0; f < f1; f += step) {
      const at = track.placeAt(f % 1, 0);
      const side = def.side === 'auto' ? -Math.sign(at.sm.kappa || 1) : def.side;
      const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
      const dist = wall + (def.gap ?? 3);
      const rows = def.rows ?? 6;
      const heading = at.heading;
      for (let r = 0; r < rows; r++) {
        const d = dist + 1.2 * r;
        const p = at.p.clone().addScaledVector(at.n, side * d);
        const y = at.p.y + 0.6 + r * 0.62;
        m.pushBox(p.x, y - 0.31, p.z, 1.25, 0.62, 4.6, r % 2 ? 0x6d737c : 0x5f656e, heading, 0.05);
        if (Math.random() < 0.82) crowdSpots.push([p.x, y + 0.32, p.z]);
        if (Math.random() < 0.55) crowdSpots.push([p.x + Math.sin(heading) * 1.4, y + 0.32, p.z + Math.cos(heading) * 1.4]);
      }
      // supports + roof
      const backD = dist + 1.2 * rows + 0.6;
      const pBack = at.p.clone().addScaledVector(at.n, side * backD);
      m.pushBox(pBack.x, at.p.y + rows * 0.31, pBack.z, 0.5, rows * 0.62 + 0.6, 4.6, 0x494e56, heading);
      const pRoof = at.p.clone().addScaledVector(at.n, side * (dist + rows * 0.6));
      m.pushBox(pRoof.x, at.p.y + rows * 0.62 + 2.6, pRoof.z, rows * 1.25 + 1.5, 0.25, 4.8, def.roof ?? 0xe8eaee, heading, 0.04);
      const pPost = at.p.clone().addScaledVector(at.n, side * dist);
      m.pushBox(pPost.x, at.p.y + rows * 0.31 + 1.3, pPost.z, 0.22, rows * 0.62 + 2.6, 0.22, 0x9aa0a8, 0);
    }
  }
  const structure = m.build({ roughness: 0.85 });
  // crowd
  const crowd = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    Math.max(crowdSpots.length, 1)
  );
  const mtx = new THREE.Matrix4(), col = new THREE.Color();
  crowdSpots.forEach((p, i) => {
    mtx.makeRotationY(rand(0, 6.28)).setPosition(p[0] + rand(-0.4, 0.4), p[1], p[2] + rand(-0.4, 0.4));
    crowd.setMatrixAt(i, mtx);
    col.setHSL(Math.random(), rand(0.5, 0.85), rand(0.35, 0.62));
    crowd.setColorAt(i, col);
  });
  crowd.count = crowdSpots.length;
  crowd.castShadow = false; crowd.receiveShadow = false;
  return [structure, crowd];
}

const BRANDS = [
  { t: 'VOXEL GP', bg: '#d40b18', fg: '#ffffff' },
  { t: 'GRIPELLI', bg: '#ffd700', fg: '#101010' },
  { t: 'BLOCKBULL', bg: '#1a2c5e', fg: '#ffd700' },
  { t: 'CUBEWAY', bg: '#0d9c8a', fg: '#ffffff' },
  { t: 'TURBOVOX', bg: '#ffffff', fg: '#d40b18' },
  { t: '速度方块', bg: '#16181d', fg: '#ffffff' },
];

function makeAdBoards(track, { skip } = {}) {
  const group = new THREE.Group();
  const geosByBrand = BRANDS.map(() => []);
  const postM = new Mesher();
  const stepM = 105;
  for (let s = 0; s < track.length; s += stepM) {
    const frac = s / track.length;
    if (skip && skip(frac)) continue;
    const at = track.placeAt(frac, 0);
    if (Math.abs(at.sm.kappa) > 0.006) continue;
    const side = (Math.floor(s / stepM) % 2) * 2 - 1;
    const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
    if (wall < 4) continue;
    const p = at.p.clone().addScaledVector(at.n, side * (wall + 1.1));
    const plane = new THREE.PlaneGeometry(7.2, 1.0);
    const facing = at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    plane.rotateY(facing);
    plane.translate(p.x, at.p.y + 1.15, p.z);
    geosByBrand[Math.floor(s / stepM) % BRANDS.length].push(plane);
    postM.pushBox(p.x, at.p.y + 0.3, p.z, 0.18, 0.75, 0.18, 0x50555c, 0);
  }
  geosByBrand.forEach((geos, i) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    const tex = textTexture(BRANDS[i].t, { w: 1024, h: 144, bg: BRANDS[i].bg, fg: BRANDS[i].fg });
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    mesh.castShadow = false;
    group.add(mesh);
  });
  group.add(postM.build({ castShadow: false }));
  return group;
}

// minimal geometry merge (positions+normal+uv, non-indexed)
function mergeGeometries(geos) {
  const pos = [], nrm = [], uv = [];
  for (const g of geos) {
    const gg = g.toNonIndexed ? g.toNonIndexed() : g;
    pos.push(...gg.attributes.position.array);
    nrm.push(...gg.attributes.normal.array);
    if (gg.attributes.uv) uv.push(...gg.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

function makeCornerBoards(track) {
  const corners = track.cfg.corners.filter(c => c.num > 0);
  if (!corners.length) return new THREE.Group();
  // texture atlas: one row per corner
  const cellH = 96, W = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = cellH * corners.length;
  const ctx = cv.getContext('2d');
  corners.forEach((c, i) => {
    const y = i * cellH;
    ctx.fillStyle = '#f5f0e6'; ctx.fillRect(0, y, W, cellH);
    ctx.fillStyle = '#d40b18'; ctx.fillRect(0, y, 96, cellH);
    ctx.fillStyle = '#ffffff'; ctx.font = '900 56px "Segoe UI", Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(c.num), 48, y + cellH / 2 + 2);
    ctx.fillStyle = '#15161a'; ctx.textAlign = 'left';
    ctx.font = `900 ${c.n.length > 12 ? 40 : 48}px "Segoe UI", Arial`;
    ctx.fillText(c.n.toUpperCase(), 112, y + cellH / 2 + 2, W - 130);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geos = [];
  const posts = new Mesher();
  corners.forEach((c, i) => {
    const f = ((c.f - 85 / track.length) % 1 + 1) % 1;
    const at = track.placeAt(f, 0);
    const side = -Math.sign(track.placeAt(c.f, 0).sm.kappa || 1);
    const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
    const p = at.p.clone().addScaledVector(at.n, side * (wall + 1.6));
    const plane = new THREE.PlaneGeometry(3.4, 0.65);
    const uvA = plane.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setY(k, 1 - (i + 1 - uvA.getY(k)) / corners.length);
    const facing = at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    plane.rotateY(facing);
    plane.translate(p.x, at.p.y + 2.2, p.z);
    geos.push(plane);
    posts.pushBox(p.x, at.p.y + 0.9, p.z, 0.16, 1.9, 0.16, 0x555a61, 0);
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
  const group = new THREE.Group();
  group.add(mesh, posts.build({ castShadow: false }));
  return group;
}

function makeGantry(track) {
  const at = track.placeAt(4 / track.length, 0);
  const m = new Mesher();
  const w2 = track.width / 2 + 1.4;
  const h = 6.4;
  const heading = at.heading;
  for (const side of [1, -1]) {
    const p = at.p.clone().addScaledVector(at.n, side * w2);
    m.pushBox(p.x, at.p.y + h / 2, p.z, 0.85, h, 0.85, 0x2c2f35, heading);
  }
  m.pushBox(at.p.x, at.p.y + h + 0.6, at.p.z, w2 * 2 + 1.7, 1.3, 1.1, 0x24272c, heading);
  const group = new THREE.Group();
  group.add(m.build({ roughness: 0.6 }));
  // banner
  const tex = textTexture('VOXEL GRAND PRIX', { w: 1024, h: 128, bg: '#111318', fg: '#ffffff' });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(w2 * 2, 1.0), new THREE.MeshBasicMaterial({ map: tex }));
  banner.position.set(at.p.x, at.p.y + h + 0.6, at.p.z);
  banner.rotation.y = heading + Math.PI;
  banner.translateZ(0.6);
  group.add(banner);
  // 5x2 start lights facing the grid (backwards)
  const lights = [];
  const lightGeo = new THREE.BoxGeometry(0.34, 0.34, 0.12);
  const rig = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x330a0a, toneMapped: false });
    for (let r = 0; r < 2; r++) {
      const lm = new THREE.Mesh(lightGeo, mat);
      lm.position.set((i - 2) * 0.55, -1.1 - r * 0.42, 0);
      rig.add(lm);
    }
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.35, 0.2), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5 }));
    housing.position.set((i - 2) * 0.55, -1.31, 0.08);
    rig.add(housing);
    lights.push(mat);
  }
  rig.position.set(at.p.x, at.p.y + h + 0.55, at.p.z);
  rig.rotation.y = heading + Math.PI; // face backwards toward the grid
  rig.translateZ(-0.75);
  group.add(rig);
  return { group, lights };
}

function makePit(track) {
  const cfg = track.cfg;
  const side = cfg.pitSide;
  const m = new Mesher();
  const f0 = 0.982, f1 = 1.022;
  const step = 6 / track.length;
  let first = null, last = null;
  for (let f = f0; f <= f1; f += step) {
    const at = track.placeAt(f % 1, 0);
    const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
    const d = wall + 8;
    const p = at.p.clone().addScaledVector(at.n, side * d);
    if (!first) first = { p, at };
    last = { p, at };
    const heading = at.heading;
    m.pushBox(p.x, at.p.y + 2.6, p.z, 9.5, 5.2, 6.2, 0xd6d9de, heading, 0.03);
    // garage mouth
    const pm = at.p.clone().addScaledVector(at.n, side * (d - 4.8));
    m.pushBox(pm.x, at.p.y + 1.5, pm.z, 0.3, 3.0, 4.6, 0x0e0f12, heading);
    m.pushBox(p.x, at.p.y + 5.4, p.z, 10.2, 0.3, 7.0, 0x2e3138, heading);
    // pit wall between track and lane
    const pw = at.p.clone().addScaledVector(at.n, side * (wall + 0.4));
    m.pushBox(pw.x, at.p.y + 0.5, pw.z, 0.4, 1.0, 6.2, 0x9aa0a8, heading, 0.05);
  }
  return m.build({ roughness: 0.8 });
}

function makeDistanceBoards(track) {
  const m = new Mesher();
  const group = new THREE.Group();
  const texs = [100, 50].map(n => textTexture(String(n), { w: 256, h: 256, bg: '#d40b18', fg: '#ffffff', border: '#ffffff' }));
  const geos = [[], []];
  const { samples } = track;
  // braking points: big vT drop
  const spots = [];
  for (let i = 0; i < samples.length; i += 4) {
    const ahead = samples[(i + 24) % samples.length];
    if (samples[i].vT - ahead.vT > 26 && samples[i].vT > 70) {
      if (!spots.some(sIdx => Math.abs(samples[sIdx].s - samples[i].s) < 220)) spots.push(i);
    }
  }
  for (const idx of spots.slice(0, 7)) {
    for (let b = 0; b < 2; b++) {
      const s = samples[idx].s - (b === 0 ? 100 : 50) + 60;
      const at = track.placeAt(((s / track.length) % 1 + 1) % 1, 0);
      const side = -Math.sign(samples[(idx + 26) % samples.length].kappa || 1);
      const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
      const p = at.p.clone().addScaledVector(at.n, side * (wall + 1.0));
      const plane = new THREE.PlaneGeometry(1.15, 1.15);
      plane.rotateY(at.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
      plane.translate(p.x, at.p.y + 1.5, p.z);
      geos[b].push(plane);
      m.pushBox(p.x, at.p.y + 0.45, p.z, 0.14, 0.9, 0.14, 0x50555c, 0);
    }
  }
  geos.forEach((g, i) => {
    if (!g.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(g), new THREE.MeshStandardMaterial({ map: texs[i], roughness: 0.7 }));
    group.add(mesh);
  });
  group.add(m.build({ castShadow: false }));
  return group;
}

// ---------------------------------------------------------------- Monaco
function monacoExtras(track, group, ctx) {
  const PALETTE = [0xe8d8b0, 0xe6c9a8, 0xd9a9a0, 0xf0e6d2, 0xc9b896, 0xdfd3c0];
  const m = new Mesher();
  const win = 0x2c3a4c;
  const inTunnel = f => track.inTunnel(f);
  const harborZone = (f, side) => side < 0 && ((f > 0.575 && f < 0.925) || f > 0.955 || f < 0.055);

  // --- city blocks along both sides ---
  const step = 21 / track.length;
  for (let f = 0; f < 1; f += step) {
    for (const side of [1, -1]) {
      if (inTunnel(f) || harborZone(f, side)) continue;
      if (Math.random() < 0.14) continue;
      const at = track.placeAt(f, 0);
      const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
      const setback = wall + rand(5, 13);
      const w = rand(13, 19), d = rand(10, 16), hgt = rand(11, 15) + (Math.random() < 0.3 ? rand(6, 16) : 0);
      const p = at.p.clone().addScaledVector(at.n, side * (setback + d / 2));
      const gy = groundYAt(track, at.sm, side, setback) - 0.9; // embed the base
      const heading = at.heading;
      // reject if the center or either façade end crowds any road segment
      let tooClose = false;
      for (const lx of [-w / 2, 0, w / 2]) {
        const cp = p.clone().add(new THREE.Vector3(Math.sin(heading) * lx, 0, Math.cos(heading) * lx));
        const q = track.query(cp, at.sm.idx);
        if (Math.abs(q.lat) < track.width / 2 + d / 2 + 3 && Math.abs(q.y - gy) < 9) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const col = pick(PALETTE);
      m.pushBox(p.x, gy + hgt / 2, p.z, d, hgt, w, col, heading, 0.06);
      m.pushBox(p.x, gy + hgt + 0.35, p.z, d + 0.8, 0.7, w + 0.8, 0x9e5b3c, heading, 0.08);
      // window grids on both long façades
      const cols = Math.floor(w / 2.3), rows = Math.floor(hgt / 3.2);
      for (const face of [-1, 1]) {
        for (let wc = 0; wc < cols; wc++) for (let wr = 0; wr < rows; wr++) {
          const lx = (wc - (cols - 1) / 2) * 2.3;
          const ly = gy + 2.2 + wr * 3.2;
          const off = new THREE.Vector3(Math.sin(heading) * lx, 0, Math.cos(heading) * lx); // along façade
          const facadeP = p.clone().add(off).addScaledVector(at.n, face * side * (d / 2 + 0.12));
          m.pushBox(facadeP.x, ly, facadeP.z, 0.35, 1.5, 1.15, Math.random() < 0.12 ? 0xffe9b0 : win, heading, 0.15);
        }
      }
      if (Math.random() < 0.4) { // awnings
        const ap = p.clone().addScaledVector(at.n, -side * (d / 2 + 0.7));
        m.pushBox(ap.x, gy + 3.2, ap.z, 1.4, 0.18, w * 0.5, pick([0xc23b3b, 0x3b6ec2, 0xe0e0e0]), heading, 0);
      }
    }
  }

  // --- tunnel structure + hotel above ---
  const t0 = track.cfg.tunnel[0], t1 = track.cfg.tunnel[1];
  const tm = new Mesher();
  const stepT = 3.2 / track.length;
  const lightsM = new Mesher();
  for (let f = t0; f < t1; f += stepT) {
    const at = track.placeAt(f, 0);
    const w2 = track.width / 2;
    const heading = at.heading;
    for (const side of [1, -1]) {
      const wp = at.p.clone().addScaledVector(at.n, side * (w2 + 1.35));
      tm.pushBox(wp.x, at.p.y + 2.3, wp.z, 0.7, 4.6, 4.8, 0x8f887a, heading, 0.04);
    }
    tm.pushBox(at.p.x, at.p.y + 4.9, at.p.z, (w2 + 1.7) * 2, 0.7, 4.8, 0x7e776b, heading, 0.04);
    const fi = Math.round((f - t0) / stepT);
    if (fi % 3 === 1) lightsM.pushBox(at.p.x, at.p.y + 4.45, at.p.z, 1.7, 0.14, 0.5, 0xffe0a8, heading);
    if (fi % 6 === 2) { // hotel mass above
      tm.pushBox(at.p.x, at.p.y + 5.5 + 4.5, at.p.z, (w2 + rand(6, 10)) * 2, 9, 10.5, pick(PALETTE), heading, 0.06);
    }
  }
  group.add(tm.build({ roughness: 0.9 }));
  const lightsMesh = lightsM.build({ castShadow: false, receiveShadow: false });
  lightsMesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  group.add(lightsMesh);
  // interior point lights
  for (let i = 0; i < 6; i++) {
    const f = t0 + (t1 - t0) * (i + 0.5) / 6;
    const at = track.placeAt(f, 0);
    const pl = new THREE.PointLight(0xffc890, 60, 30, 1.8);
    pl.position.set(at.p.x, at.p.y + 3.8, at.p.z);
    group.add(pl);
  }

  // --- harbor: water + quay + yachts ---
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 240, 48, 28),
    new THREE.MeshStandardMaterial({ color: 0x1d5f96, roughness: 0.24, metalness: 0.05, envMapIntensity: 0.8 })
  );
  water.rotation.x = -Math.PI / 2;
  const wAt = track.placeAt(0.755, 0);
  const wCenter = wAt.p.clone().addScaledVector(wAt.n, -(wAt.sm.wallR + 140));
  water.position.set(wCenter.x, -1.35, wCenter.z);
  water.rotation.z = -wAt.heading;
  water.receiveShadow = true;
  group.add(water);
  ctx.water = water;
  const ym = new Mesher();
  for (let i = 0; i < 11; i++) {
    const f = 0.63 + (0.90 - 0.63) * (i / 11) + rand(0, 0.01);
    const at = track.placeAt(f, 0);
    const d = at.sm.wallR + rand(26, 95);
    const p = at.p.clone().addScaledVector(at.n, -d);
    const hd = rand(0, Math.PI * 2);
    const s = rand(0.8, 1.7);
    ym.pushBox(p.x, -0.9, p.z, 10 * s, 1.4, 3.2 * s, 0xf2f4f6, hd, 0.03);       // hull
    ym.pushBox(p.x, -0.1, p.z, 6.5 * s, 0.5, 2.9 * s, 0xe4e7ea, hd);            // deck
    ym.pushBox(p.x, 0.6, p.z, 3.4 * s, 1.1, 2.2 * s, 0xd7dbdf, hd);             // cabin
    ym.pushBox(p.x, 1.9, p.z, 0.16, 2.6, 0.16, 0x8f959e, hd);                    // mast
  }
  // quay edge
  const qm = new Mesher();
  for (let f = 0.615; f < 0.92; f += 8 / track.length) {
    const at = track.placeAt(f, 0);
    const d = at.sm.wallR + rand(14, 15);
    const p = at.p.clone().addScaledVector(at.n, -d);
    qm.pushBox(p.x, at.p.y - 0.8, p.z, 2.2, 1.6, 8.4, 0xb0aca0, at.heading, 0.05);
  }
  group.add(ym.build({ roughness: 0.5 }), qm.build());
  group.add(m.build({ roughness: 0.92 }));
}

// ---------------------------------------------------------------- Suzuka
function suzukaExtras(track, group, ctx) {
  // --- crossover bridge ---
  for (const cross of track.crossings) {
    const hi = track.samples[cross.highIdx], lo = track.samples[cross.lowIdx];
    const m = new Mesher();
    const heading = Math.atan2(hi.t.x, hi.t.z);
    // girder under the upper deck
    for (let d = -16; d <= 16; d += 4) {
      const p = hi.p.clone().addScaledVector(hi.t, d);
      const y = p.y;
      m.pushBox(p.x, y - 0.65, p.z, track.width + 3.4, 1.0, 4.2, d % 8 === 0 ? 0xd8dce2 : 0xc22832, heading, 0.04);
      // side rails on the upper deck
      for (const side of [1, -1]) {
        const pr = p.clone().addScaledVector(hi.n, side * (track.width / 2 + 1.1));
        m.pushBox(pr.x, y + 0.75, pr.z, 0.35, 1.5, 4.2, 0xdfe3e8, heading, 0.03);
      }
    }
    // support pillars beside the lower road
    for (const sideL of [1, -1]) {
      const off = lo.p.clone().addScaledVector(lo.n, sideL * (track.width / 2 + 2.6));
      const h = hi.p.y - lo.p.y - 1.1;
      m.pushBox(off.x, lo.p.y + h / 2, off.z, 2.0, h, 2.0, 0xb8bcc2, 0, 0.04);
    }
    const mesh = m.build({ roughness: 0.8 });
    group.add(mesh);
    // banner on the girder facing the lower road
    const tex = textTexture('SUZUKA', { w: 512, h: 96, bg: '#c22832', fg: '#ffffff' });
    for (const s of [1, -1]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.05), new THREE.MeshBasicMaterial({ map: tex }));
      const bp = hi.p.clone().addScaledVector(hi.n, 0);
      banner.position.set(bp.x, hi.p.y - 0.65, bp.z);
      banner.rotation.y = heading + (s > 0 ? 0 : Math.PI);
      banner.translateZ(2.15);
      group.add(banner);
    }
  }

  // --- ferris wheel ---
  const at = track.placeAt(0.955, 0);
  const side = 1;
  const base = at.p.clone().addScaledVector(at.n, side * (at.sm.wallL + 85));
  base.y = groundYAt(track, at.sm, side, at.sm.wallL + 85);
  const wheel = new THREE.Group();
  const R = 24;
  const rim = new Mesher();
  const SEG = 28;
  for (let i = 0; i < SEG; i++) {
    const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
    const x0 = Math.cos(a0) * R, y0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R, y1 = Math.sin(a1) * R;
    rim.pushBox((x0 + x1) / 2, (y0 + y1) / 2, 0, Math.hypot(x1 - x0, y1 - y0) + 0.4, 0.55, 0.55, 0xe8eaee, 0);
    const seg = rim.pos.length / 3 - 24; // rotate the just-added box around Z
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let v = seg; v < rim.pos.length / 3; v++) {
      const px = rim.pos[v * 3] - (x0 + x1) / 2, py = rim.pos[v * 3 + 1] - (y0 + y1) / 2;
      rim.pos[v * 3] = (x0 + x1) / 2 + px * Math.cos(ang) - py * Math.sin(ang);
      rim.pos[v * 3 + 1] = (y0 + y1) / 2 + px * Math.sin(ang) + py * Math.cos(ang);
    }
  }
  for (let i = 0; i < 7; i++) { // spokes
    const a = i / 7 * Math.PI;
    rim.pushBox(0, 0, 0, R * 2 - 1, 0.4, 0.4, 0xc8ccd2, 0);
    const start = rim.pos.length / 3 - 24;
    for (let v = start; v < rim.pos.length / 3; v++) {
      const px = rim.pos[v * 3], py = rim.pos[v * 3 + 1];
      rim.pos[v * 3] = px * Math.cos(a) - py * Math.sin(a);
      rim.pos[v * 3 + 1] = px * Math.sin(a) + py * Math.cos(a);
    }
  }
  rim.pushBox(0, 0, 0, 2.2, 2.2, 2.6, 0x9aa0a8, 0);
  const rimMesh = rim.build({ roughness: 0.55, castShadow: false });
  wheel.add(rimMesh);
  const CABS = 14;
  const cabCols = [0xe23b3b, 0xf0a028, 0x35b06a, 0x3576d0, 0xd050b8, 0xf3ee4f];
  const cabins = [];
  for (let i = 0; i < CABS; i++) {
    const cm = new Mesher();
    cm.pushBox(0, -1.1, 0, 1.9, 2.0, 1.9, cabCols[i % cabCols.length], 0, 0.04);
    cm.pushBox(0, -0.15, 0, 0.3, 0.6, 0.3, 0x666b72, 0);
    const cab = cm.build({ castShadow: false });
    wheel.add(cab);
    cabins.push({ mesh: cab, angle: i / CABS * Math.PI * 2 });
  }
  const legs = new Mesher();
  legs.pushBox(-9, -R / 2 - 2, 0, 1.4, R + 6, 1.4, 0x8f959e, 0);
  legs.pushBox(9, -R / 2 - 2, 0, 1.4, R + 6, 1.4, 0x8f959e, 0);
  const legMesh = legs.build({});
  const whole = new THREE.Group();
  whole.add(wheel, legMesh);
  whole.position.set(base.x, base.y + R + 4, base.z);
  whole.rotation.y = at.heading + Math.PI / 2;
  group.add(whole);
  ctx.ferris = { wheel, cabins, R };
}

// ---------------------------------------------------------------- Silverstone
function silverstoneExtras(track, group) {
  // The Wing: long sleek building along the pit straight
  const m = new Mesher();
  for (let f = 0.975; f < 1.035; f += 5 / track.length) {
    const at = track.placeAt(f % 1, 0);
    const side = track.cfg.pitSide;
    const d = (side > 0 ? at.sm.wallL : at.sm.wallR) + 24;
    const p = at.p.clone().addScaledVector(at.n, side * d);
    m.pushBox(p.x, at.p.y + 4.2, p.z, 16, 8.4, 5.2, 0xdde1e6, at.heading, 0.03);
    m.pushBox(p.x, at.p.y + 8.8, p.z, 20, 0.5, 5.6, 0x2e3138, at.heading);
  }
  group.add(m.build({ roughness: 0.6 }));
}

// ---------------------------------------------------------------- main entry
export function buildEnvironment(scene, track, cfg) {
  const group = new THREE.Group();
  const ctx = { time: 0 };

  // sky, fog, lights
  const sky = makeSky(cfg.sky);
  group.add(sky);
  scene.fog = new THREE.FogExp2(cfg.sky.fog, cfg.sky.fogDensity);
  const hemi = new THREE.HemisphereLight(cfg.sky.hemiSky, cfg.sky.hemiGround, cfg.sky.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(cfg.sky.sunColor, cfg.sky.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = 85;
  sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 500;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  group.add(sun, sun.target);
  ctx.sunDir = new THREE.Vector3(...cfg.sky.sun).normalize();

  // ground disc (Monaco: sits low so the harbor water plane shows above it)
  const baseY = Math.min(...track.samples.map(s => s.p.y)) - 1.5;
  const groundCol = cfg.env === 'monaco' ? 0x8b8d90 : 0x4a7c38;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2600, 48),
    new THREE.MeshStandardMaterial({ color: groundCol, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = cfg.env === 'monaco' ? baseY - 2.6 : baseY - 0.6;
  ground.receiveShadow = true;
  group.add(ground);

  // shared props
  const center = track.samples.reduce((v, s) => v.add(s.p), new THREE.Vector3()).divideScalar(track.samples.length);
  group.add(makeClouds(center));
  const gantry = makeGantry(track);
  group.add(gantry.group);
  group.add(makePit(track));
  group.add(makeCornerBoards(track));
  group.add(makeDistanceBoards(track));

  const skipAds = f => (track.inTunnel && track.inTunnel(f)) || (f > 0.96 || f < 0.04);
  group.add(makeAdBoards(track, { skip: skipAds }));

  let standDefs, treeCount, treeReject = null;
  if (cfg.env === 'monaco') {
    standDefs = [
      { f0: 0.628, f1: 0.700, side: 1, rows: 6, gap: 2.5 },
      { f0: 0.775, f1: 0.845, side: 1, rows: 5, gap: 2.5 },
      { f0: 0.965, f1: 0.995, side: 1, rows: 5, gap: 2 },
    ];
    treeCount = 26;
    treeReject = (p, f, side) => (side < 0 && f > 0.58 && f < 0.95) || (f > 0.30 && f < 0.47) || track.inTunnel(f);
    monacoExtras(track, group, ctx);
  } else if (cfg.env === 'suzuka') {
    standDefs = [
      { f0: 0.962, f1: 1.045, side: -1, rows: 8, gap: 4 },
      { f0: 0.085, f1: 0.135, side: 'auto', rows: 6, gap: 5 },
      { f0: 0.195, f1: 0.24, side: -1, rows: 5, gap: 5 },
      { f0: 0.845, f1: 0.895, side: 1, rows: 6, gap: 5 },
      { f0: 0.475, f1: 0.50, side: 1, rows: 5, gap: 4 },
    ];
    treeCount = 380;
    suzukaExtras(track, group, ctx);
  } else {
    standDefs = [
      { f0: 0.965, f1: 1.04, side: -1, rows: 8, gap: 4 },
      { f0: 0.488, f1: 0.525, side: 1, rows: 7, gap: 5 },
      { f0: 0.60, f1: 0.655, side: -1, rows: 6, gap: 6 },
      { f0: 0.815, f1: 0.855, side: 1, rows: 6, gap: 5 },
      { f0: 0.325, f1: 0.36, side: 1, rows: 6, gap: 4 },
    ];
    treeCount = 300;
    silverstoneExtras(track, group);
  }
  const [stands, crowd] = makeGrandstands(track, standDefs);
  group.add(stands, crowd);
  const [trunks, canopies] = makeTrees(track, treeCount, treeReject);
  group.add(trunks, canopies);

  scene.add(group);

  const _target = new THREE.Vector3();
  return {
    group, sun, hemi,
    gantryLights: gantry.lights,
    update(dt, carPos) {
      ctx.time += dt;
      // sun follows car (texel-snapped to avoid shadow shimmer)
      const snap = 4;
      _target.set(Math.round(carPos.x / snap) * snap, 0, Math.round(carPos.z / snap) * snap);
      sun.position.copy(_target).addScaledVector(ctx.sunDir, 260);
      sun.target.position.copy(_target);
      if (ctx.ferris) {
        ctx.ferris.wheel.rotation.z += dt * 0.08;
        for (const cab of ctx.ferris.cabins) {
          const a = cab.angle + ctx.ferris.wheel.rotation.z;
          cab.mesh.position.set(Math.cos(a) * ctx.ferris.R, Math.sin(a) * ctx.ferris.R, 0);
          cab.mesh.rotation.z = -ctx.ferris.wheel.rotation.z - cab.angle;
        }
      }
      if (ctx.water) {
        const t = ctx.time;
        ctx.water.position.y = -1.35 + Math.sin(t * 0.7) * 0.05;
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(mt => { if (mt.map) mt.map.dispose(); mt.dispose(); });
        }
      });
    },
  };
}
