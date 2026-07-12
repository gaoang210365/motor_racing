// Track construction from real circuit centerlines: smooth spline resample,
// elevation profile, road ribbon with painted edges, auto kerbs from
// curvature, walls (street armco / open barriers), run-off aprons, start
// line + grid, timing samples with fast spatial query, figure-8 crossing
// detection and a precomputed racing speed profile.
import * as THREE from 'three';
import { CIRCUITS } from './data/circuits.js';

const UP = new THREE.Vector3(0, 1, 0);

function smoothArray(arr, radius, passes = 1, circular = true) {
  const n = arr.length;
  let src = arr.slice();
  for (let p = 0; p < passes; p++) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let j = -radius; j <= radius; j++) {
        const k = circular ? (i + j + n) % n : Math.min(n - 1, Math.max(0, i + j));
        sum += src[k]; cnt++;
      }
      out[i] = sum / cnt;
    }
    src = out;
  }
  return src;
}

export class Track {
  constructor(cfg) {
    this.cfg = cfg;
    this.width = cfg.width;
    this.group = new THREE.Group();
    this.build();
  }

  build() {
    const cfg = this.cfg;
    const raw = CIRCUITS[cfg.id].pts;
    const pts3 = raw.map(p => new THREE.Vector3(p[0], 0, p[1]));
    if (cfg.reverse) pts3.reverse();
    const curve = new THREE.CatmullRomCurve3(pts3, true, 'centripetal', 0.5);

    const approxLen = curve.getLength();
    const N = this.N = Math.round(approxLen / 2.5);

    // ---- sample centerline starting at the S/F line ----
    const pos = [];
    for (let i = 0; i < N; i++) {
      const u = (cfg.startFrac + i / N) % 1;
      pos.push(curve.getPointAt(u));
    }
    // elevation profile keyed by relative frac
    const elev = cfg.elevation;
    const elevAt = f => {
      const ext = [...elev, [1 + elev[0][0], elev[0][1]]];
      for (let i = 0; i < ext.length - 1; i++) {
        if (f >= ext[i][0] && f <= ext[i + 1][0]) {
          const t = (f - ext[i][0]) / (ext[i + 1][0] - ext[i][0] || 1);
          return ext[i][1] + (ext[i + 1][1] - ext[i][1]) * t;
        }
      }
      return elev[0][1];
    };
    let ys = pos.map((_, i) => elevAt(i / N));
    ys = smoothArray(ys, 10, 2);
    pos.forEach((p, i) => { p.y = ys[i]; });

    // ---- arc length, tangents, normals, curvature ----
    const s = [0];
    for (let i = 1; i <= N; i++) s.push(s[i - 1] + pos[i - 1].distanceTo(pos[i % N]));
    this.length = s[N];

    const samples = this.samples = [];
    for (let i = 0; i < N; i++) {
      const prev = pos[(i - 1 + N) % N], next = pos[(i + 1) % N];
      const d = new THREE.Vector3().subVectors(next, prev);
      const horiz = Math.hypot(d.x, d.z) || 1;
      const t = new THREE.Vector3(d.x / horiz, 0, d.z / horiz);
      const n = new THREE.Vector3().crossVectors(UP, t).normalize(); // left
      samples.push({
        p: pos[i], t, n, s: s[i], frac: s[i] / this.length,
        dyds: d.y / (horiz + Math.abs(d.y) * 0.2),
        kappa: 0, kerb: false, wallL: 0, wallR: 0, vT: 0, idx: i,
      });
    }
    let kappa = [];
    for (let i = 0; i < N; i++) {
      const t1 = samples[i].t, t2 = samples[(i + 1) % N].t;
      const cross = t1.z * t2.x - t1.x * t2.z; // + = turning left
      const dot = THREE.MathUtils.clamp(t1.dot(t2), -1, 1);
      const ang = Math.asin(THREE.MathUtils.clamp(cross, -1, 1)) * Math.sign(dot >= 0 ? 1 : 1);
      const ds = (s[i + 1] - s[i]) || 1;
      kappa.push(ang / ds);
    }
    kappa = smoothArray(kappa, 4, 2);
    samples.forEach((sm, i) => { sm.kappa = kappa[i]; });

    // kerb zones where curvature is significant
    const kerbFlag = samples.map(sm => Math.abs(sm.kappa) > cfg.kerbThreshold);
    for (let i = 0; i < N; i++) {
      if (kerbFlag[i]) for (let j = -5; j <= 5; j++) samples[(i + j + N) % N].kerb = true;
    }

    // ---- walls, clamped where two roads run close (open tracks) ----
    const base = this.width / 2 + cfg.wallDist;
    const skipApron = new Array(N).fill(false);
    for (let i = 0; i < N; i++) { samples[i].wallL = base; samples[i].wallR = base; }
    // proximity scan (also finds figure-8 crossings + apron clearance)
    const crossPairs = [];
    const minOther = new Array(N).fill(Infinity);
    for (let i = 0; i < N; i += 2) {
      const a = samples[i];
      for (let j = i + 60; j < N; j += 2) {
        if ((N - (j - i)) < 60) continue;
        const b = samples[j];
        const dx = a.p.x - b.p.x, dz = a.p.z - b.p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 130 * 130) continue;
        const d = Math.sqrt(d2);
        if (d < minOther[i]) { minOther[i] = d; minOther[i + 1 < N ? i + 1 : 0] = Math.min(minOther[i + 1 < N ? i + 1 : 0], d + 2.5); }
        if (d < minOther[j]) { minOther[j] = d; minOther[j + 1 < N ? j + 1 : 0] = Math.min(minOther[j + 1 < N ? j + 1 : 0], d + 2.5); }
        const dy = Math.abs(a.p.y - b.p.y);
        if (d < this.width + 4 && dy > 3.5) {
          crossPairs.push([i, j, d]);
          for (let k = -10; k <= 10; k++) { skipApron[(i + k + N) % N] = true; skipApron[(j + k + N) % N] = true; }
          continue;
        }
        if (dy < 3.5 && d < base * 2 + this.width) {
          const room = Math.max(1.4, (d - this.width) / 2 - 0.6);
          for (const smp of [a, b]) { smp.wallL = Math.min(smp.wallL, room); smp.wallR = Math.min(smp.wallR, room); }
        }
      }
    }
    // per-sample apron width clamped by clearance to the nearest other road
    for (let i = 0; i < N; i++) {
      const clear = (Math.min(minOther[i], minOther[(i + 1) % N], minOther[(i - 1 + N) % N]) - this.width) / 2 - 1;
      samples[i].apronW = Math.max(1.2, Math.min(cfg.apron, clear));
    }
    { // smooth apron widths
      const w = samples.map(s => s.apronW);
      const sw = smoothArray(w, 6, 1);
      samples.forEach((s, i) => { s.apronW = sw[i]; });
    }
    // cluster crossings to a single representative pair
    this.crossings = [];
    if (crossPairs.length) {
      crossPairs.sort((p, q) => p[2] - q[2]);
      const used = [];
      for (const [i, j] of crossPairs) {
        if (used.some(([a, b]) => Math.abs(a - i) < 40 && Math.abs(b - j) < 40)) continue;
        used.push([i, j]);
        const low = samples[i].p.y < samples[j].p.y ? i : j;
        const high = low === i ? j : i;
        this.crossings.push({ lowIdx: low, highIdx: high });
      }
    }
    this.skipApron = skipApron;
    for (let i = 0; i < N; i++) { // smooth wall distances
      const sm = samples[i];
      sm.wallL = Math.min(sm.wallL, samples[(i + 1) % N].wallL + 0.5, samples[(i - 1 + N) % N].wallL + 0.5);
      sm.wallR = Math.min(sm.wallR, samples[(i + 1) % N].wallR + 0.5, samples[(i - 1 + N) % N].wallR + 0.5);
    }

    // ---- spatial hash for queries ----
    this.cell = 12;
    this.grid = new Map();
    samples.forEach((sm, i) => {
      const k = `${Math.floor(sm.p.x / this.cell)},${Math.floor(sm.p.z / this.cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });

    // ---- racing speed profile ----
    this.computeProfile();

    // ---- geometry ----
    this.buildRoad();
    this.buildKerbs();
    this.buildWalls();
    this.buildAprons();
    this.buildStartLine();

    // minimap polyline
    this.minimap = [];
    for (let i = 0; i < N; i += 4) this.minimap.push([samples[i].p.x, samples[i].p.z]);
  }

  computeProfile() {
    const { samples, N } = this;
    const mu = 1.72, m = 798, kDF = 3.15, g = 9.81;
    const vCap = 92;
    const v = new Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(samples[i].kappa);
      const denom = k - (mu * kDF / m) * 0.92;
      v[i] = denom > 1e-5 ? Math.sqrt(mu * g * 0.92 / denom) : vCap;
      v[i] = Math.min(v[i], vCap);
    }
    // backward braking passes (circular, two loops for wrap)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const j = (i + 1) % N;
        const ds = ((samples[j].s - samples[i].s) + this.length) % this.length;
        const aBrake = mu * (g + kDF * v[j] * v[j] / m) * 0.80;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrake * ds));
      }
    }
    // forward acceleration limit
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        const ds = ((samples[j].s - samples[i].s) + this.length) % this.length;
        const aAcc = Math.min(735000 / Math.max(v[i], 8) / m, 13);
        v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * aAcc * ds));
      }
    }
    samples.forEach((sm, i) => { sm.vT = v[i]; });
  }

  // ---------- geometry builders ----------
  addMesh(geo, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: opts.roughness ?? 1, metalness: 0,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = opts.receiveShadow ?? true;
    mesh.castShadow = opts.castShadow ?? false;
    this.group.add(mesh);
    return mesh;
  }

  ribbonGeometry(rows, colors) {
    // rows: array of arrays of Vector3 (same count per row, closed loop rows)
    const nRows = rows.length, nCols = rows[0].length;
    const posArr = [], colArr = [], idx = [];
    for (let i = 0; i < nRows; i++) for (let c = 0; c < nCols; c++) {
      posArr.push(rows[i][c].x, rows[i][c].y, rows[i][c].z);
      const col = colors[i][c];
      colArr.push(col.r, col.g, col.b);
    }
    for (let i = 0; i < nRows; i++) {
      const j = (i + 1) % nRows;
      for (let c = 0; c < nCols - 1; c++) {
        const a = i * nCols + c, b = i * nCols + c + 1, d = j * nCols + c, e = j * nCols + c + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  inTunnel(frac) {
    const t = this.cfg.tunnel;
    if (!t) return false;
    return t[0] < t[1] ? (frac >= t[0] && frac <= t[1]) : (frac >= t[0] || frac <= t[1]);
  }

  buildRoad() {
    const { samples } = this;
    const w2 = this.width / 2, lw = 0.32;
    const rows = [], colors = [];
    const asphalt = new THREE.Color(0x3a3e45), white = new THREE.Color(0xd8dadf);
    for (const sm of samples) {
      const j = 0.94 + ((sm.idx * 7919) % 13) / 13 * 0.12;
      let road = asphalt.clone().multiplyScalar(j);
      if (this.inTunnel(sm.frac)) road.multiply(new THREE.Color(1.1, 0.98, 0.82));
      const edge = white.clone().multiplyScalar(this.inTunnel(sm.frac) ? 0.8 : 1);
      rows.push([
        sm.p.clone().addScaledVector(sm.n, w2),
        sm.p.clone().addScaledVector(sm.n, w2 - lw),
        sm.p.clone().addScaledVector(sm.n, -w2 + lw),
        sm.p.clone().addScaledVector(sm.n, -w2),
      ]);
      colors.push([edge, road, road.clone().multiplyScalar(0.985), edge]);
    }
    this.addMesh(this.ribbonGeometry(rows, colors), { roughness: 0.96 });
  }

  buildKerbs() {
    const { samples, N } = this;
    const w2 = this.width / 2;
    const posArr = [], colArr = [], idx = [];
    const red = new THREE.Color(0xc8202a), wht = new THREE.Color(0xe8e8ea);
    const h = 0.055, kw = 1.15;
    for (let side = -1; side <= 1; side += 2) {
      let run = null;
      for (let i = 0; i <= N; i++) {
        const sm = samples[i % N];
        const active = sm.kerb && i < N;
        if (active && !run) run = [];
        if (run && active) run.push(sm);
        if (run && (!active || i === N)) {
          if (run.length > 3) {
            for (let k = 0; k < run.length - 1; k++) {
              const a = run[k], b = run[k + 1];
              const col = Math.floor(a.s / 2.6) % 2 === 0 ? red : wht;
              const base = posArr.length / 3;
              const pa0 = a.p.clone().addScaledVector(a.n, side * (w2 - 0.05));
              const pa1 = a.p.clone().addScaledVector(a.n, side * (w2 + kw));
              const pb0 = b.p.clone().addScaledVector(b.n, side * (w2 - 0.05));
              const pb1 = b.p.clone().addScaledVector(b.n, side * (w2 + kw));
              // top surface (raised) + outer skirt
              for (const [p, lift] of [[pa0, h], [pa1, h * 0.4], [pb0, h], [pb1, h * 0.4], [pa1, -0.12], [pb1, -0.12]]) {
                posArr.push(p.x, p.y + lift, p.z);
                colArr.push(col.r, col.g, col.b);
              }
              idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
              idx.push(base + 1, base + 4, base + 3, base + 4, base + 5, base + 3);
            }
          }
          run = null;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.addMesh(geo, { roughness: 0.9 });
  }

  buildWalls() {
    const { samples, cfg } = this;
    const street = cfg.walls === 'street';
    const steel = new THREE.Color(0xaeb4bc), steelD = new THREE.Color(0x878d96);
    const blue = new THREE.Color(0x2a5db0), whiteB = new THREE.Color(0xdfe4ea);
    const heights = street ? [0, 0.18, 0.3, 0.45, 0.6, 0.72, 0.95] : [0, 0.45, 0.55, 1.0];
    for (const side of [1, -1]) {
      const rows = [], colors = [];
      for (const sm of samples) {
        const dist = side > 0 ? sm.wallL : sm.wallR;
        const foot = sm.p.clone().addScaledVector(sm.n, side * dist);
        const row = [], colRow = [];
        heights.forEach((hh, k) => {
          row.push(new THREE.Vector3(foot.x, foot.y + hh, foot.z));
          if (street) colRow.push(k % 2 === 0 ? steelD : steel);
          else colRow.push(hh < 0.5 ? blue : whiteB);
        });
        rows.push(row); colors.push(colRow);
      }
      this.addMesh(this.ribbonGeometry(rows, colors), { doubleSide: true, castShadow: true, roughness: 0.7 });
    }
  }

  buildAprons() {
    const { samples, cfg } = this;
    const street = cfg.walls === 'street';
    const w2 = this.width / 2;
    const grass1 = new THREE.Color(0x4d8a3d), grass2 = new THREE.Color(0x447c36);
    const gravel = new THREE.Color(0xc9b184);
    const conc1 = new THREE.Color(0x9b9da1), conc2 = new THREE.Color(0x8b8d92);
    const baseY = Math.min(...samples.map(s => s.p.y)) - 1.2;
    for (const side of [1, -1]) {
      const rows = [], colors = [];
      for (const sm of samples) {
        const wall = side > 0 ? sm.wallL : sm.wallR;
        const skip = this.skipApron[sm.idx];
        const runoffCol = street
          ? (sm.idx % 2 ? conc1 : conc2)
          : (Math.abs(sm.kappa) > 0.010 && Math.sign(sm.kappa) !== Math.sign(side) ? gravel : (sm.idx % 2 ? grass1 : grass2));
        const outerCol = street ? conc2.clone().multiplyScalar(0.9) : (sm.idx % 2 ? grass2 : grass1);
        const apron = skip ? 0.01 : sm.apronW;
        const p0 = sm.p.clone().addScaledVector(sm.n, side * w2);
        const p1 = sm.p.clone().addScaledVector(sm.n, side * wall);
        const p2 = sm.p.clone().addScaledVector(sm.n, side * (wall + apron * 0.45));
        const p3 = sm.p.clone().addScaledVector(sm.n, side * (wall + apron));
        p0.y -= 0.02; p1.y -= 0.02;
        p2.y = THREE.MathUtils.lerp(sm.p.y, Math.max(baseY, sm.p.y - 3), 0.5);
        p3.y = skip ? sm.p.y - 0.02 : Math.max(baseY, sm.p.y - 6) - 0.5;
        rows.push([p0, p1, p2, p3]);
        const jit = 0.93 + ((sm.idx * 2654435761) % 17) / 17 * 0.14;
        colors.push([runoffCol.clone().multiplyScalar(jit), runoffCol.clone().multiplyScalar(jit * 0.97), outerCol.clone().multiplyScalar(jit), outerCol.clone().multiplyScalar(jit * 0.95)]);
      }
      this.addMesh(this.ribbonGeometry(rows, colors), { roughness: 1 });
    }
  }

  buildStartLine() {
    const { samples } = this;
    const w2 = this.width / 2;
    const sm = samples[0], sm2 = samples[1];
    const posArr = [], colArr = [], idx = [];
    const cols = 12, rowsN = 2;
    const dark = new THREE.Color(0x101013), light = new THREE.Color(0xf2f3f5);
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const l0 = -w2 + (c / cols) * this.width, l1 = -w2 + ((c + 1) / cols) * this.width;
        const t0 = r * 1.0, t1 = (r + 1) * 1.0;
        const col = (r + c) % 2 === 0 ? dark : light;
        const base = posArr.length / 3;
        for (const [lat, ss] of [[l0, t0], [l1, t0], [l0, t1], [l1, t1]]) {
          const p = sm.p.clone().addScaledVector(sm.n, lat).addScaledVector(sm.t, ss);
          posArr.push(p.x, p.y + 0.015, p.z);
          colArr.push(col.r, col.g, col.b);
        }
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    // grid slots
    const white = new THREE.Color(0xe8e9ec);
    for (let slot = 0; slot < 10; slot++) {
      const sBack = -9 - slot * 9;
      const lat = (slot % 2 === 0 ? 1 : -1) * this.width * 0.22;
      const at = this.sampleAt(((sBack / this.length) % 1 + 1) % 1 * this.length);
      for (const [dl, ds, wq, lq] of [[-1.4, 0, 2.8, 0.25], [-1.4, 0, 0.25, 2.2], [1.15, 0, 0.25, 2.2]]) {
        const base = posArr.length / 3;
        for (const [a, b] of [[0, 0], [wq, 0], [0, lq], [wq, lq]]) {
          const p = at.p.clone().addScaledVector(at.n, lat + dl + a).addScaledVector(at.t, ds - b - 2);
          posArr.push(p.x, p.y + 0.013, p.z);
          colArr.push(white.r, white.g, white.b);
        }
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.addMesh(geo, { roughness: 0.85 });
  }

  // ---------- queries ----------
  sampleAt(s) {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0, hi = this.N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.samples[mid].s <= s) lo = mid; else hi = mid - 1;
    }
    return this.samples[lo];
  }

  query(pos, hint = 0) {
    const { samples, N } = this;
    let best = -1, bd = Infinity;
    const scan = (i) => {
      const sm = samples[i];
      const dx = sm.p.x - pos.x, dz = sm.p.z - pos.z;
      const d2 = dx * dx + dz * dz;
      // penalize big height mismatch so figure-8 roads don't cross-talk
      const dy = sm.p.y - pos.y;
      const dd = d2 + dy * dy * 6;
      if (dd < bd) { bd = dd; best = i; }
    };
    for (let j = -50; j <= 50; j++) scan((hint + j + N * 4) % N);
    if (bd > 28 * 28) {
      for (const [, list] of this.grid) { /* fallback rare: full-ish scan */ }
      for (let i = 0; i < N; i += 3) scan(i);
    }
    // project onto neighboring segment
    const a = samples[best];
    const b = samples[(best + 1) % N];
    const c = samples[(best - 1 + N) % N];
    let s0 = a, s1 = b;
    const abx = b.p.x - a.p.x, abz = b.p.z - a.p.z;
    let tt = ((pos.x - a.p.x) * abx + (pos.z - a.p.z) * abz) / (abx * abx + abz * abz || 1);
    if (tt < 0) {
      s0 = c; s1 = a;
      const cbx = a.p.x - c.p.x, cbz = a.p.z - c.p.z;
      tt = ((pos.x - c.p.x) * cbx + (pos.z - c.p.z) * cbz) / (cbx * cbx + cbz * cbz || 1);
    }
    tt = THREE.MathUtils.clamp(tt, 0, 1);
    const px = s0.p.x + (s1.p.x - s0.p.x) * tt;
    const py = s0.p.y + (s1.p.y - s0.p.y) * tt;
    const pz = s0.p.z + (s1.p.z - s0.p.z) * tt;
    const nx = s0.n.x + (s1.n.x - s0.n.x) * tt, nz = s0.n.z + (s1.n.z - s0.n.z) * tt;
    const nl = Math.hypot(nx, nz) || 1;
    const lat = ((pos.x - px) * nx + (pos.z - pz) * nz) / nl;
    let ss = s0.s + (((s1.s - s0.s) + this.length) % this.length) * tt;
    ss = ss % this.length;
    _q.idx = s0.idx; _q.s = ss; _q.frac = ss / this.length;
    _q.lat = lat; _q.y = py;
    _q.t = s0.t; _q.n = s0.n; _q.dyds = s0.dyds + (s1.dyds - s0.dyds) * tt;
    _q.kerbL = s0.kerb; _q.kerbR = s0.kerb;
    _q.wallL = s0.wallL; _q.wallR = s0.wallR;
    _q.kappa = s0.kappa; _q.vT = s0.vT;
    return _q;
  }

  inDrsZone(frac) {
    for (const [a, b] of (this.cfg.drs || [])) {
      if (a < b ? (frac >= a && frac <= b) : (frac >= a || frac <= b)) return true;
    }
    return false;
  }

  // position/orientation helper for scenery placement
  placeAt(frac, lat, y = 0) {
    const sm = this.sampleAt(((frac % 1) + 1) % 1 * this.length);
    const p = sm.p.clone().addScaledVector(sm.n, lat);
    p.y = sm.p.y + y;
    return { p, t: sm.t.clone(), n: sm.n.clone(), heading: Math.atan2(sm.t.x, sm.t.z), sm };
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); }
    });
  }
}

const _q = {};
