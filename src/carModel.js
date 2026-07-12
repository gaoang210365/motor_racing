// Detailed voxel F1 car (2022+ ground-effect era): front wing cascade, halo,
// sidepods with undercut, airbox + shark fin, DRS rear wing, wheel covers,
// driver helmet, per-livery paint and racing number.
// Local frame: +Z = forward, +X = left, +Y = up. Voxel size 0.05 m.
import * as THREE from 'three';
import { VoxelBuilder, voxelMaterial, glowMaterial } from './voxel.js';

const VOX = 0.05;
const TIRE = 0x141416;
const TIRE_BAND = 0xc41e24;
const CARBON = 0x17181c;
const INLET = 0x0a0a0d;
const GLASS = 0x18222e;
const METAL = 0x8f959e;

const FONT = {
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
  '2': ['111','001','111','100','111'], '3': ['111','001','011','001','111'],
  '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
  '6': ['100','100','111','101','111'], '7': ['111','001','010','010','010'],
  '8': ['111','101','111','101','111'], '9': ['111','101','111','001','001'],
};

// Stamp a number by recoloring existing top-surface voxels (rows run along -z).
function stampNumber(b, num, xCenter, y, zTop, color) {
  const str = String(num);
  const wTotal = str.length * 4 - 1;
  let cx = xCenter + Math.floor(wTotal / 2);
  for (const ch of str) {
    const g = FONT[ch];
    if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (g[r][c] === '1') {
        const x = cx - c, z = zTop - r;
        if (b.get(x, y, z) !== undefined) b.set(x, y, z, color);
      }
    }
    cx -= 4;
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

function buildBody(L) {
  const b = new VoxelBuilder(VOX);

  // ---- floor plank ----
  for (let z = -33; z <= 30; z++) {
    let hw = 15;
    if (z > 22) hw = Math.round(lerp(15, 7, (z - 22) / 8));
    if (z < -26) hw = Math.round(lerp(15, 5, (-26 - z) / 7));
    b.box(-hw, hw, 1, 1, z, z, CARBON);
    if (hw === 15) { b.set(-15, 2, z, L.accent); b.set(15, 2, z, L.accent); } // floor edge wing
  }

  // ---- monocoque: cockpit section + forward chassis + nose ----
  for (let z = 10; z <= 44; z++) {
    const t = (z - 10) / 34;
    const hw = Math.round(lerp(8, 4, t));
    const yTop = Math.round(lerp(9, 7, t));
    b.box(-hw, hw, 2, yTop, z, z, L.body);
  }
  for (let z = 45; z <= 55; z++) { // nose cone
    const t = (z - 45) / 10;
    const hw = Math.max(1, Math.round(lerp(4, 1, t)));
    const y0 = Math.round(lerp(3, 5, t));
    const y1 = Math.max(y0 + 1, Math.round(lerp(7, 6, t)));
    b.box(-hw, hw, y0, y1, z, z, L.body);
  }
  // nose top accent stripe + camera pod
  for (let z = 30; z <= 52; z++) { const c = b.get(0, 8, z) !== undefined ? 8 : 7; if (b.get(0, c, z)) b.box(-1, 1, c, c, z, z, L.accent); }
  b.box(-2, 2, 8, 9, 40, 42, 0x101014);
  b.box(-3, 3, 8, 8, 39, 43, L.accent2);
  stampNumber(b, L.number, 0, 8, 38, L.secondary === 0x16161a ? 0xffffff : L.accent2);

  // ---- cockpit ----
  b.box(-8, 8, 2, 10, -6, 9, L.body);            // tub around cockpit
  b.box(-8, 8, 11, 11, -6, 10, L.secondary);      // rim padding
  b.box(-4, 4, 6, 11, -4, 8, 0x0c0d10);           // opening (carve look: dark)
  b.box(-4, 4, 5, 5, -4, 8, 0x141518);            // seat floor
  b.box(-3, 3, 11, 12, 10, 11, GLASS);            // tiny windscreen
  // driver helmet + visor
  b.box(-2, 2, 12, 15, -2, 2, L.helmet);
  b.box(-1, 1, 16, 16, -1, 1, L.helmet);
  b.box(-2, 2, 14, 14, -2, 2, L.helmetStripe);
  b.box(-1, 1, 13, 14, 3, 3, GLASS);
  b.box(-3, 3, 10, 11, -3, -1, L.secondary);      // shoulders/head surround
  // steering wheel
  b.box(-2, 2, 9, 10, 6, 6, 0x0e0f12);
  b.box(-1, 1, 9, 9, 6, 6, L.accent2);

  // ---- halo ----
  b.box(0, 0, 11, 15, 9, 10, L.halo);             // center pylon
  b.sym(s => {
    b.line(s * 6, 12, -5, s * 7, 15, 0, L.halo, 1.6);
    b.line(s * 7, 15, 0, s * 5, 15, 7, L.halo, 1.6);
    b.line(s * 5, 15, 7, s * 1, 15, 10, L.halo, 1.6);
  });

  // ---- sidepods with undercut ----
  for (let z = -26; z <= 3; z++) {
    const t = Math.max(0, Math.min(1, (3 - z) / 29));
    const out = Math.round(lerp(15, 10, t));
    const top = Math.round(lerp(9, 5, t * t));
    b.box(-out, -8, 3, top, z, z, L.body);
    b.box(8, out, 3, top, z, z, L.body);
  }
  b.box(9, 14, 5, 8, 4, 4, INLET);                 // radiator inlets
  b.box(-14, -9, 5, 8, 4, 4, INLET);
  b.box(9, 14, 4, 9, 5, 5, L.secondary);           // inlet lips
  b.box(-14, -9, 4, 9, 5, 5, L.secondary);

  // ---- airbox + engine cover spine + shark fin ----
  b.box(-3, 3, 12, 16, -9, -3, L.body);            // airbox
  b.box(-2, 2, 13, 15, -2, -2, INLET);             // intake mouth
  b.box(-1, 1, 17, 17, -7, -4, L.body);            // roll hoop tip
  b.box(-2, 2, 17, 18, -7, -5, 0x101014);          // T-cam pod
  b.set(-2, 17, -6, L.accent2); b.set(2, 17, -6, L.accent2);
  for (let z = -30; z <= -9; z++) {                // tapering spine
    const t = (-9 - z) / 21;
    const top = Math.round(lerp(12, 6, t));
    const hw = Math.round(lerp(3, 2, t));
    b.box(-hw, hw, 3, top, z, z, L.body);
  }
  for (let z = -30; z <= -14; z++) {               // shark fin
    const spineTop = Math.round(lerp(12, 6, (-9 - z) / 21));
    b.box(0, 0, spineTop, 14, z, z, L.fin);
  }
  b.box(0, 0, 14, 14, -30, -14, L.accent2);        // fin top edge

  // ---- gearbox + tail ----
  for (let z = -44; z <= -31; z++) {
    const t = (-31 - z) / 13;
    const hw = Math.max(2, Math.round(lerp(5, 2, t)));
    b.box(-hw, hw, 3, Math.round(lerp(7, 5, t)), z, z, L.secondary);
  }
  b.box(-2, 2, 4, 6, -50, -45, L.secondary);       // crash structure
  b.box(-1, 1, 6, 7, -44, -42, METAL);             // exhaust tip

  // ---- beam wing + diffuser ----
  b.box(-10, 10, 8, 8, -47, -45, CARBON);
  b.box(-10, 10, 9, 9, -49, -47, L.secondary);
  for (let z = -48; z <= -40; z++) {               // diffuser ramp
    const y = 1 + Math.round((-40 - z) * 0.5);
    b.box(-12, 12, y, y, z, z, CARBON);
    for (const sx of [-12, -6, 0, 6, 12]) b.box(sx, sx, y, y + 2, z, z, CARBON);
  }

  // ---- rear wing (main plane + endplates; DRS flap is separate) ----
  b.box(-1, 1, 9, 15, -46, -44, L.secondary);      // swan-neck pylon
  for (let z = -50; z <= -45; z++) {               // main plane, slight incline
    const y = 15 + Math.round((-45 - z) * 0.2);
    b.box(-15, 15, y, y, z, z, CARBON);
  }
  b.box(-15, 15, 15, 15, -45, -44, CARBON);
  b.box(-14, 14, 16, 16, -50, -49, L.accent2);     // trailing-edge flick
  b.sym(s => {
    b.box(s * 16, s * 16, 10, 19, -52, -42, L.wing);          // endplate
    b.box(s * 16, s * 16, 10, 13, -52, -49, L.accent);        // livery flick
    b.del(s * 16, 19, -42); b.del(s * 16, 19, -43);           // top-front cutout
    b.del(s * 16, 18, -42);
    b.box(s * 16, s * 16, 14, 17, -47, -46, L.accent2);       // number patch
  });

  // ---- mirrors ----
  b.sym(s => {
    b.line(s * 7, 11, 7, s * 9, 12, 8, CARBON, 1);
    b.box(s * 9, s * 10, 12, 13, 8, 9, L.secondary);
    b.set(s * 9, 12, 7, GLASS); b.set(s * 10, 12, 7, GLASS);
  });

  // ---- front wing ----
  for (let x = -19; x <= 19; x++) {                // main plane with dip
    const dip = Math.abs(x) < 4 ? 1 : 0;
    b.box(x, x, 1, 1 + (Math.abs(x) > 16 ? 1 : 0), 48 - dip, 55 - Math.abs(Math.round(x * 0.12)), L.wing);
  }
  b.box(-19, -5, 2, 2, 46, 51, L.secondary);       // flap 2
  b.box(5, 19, 2, 2, 46, 51, L.secondary);
  b.box(-19, -6, 3, 3, 45, 48, L.wing);            // flap 3
  b.box(6, 19, 3, 3, 45, 48, L.wing);
  b.box(-18, -7, 4, 4, 44, 46, L.secondary);       // upper cascade
  b.box(7, 18, 4, 4, 44, 46, L.secondary);
  b.sym(s => {
    b.box(s * 20, s * 20, 1, 6, 45, 55, L.accent); // endplates
    b.box(s * 20, s * 20, 1, 3, 52, 55, L.body);
    b.del(s * 20, 6, 55); b.del(s * 20, 6, 54);
    b.line(s * 4, 5, 46, s * 4, 3, 48, L.body, 1); // nose pillars
  });

  // ---- suspension ----
  b.sym(s => {
    b.line(s * 7, 8, 38, s * 13, 7, 37, CARBON, 1);
    b.line(s * 7, 8, 32, s * 13, 7, 35, CARBON, 1);
    b.line(s * 6, 4, 38, s * 13, 4, 37, CARBON, 1);
    b.line(s * 6, 4, 32, s * 13, 4, 35, CARBON, 1);
    b.line(s * 6, 6, 30, s * 13, 6, 34, CARBON, 1);
    b.line(s * 4, 7, -33, s * 13, 7, -36, CARBON, 1);
    b.line(s * 4, 3, -32, s * 13, 4, -36, CARBON, 1);
    b.line(s * 5, 5, -36, s * 13, 5, -36, CARBON, 1);
  });

  return b.build();
}

function buildWheel(L, { width, side }) {
  const b = new VoxelBuilder(VOX);
  const hw = Math.floor(width / 2);
  b.cylinderX(0, 0, 0, -hw, hw, 4.2, 7, TIRE);
  // sidewall compound band + brand blocks (outboard face)
  const xo = side > 0 ? hw : -hw;
  for (let y = -7; y <= 7; y++) for (let z = -7; z <= 7; z++) {
    const d = Math.sqrt(y * y + z * z);
    if (d <= 6.6 && d >= 5.7 && b.get(xo, y, z) !== undefined) {
      const ang = Math.atan2(z, y);
      const seg = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8) % 2;
      if (seg === 0) b.set(xo, y, z, TIRE_BAND);
    }
  }
  // aero wheel cover (outboard) + brake duct (inboard)
  b.cylinderX(0, 0, 0, xo, xo, 0, 4.1, L.rim);
  b.cylinderX(0, 0, 0, xo, xo, 0, 1.4, L.accent2);
  b.cylinderX(0, 0, 0, -xo, -xo, 0, 4.1, 0x0d0d10);
  b.cylinderX(0, 0, 0, -xo - (side > 0 ? -1 : 1) * 0, -xo, 2.6, 3.4, 0x351410); // glowing-ish brake ring hint
  // axle hub through the middle
  b.cylinderX(0, 0, 0, -hw + 1, hw - 1, 0, 1.2, 0x222327);
  return b.build();
}

export function buildCar(livery) {
  const L = livery;
  const group = new THREE.Group();
  const tilt = new THREE.Group(); // visual roll/pitch
  group.add(tilt);

  const bodyMat = voxelMaterial({ roughness: 0.45, metalness: 0.18, envMapIntensity: 0.5 });
  const body = new THREE.Mesh(buildBody(L), bodyMat);
  body.position.y = 0.03;
  body.castShadow = true;
  tilt.add(body);

  // rain light
  const rain = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.05), glowMaterial(0xff2222, 2.2));
  rain.position.set(0, 0.28, -2.56);
  tilt.add(rain);

  // DRS flap
  const flapGeo = (() => { // small inclined slab built via voxels
    const fb = new VoxelBuilder(VOX);
    for (let z = -2; z <= 2; z++) {
      const y = Math.round((-z + 2) * 0.45);
      fb.box(-14, 14, y, y, z, z, 0x17181c);
    }
    fb.box(-14, 14, 2, 2, -2, -1, L.accent);
    return fb.build();
  })();
  const drsFlap = new THREE.Mesh(flapGeo, bodyMat);
  const drsPivot = new THREE.Group();
  drsPivot.position.set(0, 0.85, -2.30); // hinge above main plane
  drsPivot.add(drsFlap);
  drsFlap.position.set(0, 0, 0);
  tilt.add(drsPivot);

  // wheels
  const wheelMat = voxelMaterial({ roughness: 0.75, metalness: 0.1, envMapIntensity: 0.35 });
  const wheels = [];
  const defs = [
    { x: 0.8, z: 1.8, width: 7, steer: true, side: 1 },
    { x: -0.8, z: 1.8, width: 7, steer: true, side: -1 },
    { x: 0.8, z: -1.8, width: 9, steer: false, side: 1 },
    { x: -0.8, z: -1.8, width: 9, steer: false, side: -1 },
  ];
  for (const d of defs) {
    const mesh = new THREE.Mesh(buildWheel(L, d), wheelMat);
    mesh.castShadow = true;
    const spin = new THREE.Group();
    spin.add(mesh);
    const steer = new THREE.Group();
    steer.add(spin);
    steer.position.set(d.x, 0.35, d.z);
    group.add(steer);
    wheels.push({ steer, spin, isFront: d.steer, side: d.side });
  }

  return {
    group, tilt, wheels, drsPivot, rainLight: rain,
    dims: {
      wheelbase: 3.6, halfTrack: 0.8, wheelRadius: 0.35,
      eye: new THREE.Vector3(0, 0.92, 0.32),
      tcam: new THREE.Vector3(0, 1.12, -0.38),
      length: 5.6, width: 2.0,
    },
  };
}
