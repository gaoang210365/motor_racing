// Arcade-tuned but physically-grounded single-track (bicycle) vehicle model:
// per-axle slip-angle tire forces with load from aero downforce, a rear
// friction-circle traction cap (acts like TC), speed-sensitive steering,
// surface grip multipliers and wall collision response.
import * as THREE from 'three';

const G = 9.81;
const CAR_RADIUS = 1.4; // effective collision disc radius for prop hits

export const CAR = {
  mass: 798,
  inertia: 1350,
  a: 1.98,          // CG -> front axle
  b: 1.62,          // CG -> rear axle
  power: 735000,    // W (~1000 hp)
  fMax: 15500,      // N launch force cap
  drag: 1.15,       // N per (m/s)^2
  rolling: 220,
  downforce: 3.15,  // N per (m/s)^2
  aeroBalance: 0.43,
  weightFront: 0.45,
  mu: 1.78,
  muBrake: 1.90,
  cornerStiff: 15.0,   // per rad, per N of load
  satSlip: 0.095,      // rad at grip peak
  steerMax: 0.40, steerMin: 0.062, steerFade: 0.0036,
  brakeForceMax: 42000,
  reverseMax: 8.5,     // m/s reverse speed cap (~30 km/h)
  reverseForce: 8200,  // N reverse thrust once stopped
};

export const GEARS = [
  { top: 28 }, { top: 39 }, { top: 50 }, { top: 61 },
  { top: 71 }, { top: 80 }, { top: 88 }, { top: 96 },
];

const SURFACES = {
  road: { mu: 1.0, drag: 0 },
  kerb: { mu: 0.94, drag: 60 },
  grass: { mu: 0.52, drag: 14 },   // drag scales with v
  gravel: { mu: 0.42, drag: 26 },
};

export class CarPhysics {
  constructor(track) {
    this.track = track;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vx = 0; this.vy = 0; this.yawRate = 0;
    this.steer = 0; this.steerTarget = 0;
    this.throttle = 0; this.brake = 0;
    this.gear = 1; this.rpm = 0.35;
    this.drsOpen = false; this.drsAvailable = false;
    this.surface = 'road';
    this.slipFront = 0; this.slipRear = 0;
    this.latG = 0; this.longG = 0;
    this.lastIdx = 0;
    this.info = null;
    this.wallHit = 0;       // impulse magnitude this step (for audio/fx)
    this.locked = true;     // brakes held before lights out
    this.wheelSpin = 0;     // rad/s for visual wheel rotation
    this.gearShiftT = 0;
    this.groundY = 0; this.groundPitch = 0; this.groundRoll = 0;
    this.reversing = false;   // true while actively backing up
    this.freeRoam = false;    // roam mode: soft boundaries + terrain follow
    this.groundYFn = null;     // (pos, sm, side, dist) => y, provided in roam
    this.world = null;         // open-world terrain provider (heightAt/normalAt/...)
  }

  // Drop the car onto the open-world terrain at (x,z), facing +heading.
  placeAtWorld(x, z, heading = 0) {
    this.pos.set(x, this.world ? this.world.heightAt(x, z) : 0, z);
    this.heading = heading;
    this.vx = this.vy = this.yawRate = 0;
    this.steer = this.steerTarget = 0;
    this.gear = 1; this.rpm = 0.35;
    this.groundY = this.pos.y;
    this.info = { _own: true, lat: 0, s: 0, frac: 0, idx: 0,
      t: this.forward(new THREE.Vector3()), n: new THREE.Vector3(1, 0, 0), dyds: 0 };
  }

  // track.query() reuses a shared scratch object — every car keeps its OWN
  // snapshot so multi-car sessions never read each other's data
  _snapshotInfo(q) {
    this.info = Object.assign(this.info && this.info._own ? this.info : { _own: true }, q);
    return this.info;
  }

  placeAt(frac, latOffset = 0) {
    const t = this.track;
    const s = ((frac % 1) + 1) % 1 * t.length;
    const smp = t.sampleAt(s);
    this.pos.copy(smp.p).addScaledVector(smp.n, latOffset);
    this.pos.y = smp.p.y;
    this.heading = Math.atan2(smp.t.x, smp.t.z);
    this.vx = this.vy = this.yawRate = 0;
    this.steer = this.steerTarget = 0;
    this.gear = 1; this.rpm = 0.35;
    this.lastIdx = smp.idx;
    this._snapshotInfo(this.track.query(this.pos, this.lastIdx));
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get speedKmh() { return this.speed * 3.6; }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  left(out = new THREE.Vector3()) { return out.set(Math.cos(this.heading), 0, -Math.sin(this.heading)); }

  step(dt, input) {
    // Open-world mode drives on a terrain heightfield instead of a track.
    // `q` is left as a lightweight stand-in; the track-specific reads below
    // (surface / slope / walls / ground) branch on `this.world`.
    let q;
    if (this.world) {
      q = this.info || (this.info = { _own: true });
      q.t = this.forward(_ft); q.dyds = 0; q.idx = 0; q.s = 0; q.frac = 0;
    } else {
      q = this._snapshotInfo(this.track.query(this.pos, this.lastIdx));
      this.lastIdx = q.idx;
    }
    this.wallHit = 0;

    // ---- surface ----
    let surface;
    if (this.world) {
      surface = this.world.surfaceAt(this.pos.x, this.pos.z);
    } else {
      const w2 = this.track.width / 2;
      const absLat = Math.abs(q.lat);
      surface = 'road';
      if (absLat > w2 - 0.1) {
        const kerb = q.lat > 0 ? q.kerbL : q.kerbR;
        if (kerb && absLat < w2 + 1.45) surface = 'kerb';
        else if (absLat > w2 + 0.15) surface = 'grass';
      }
    }
    this.surface = surface;
    const surf = SURFACES[surface];

    // ---- steering (speed sensitive, rate limited) ----
    const v = Math.max(this.vx, 0);
    const maxSteer = THREE.MathUtils.clamp(CAR.steerMax - v * CAR.steerFade, CAR.steerMin, CAR.steerMax);
    this.steerTarget = input.steer * maxSteer;
    const rate = (Math.sign(this.steerTarget - this.steer) === -Math.sign(this.steer) ? 5.2 : 3.1) * maxSteer / CAR.steerMax * 2.6;
    const dS = THREE.MathUtils.clamp(this.steerTarget - this.steer, -rate * dt, rate * dt);
    this.steer += dS;

    this.throttle = this.locked ? 0 : input.throttle;
    this.brake = this.locked ? 1 : input.brake;

    // ---- loads ----
    const spd = this.speed;
    const df = CAR.downforce * spd * spd * (this.drsOpen ? 0.78 : 1);
    const Nf = (CAR.mass * G * CAR.weightFront + df * CAR.aeroBalance);
    const Nr = (CAR.mass * G * (1 - CAR.weightFront) + df * (1 - CAR.aeroBalance));
    const muF = CAR.mu * surf.mu, muR = CAR.mu * surf.mu;

    // ---- tire lateral forces (bicycle model) ----
    let FyF = 0, FyR = 0;
    const vxSafe = Math.max(Math.abs(this.vx), 1.2);
    const slipF = Math.atan2(this.vy + CAR.a * this.yawRate, vxSafe) - this.steer * Math.sign(this.vx >= 0 ? 1 : -1);
    const slipR = Math.atan2(this.vy - CAR.b * this.yawRate, vxSafe);
    this.slipFront = slipF; this.slipRear = slipR;
    const tire = (slip, N, mu) => {
      const peak = mu * N;
      const lin = CAR.cornerStiff * N * slip;
      const abs = Math.abs(lin);
      if (abs <= peak * 0.92) return -lin;
      // progressive saturation past the peak
      const over = Math.min((Math.abs(slip) - CAR.satSlip) / CAR.satSlip, 2.2);
      const f = over <= 0 ? 0.96 : Math.max(0.80, 0.96 - over * 0.09);
      return -Math.sign(slip) * peak * f;
    };
    FyF = tire(slipF, Nf, muF);
    FyR = tire(slipR, Nr, muR);

    // ---- longitudinal ----
    const gearTop = GEARS[this.gear - 1].top;
    const gearLow = this.gear > 1 ? GEARS[this.gear - 2].top : 0;
    if (this.vx > gearTop - 1 && this.gear < GEARS.length) { this.gear++; this.gearShiftT = 0.10; }
    else if (this.vx < gearLow - 3 && this.gear > 1) { this.gear--; this.gearShiftT = 0.07; }
    const span = gearTop - (this.gear > 1 ? GEARS[this.gear - 2].top : 0);
    this.rpm = THREE.MathUtils.clamp(0.34 + 0.64 * (1 - Math.max(0, gearTop - this.vx) / Math.max(span, 1)), 0.3, 1);
    if (this.gearShiftT > 0) this.gearShiftT -= dt;

    let Fdrive = 0;
    if (this.throttle > 0) {
      const cut = this.gearShiftT > 0 ? 0.25 : 1;
      Fdrive = Math.min(CAR.power / Math.max(this.vx, 6), CAR.fMax) * this.throttle * cut;
      // rear friction circle: cap drive by remaining rear grip (TC feel)
      const capSq = Math.max(0, (muR * Nr) ** 2 - (0.92 * FyR) ** 2);
      Fdrive = Math.min(Fdrive, Math.sqrt(capSq));
    }
    // ---- brake / reverse ----
    // `Fbrake` is a force acting in the -x (rearward) body direction, so it's
    // subtracted in the integrator below. Positive => pushes the car backward.
    //   • rolling forward + S  -> positive brake force (decelerate)
    //   • stopped/reversing + S -> positive reverse thrust, capped at a slow
    //     speed so it stays a parking/maneuver aid, not a second forward gear
    //   • coasting backward, S released -> negative (drag brake toward 0)
    let Fbrake = 0;
    this.reversing = false;
    const wantReverse = this.brake > 0 && this.throttle === 0 && !this.locked;
    if (this.vx > 0.4) {
      if (this.brake > 0) {
        const cap = CAR.muBrake * surf.mu * (Nf + Nr);
        Fbrake = Math.min(CAR.brakeForceMax * this.brake, cap);   // decelerate
      }
    } else if (wantReverse) {
      if (this.vx > -CAR.reverseMax) {
        Fbrake = CAR.reverseForce * this.brake * surf.mu;         // reverse thrust
        this.reversing = true;
      } else {
        this.reversing = true;                                     // hold at cap: coast
      }
    } else if (this.vx < -0.05) {
      // backing up with S released -> gentle drag brake brings it to rest
      Fbrake = -CAR.rolling * 1.2;
    }
    const dragF = (CAR.drag * (this.drsOpen ? 0.82 : 1)) * this.vx * Math.abs(this.vx)
      + CAR.rolling * Math.sign(this.vx)
      + surf.drag * this.vx * (surface === 'road' ? 0 : 1);
    const fwd = this.forward(_f);
    let slopeF;
    if (this.world) {
      // grade along travel from the terrain normal: dy/dfwd = -(n·fwd_h)/n.y.
      // positive grade (uphill) => positive slopeF => resists in the integrator
      const n = this.world.normalAt(this.pos.x, this.pos.z, _wn);
      const grade = -(fwd.x * n.x + fwd.z * n.z) / Math.max(n.y, 0.2);
      slopeF = CAR.mass * G * THREE.MathUtils.clamp(grade, -0.7, 0.7);
    } else {
      slopeF = CAR.mass * G * fwd.dot(q.t) * q.dyds; // uphill resists
    }

    // ---- integrate (body frame) ----
    const ax = (Fdrive - Fbrake - dragF - slopeF - FyF * Math.sin(this.steer)) / CAR.mass + this.vy * this.yawRate;
    const ay = (FyF * Math.cos(this.steer) + FyR) / CAR.mass - this.vx * this.yawRate;
    const rDot = (CAR.a * FyF * Math.cos(this.steer) - CAR.b * FyR) / CAR.inertia;

    this.latG = ay / G + this.vx * this.yawRate / G;
    this.longG = (Fdrive - Fbrake - dragF) / CAR.mass / G;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.yawRate += rDot * dt;

    // low-speed kinematic blend (stability at crawl)
    const blend = THREE.MathUtils.clamp((this.speed - 1.5) / 4.5, 0, 1);
    if (blend < 1) {
      const kinYaw = this.vx / (CAR.a + CAR.b) * Math.tan(this.steer);
      this.yawRate = THREE.MathUtils.lerp(kinYaw, this.yawRate, blend);
      this.vy = THREE.MathUtils.lerp(0, this.vy, blend);
    }
    // snap to a dead stop only when locked (pre-race) or fully coasting —
    // never while reverse is being requested, so S can back the car up
    if (this.locked || (this.throttle === 0 && this.brake === 0 && Math.abs(this.vx) < 0.25)) {
      if (Math.abs(this.vx) < 0.25) { this.vx = 0; this.vy *= 0.5; }
    }

    this.heading += this.yawRate * dt;

    const F = this.forward(_f), Lf = this.left(_l);
    this.pos.addScaledVector(F, this.vx * dt).addScaledVector(Lf, this.vy * dt);

    // ---- boundaries + ground follow ----
    let q2;
    if (this.world) {
      this._worldBounds();
      this._worldCollide();
      // sit on the terrain and pitch/roll to its normal
      const gy = this.world.heightAt(this.pos.x, this.pos.z);
      this.groundY = THREE.MathUtils.damp(this.groundY, gy, 22, dt);
      this.pos.y = this.groundY;
      const n = this.world.normalAt(this.pos.x, this.pos.z, _wn);
      const Lf2 = this.left(_l);
      this.groundPitch = -Math.atan2(F.x * n.x + F.z * n.z, Math.max(n.y, 0.2));
      this.groundRoll = Math.atan2(Lf2.x * n.x + Lf2.z * n.z, Math.max(n.y, 0.2));
      q2 = q;
    } else {
      // ---- walls ----
      q2 = this.track.query(this.pos, this.lastIdx);
      this.lastIdx = q2.idx;
      if (this.freeRoam) {
        this._roamBounds(q2);
      } else {
        const margin = 0.95;
        for (const side of [1, -1]) {
          const wall = side > 0 ? q2.wallL : q2.wallR;
          const lat = q2.lat * side;
          if (lat > wall - margin) {
            this.pos.addScaledVector(q2.n, -(lat - (wall - margin)) * side);
            const vWorld = _v.copy(F).multiplyScalar(this.vx).addScaledVector(Lf, this.vy);
            const vn = vWorld.dot(q2.n) * side;
            if (vn > 0) {
              this.wallHit = Math.max(this.wallHit, vn);
              vWorld.addScaledVector(q2.n, -vn * 1.3 * side);
              vWorld.multiplyScalar(Math.max(0.86, 1 - vn * 0.012));
              this.vx = vWorld.dot(F);
              this.vy = vWorld.dot(Lf);
              // scrub some yaw so the car doesn't pinball
              this.yawRate *= 0.6;
            }
          }
        }
      }

      // ---- ground follow ----
      // On track (or non-roam) the road is laterally flat -> use q.y. In roam
      // mode, off the road, follow the actual terrain surface.
      const onRoad2 = Math.abs(q2.lat) <= this.track.width / 2 + 0.1;
      if (this.freeRoam && this.groundYFn && !onRoad2) {
        const gy = this.groundYFn(q2);
        this.groundY = THREE.MathUtils.damp(this.groundY, gy, 18, dt);
      } else {
        this.groundY = q2.y; // road is laterally flat
      }
      this.pos.y = this.groundY;
      this.groundPitch = Math.atan(F.dot(q2.t) * q2.dyds);
      this.groundRoll = 0;
    }

    this.wheelSpin = this.vx / 0.35;
    return q2;
  }

  // Prop collision: the car is a disc; on overlap with a tree/rock/building
  // collider it's pushed out along the contact normal and the inbound speed
  // is killed (a hard stop against solid objects). Records wallHit for fx.
  _worldCollide() {
    const hit = this.world.collide(this.pos.x, this.pos.z, CAR_RADIUS);
    if (!hit) return;
    // push the car out of the object
    this.pos.x += hit.nx * hit.pen;
    this.pos.z += hit.nz * hit.pen;
    const F = this.forward(_f), Lf = this.left(_l);
    const vWorld = _v.copy(F).multiplyScalar(this.vx).addScaledVector(Lf, this.vy);
    const vn = vWorld.x * hit.nx + vWorld.z * hit.nz; // speed along contact normal
    if (vn < 0) {
      // moving into the object: remove the inbound component + a chunk of the
      // tangential slide, so a head-on hit stops the car dead
      this.wallHit = Math.max(this.wallHit, -vn);
      vWorld.x -= hit.nx * vn; vWorld.z -= hit.nz * vn;
      vWorld.multiplyScalar(0.35);       // scrub most of the remaining slide
      this.vx = vWorld.dot(F);
      this.vy = vWorld.dot(Lf);
      this.yawRate *= 0.4;
    }
  }

  // Open-world soft boundary: a large circular arena. Near the edge we push
  // the car back in and cancel outward velocity so it can't leave the mesh.
  _worldBounds() {
    const b = this.world.bounds;
    const dx = this.pos.x - b.cx, dz = this.pos.z - b.cz;
    const r = Math.hypot(dx, dz);
    if (r > b.radius) {
      const nx = dx / (r || 1), nz = dz / (r || 1);
      const over = r - b.radius;
      this.pos.x -= nx * over; this.pos.z -= nz * over;
      const F = this.forward(_f), Lf = this.left(_l);
      const vWorld = _v.copy(F).multiplyScalar(this.vx).addScaledVector(Lf, this.vy);
      const vn = vWorld.x * nx + vWorld.z * nz;
      if (vn > 0) {
        vWorld.x -= nx * vn; vWorld.z -= nz * vn;
        vWorld.multiplyScalar(0.7);
        this.vx = vWorld.dot(F); this.vy = vWorld.dot(Lf);
        this.yawRate *= 0.7;
      }
    }
  }

  // Roam mode boundary: no hard armco. The player can drive across the
  // runoff/infield freely; only at the outer edge of the well-defined
  // ground band do we softly push back (and kill outward velocity) so the
  // car never wanders into un-rendered far terrain or figure-8 gaps.
  _roamBounds(q) {
    const sm = this.track.samples[q.idx];
    const side = q.lat >= 0 ? 1 : -1;
    const wall = side > 0 ? sm.wallL : sm.wallR;
    // stay within the visible sweep band: wall + apron width, minus a margin.
    // pinched sections (skipApron / narrow apronW) clamp much tighter.
    const apron = this.track.skipApron[sm.idx] ? 0.2
      : Math.min(sm.apronW ?? 6, this.track.cfg.apron);
    const limit = wall + apron - 1.4;
    const lat = q.lat * side;
    if (lat > limit) {
      const over = lat - limit;
      this.pos.addScaledVector(q.n, -over * side);
      const F = this.forward(_f), Lf = this.left(_l);
      const vWorld = _v.copy(F).multiplyScalar(this.vx).addScaledVector(Lf, this.vy);
      const vn = vWorld.dot(q.n) * side;
      if (vn > 0) {
        vWorld.addScaledVector(q.n, -vn * side); // remove outward component
        vWorld.multiplyScalar(0.72);
        this.vx = vWorld.dot(F);
        this.vy = vWorld.dot(Lf);
      }
    }
  }
}

const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _v = new THREE.Vector3();
const _ft = new THREE.Vector3(), _wn = new THREE.Vector3();
