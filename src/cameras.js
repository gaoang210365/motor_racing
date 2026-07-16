// Camera rig with three modes: third-person chase cam, first-person cockpit
// (halo visible), and the classic F1 T-cam. Smooth damping, speed-based FOV,
// cockpit shake and look-ahead along the racing line.
import * as THREE from 'three';

const damp = (cur, target, lambda, dt) => THREE.MathUtils.damp(cur, target, lambda, dt);

export const CAMERA_MODES = [
  { id: 'chase', label: '第三人称 · 追尾' },
  { id: 'cockpit', label: '第一人称 · 座舱' },
  { id: 'tcam', label: '车载 T-Cam' },
  { id: 'tv', label: '观战 · TV 机位' },
];

export class CameraRig {
  constructor(camera, car, physics, track) {
    this.camera = camera;
    this.car = car;
    this.physics = physics;
    this.track = track;
    this.modeIdx = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 62;
    this.shakeT = 0;
    this.buildTvPods();
    this.podIdx = 0;
    this.snap();
  }

  get mode() { return CAMERA_MODES[this.modeIdx].id; }

  cycle() {
    this.modeIdx = (this.modeIdx + 1) % CAMERA_MODES.length;
    this.snap();
    return CAMERA_MODES[this.modeIdx];
  }

  setMode(id) {
    const i = CAMERA_MODES.findIndex(m => m.id === id);
    if (i >= 0) { this.modeIdx = i; this.snap(); }
    return CAMERA_MODES[this.modeIdx];
  }

  buildTvPods() {
    this.pods = tvPodSpots(this.track);
  }

  snap() {
    const p = this.physics;
    const F = p.forward(_f);
    if (this.mode === 'tv' && this.pods && this.pods.length) {
      const L = this.track.length;
      const s = p.info ? p.info.s : 0;
      let best = 0, bestAhead = Infinity;
      for (let i = 0; i < this.pods.length; i++) {
        const ahead = ((this.pods[i].s - s) % L + L) % L;
        if (ahead < bestAhead) { bestAhead = ahead; best = i; }
      }
      this.podIdx = best;
      this.pos.copy(this.pods[best].p);
      this.look.copy(p.pos);
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.look);
      return;
    }
    if (this.mode === 'chase') {
      this.pos.copy(p.pos).addScaledVector(F, -7.2).add(_u.set(0, 3.0, 0));
    } else {
      this.pos.copy(p.pos).add(_u.set(0, 1.2, 0));
    }
    this.look.copy(p.pos).addScaledVector(F, 10);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt) {
    const p = this.physics;
    const spd = p.speed;
    const t = THREE.MathUtils.clamp(spd / 90, 0, 1);
    const F = p.forward(_f);
    const L = p.left(_l);
    this.shakeT += dt * (14 + spd * 0.5);
    const mode = this.mode;

    if (mode === 'tv') {
      // hold the current pod while the car is in its window, else hand off
      // to the pod the car is approaching
      const L = this.track.length;
      const s = p.info ? p.info.s : 0;
      const pod = this.pods[this.podIdx];
      const rel = pod ? ((s - pod.s) % L + L) % L : 0;
      if (!pod || (rel > 300 && rel < L - 90)) {
        let best = 0, bestAhead = Infinity;
        for (let i = 0; i < this.pods.length; i++) {
          const ahead = ((this.pods[i].s - s) % L + L) % L;
          if (ahead < bestAhead) { bestAhead = ahead; best = i; }
        }
        this.podIdx = best;
      }
      const P = this.pods[this.podIdx].p;
      this.pos.copy(P);
      const lam = 9;
      _lookT.copy(p.pos).add(_u.set(0, 0.75, 0)).addScaledVector(F, spd * 0.05);
      this.look.x = damp(this.look.x, _lookT.x, lam, dt);
      this.look.y = damp(this.look.y, _lookT.y, lam, dt);
      this.look.z = damp(this.look.z, _lookT.z, lam, dt);
      const dist = this.pos.distanceTo(p.pos);
      this.fov = damp(this.fov, THREE.MathUtils.clamp(2600 / Math.max(dist, 8), 15, 52), 5, dt);
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.look);
      if (Math.abs(this.camera.fov - this.fov) > 0.05) {
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    if (mode === 'chase') {
      // pull back with speed, swing slightly with yaw for drift readability
      const back = 6.1 + t * 2.3;
      const up = 2.35 + t * 0.55;
      const lateral = THREE.MathUtils.clamp(-p.yawRate * 0.9 - p.slipRear * 1.4, -1.6, 1.6);
      _target.copy(p.pos).addScaledVector(F, -back).addScaledVector(L, lateral * 0.55).add(_u.set(0, up, 0));
      const lam = 7.5;
      this.pos.x = damp(this.pos.x, _target.x, lam, dt);
      this.pos.y = damp(this.pos.y, _target.y, lam * 1.25, dt);
      this.pos.z = damp(this.pos.z, _target.z, lam, dt);
      _lookT.copy(p.pos).addScaledVector(F, 6.5).add(_u.set(0, 1.0, 0));
      const lam2 = 11;
      this.look.x = damp(this.look.x, _lookT.x, lam2, dt);
      this.look.y = damp(this.look.y, _lookT.y, lam2, dt);
      this.look.z = damp(this.look.z, _lookT.z, lam2, dt);
      this.fov = damp(this.fov, 60 + t * 15 + (p.drsOpen ? 2 : 0), 4, dt);
      this.camera.up.set(0, 1, 0);
    } else {
      // cockpit / t-cam: rigid mount + subtle shake
      const off = mode === 'cockpit' ? this.car.dims.eye : this.car.dims.tcam;
      _target.copy(p.pos)
        .addScaledVector(F, off.z)
        .addScaledVector(L, off.x)
        .add(_u.set(0, off.y - p.groundPitch * (mode === 'cockpit' ? 0.3 : 0.2), 0));
      const shake = (mode === 'cockpit' ? 0.014 : 0.010) * t * t;
      _target.addScaledVector(L, Math.sin(this.shakeT * 1.9) * shake)
        .add(_u.set(0, Math.sin(this.shakeT * 2.7 + 1.3) * shake * 0.8, 0));
      this.pos.copy(_target);
      // look ahead along the track for natural cornering view
      const ahead = 16 + spd * 0.32;
      const q = p.info;
      if (q) {
        const sm = this.track.sampleAt(q.s + ahead);
        _lookT.copy(sm.p).add(_u.set(0, mode === 'cockpit' ? 0.75 : 0.9, 0));
        // blend between straight-ahead and track look-ahead
        _lookS.copy(_target).addScaledVector(F, ahead).add(_u.set(0, -p.groundPitch * ahead * 0.5, 0));
        _lookT.lerp(_lookS, 0.42);
      } else {
        _lookT.copy(_target).addScaledVector(F, ahead);
      }
      const lam2 = 13;
      this.look.x = damp(this.look.x, _lookT.x, lam2, dt);
      this.look.y = damp(this.look.y, _lookT.y, lam2, dt);
      this.look.z = damp(this.look.z, _lookT.z, lam2, dt);
      this.fov = damp(this.fov, (mode === 'cockpit' ? 71 : 60) + t * 9, 5, dt);
      // subtle horizon roll with lateral G
      this.camera.up.set(Math.sin(-p.latG * 0.05) * (mode === 'cockpit' ? 1 : 0.5), 1, 0).normalize();
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();
const _target = new THREE.Vector3(), _lookT = new THREE.Vector3(), _lookS = new THREE.Vector3();

// Trackside broadcast pod positions — a pure function of the track so the
// environment builder can consult the same spots and keep their sight lines
// clear of foliage. Pods stand on the INSIDE of upcoming corners (stands and
// most scenery are outside) on masts taller than the tallest tree canopy.
export function tvPodSpots(track) {
  const spots = [];
  const L = track.length;
  const step = 270;
  let k = 0;
  for (let s = 0; s < L - step * 0.5; s += step, k++) {
    const at = track.placeAt(s / L, 0);
    const bend = track.sampleAt(s + 70);
    const isBend = Math.abs(bend.kappa) > 0.004;
    const side = isBend ? Math.sign(bend.kappa) : (k % 2 ? 1 : -1);
    const wall = side > 0 ? at.sm.wallL : at.sm.wallR;
    const p = at.p.clone().addScaledVector(at.n, side * (wall + 4.5));
    p.y = at.p.y + (isBend ? 13.5 + (k % 3) * 1.2 : 16.0 + (k % 2) * 1.6);
    spots.push({ p, s });
  }
  return spots;
}
