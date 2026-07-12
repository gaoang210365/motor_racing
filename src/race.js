// Race session: F1 start-light sequence, lap timing with checkpoints,
// best-lap persistence, wrong-way detection, DRS management and a
// pure-pursuit autopilot (demo mode / testing harness).
import * as THREE from 'three';
import { CAR } from './physics.js';

export class Race {
  constructor(track, physics, hud, audio) {
    this.track = track;
    this.physics = physics;
    this.hud = hud;
    this.audio = audio;
    this.state = 'idle'; // idle | countdown | racing
    this.raceTime = 0;
    this.lapStart = 0;
    this.lapCount = 1;
    this.lastLapMs = null;
    this.bestLapMs = this.loadBest();
    this.currentLapMs = 0;
    this.cp = [false, false];
    this.prevFrac = 0;
    this.wrongWay = false;
    this._wrongT = 0;
    this.autopilotActive = false;
    this._timers = [];
  }

  storageKey() { return `voxelf1-best-${this.track.cfg.id}`; }
  loadBest() {
    const v = Number(localStorage.getItem(this.storageKey()));
    return v > 0 ? v : null;
  }

  start() {
    this.state = 'countdown';
    this.physics.locked = true;
    this.hud.show('lights', true);
    this.hud.lights(0);
    let delay = 700;
    for (let i = 1; i <= 5; i++) {
      this._timers.push(setTimeout(() => { this.hud.lights(i); this.audio.lightOn(); }, delay));
      delay += 860;
    }
    delay += 500 + Math.random() * 900;
    this._timers.push(setTimeout(() => {
      this.hud.lightsOut();
      this.audio.lightsOut();
      this.hud.message('灯灭起跑！<span class="en">LIGHTS OUT!</span>', 1800, 'go');
      this.physics.locked = false;
      this.state = 'racing';
      this.raceTime = 0;
      this.lapStart = 0;
      this.prevFrac = this.physics.info ? this.physics.info.frac : 0;
    }, delay));
  }

  cancelTimers() { this._timers.forEach(clearTimeout); this._timers = []; }

  update(dt, input) {
    const p = this.physics;
    if (this.state !== 'racing') return;
    this.raceTime += dt * 1000;
    this.currentLapMs = this.raceTime - this.lapStart;

    const q = p.info;
    if (!q) return;
    const frac = q.frac;

    // checkpoints + lap detection
    if (frac > 0.30 && frac < 0.40) this.cp[0] = true;
    if (frac > 0.62 && frac < 0.72) this.cp[1] = true;
    if (this.prevFrac > 0.90 && frac < 0.10) {
      if (this.cp[0] && this.cp[1]) {
        const lapMs = this.raceTime - this.lapStart;
        this.lastLapMs = lapMs;
        const isBest = !this.bestLapMs || lapMs < this.bestLapMs;
        if (isBest) {
          this.bestLapMs = lapMs;
          localStorage.setItem(this.storageKey(), String(Math.round(lapMs)));
        }
        this.audio.lapDone(isBest);
        this.hud.message(
          `${isBest ? '<span class="best">🏁 个人最快圈！</span>' : '🏁 完成一圈'}<br><b>${msFmt(lapMs)}</b>`,
          2600, isBest ? 'purple' : ''
        );
        this.lapCount++;
        console.log(`[LAP] ${this.track.cfg.id} lap=${this.lapCount - 1} time=${msFmt(lapMs)} best=${isBest}`);
      }
      this.lapStart = this.raceTime;
      this.cp = [false, false];
    }
    this.prevFrac = frac;

    // wrong way
    const F = p.forward(_f);
    const along = F.dot(q.t) * Math.sign(p.vx >= -0.5 ? 1 : 1);
    if (p.speed > 4 && along < -0.2) this._wrongT += dt; else this._wrongT = 0;
    this.wrongWay = this._wrongT > 1.1;

    // DRS
    p.drsAvailable = this.track.inDrsZone(frac) && p.speed > 28;
    if (p.drsAvailable && input.throttle > 0.85 && input.brake < 0.05) p.drsOpen = true;
    if (!p.drsAvailable || input.brake > 0.15) p.drsOpen = false;
  }

  reset() {
    const p = this.physics;
    const frac = p.info ? p.info.frac : 0;
    p.placeAt(frac, 0);
    p.drsOpen = false;
    this.cp = [false, false];
    this.prevFrac = p.info.frac;
    this.lapStart = this.raceTime; // resetting voids the lap
    this.hud.message('已重置到赛道 · 本圈作废', 1500);
  }

  // ---- autopilot (pure pursuit + precomputed speed profile) ----
  autopilot(dt) {
    const p = this.physics;
    const q = p.info;
    if (!q || this.state !== 'racing') return { steer: 0, throttle: 0, brake: 0 };
    const v = Math.max(p.speed, 1);
    const La = 6.5 + v * 0.42;
    const target = this.track.sampleAt(q.s + La);
    const F = p.forward(_f);
    _dir.subVectors(target.p, p.pos); _dir.y = 0;
    const dist = _dir.length() || 1;
    _dir.divideScalar(dist);
    const cross = F.z * _dir.x - F.x * _dir.z; // + = target to the left
    const dot = THREE.MathUtils.clamp(F.dot(_dir), -1, 1);
    const alpha = Math.atan2(cross, dot);
    const delta = Math.atan2(2 * (CAR.a + CAR.b) * Math.sin(alpha), dist);
    const maxSteer = THREE.MathUtils.clamp(CAR.steerMax - Math.max(p.vx, 0) * CAR.steerFade, CAR.steerMin, CAR.steerMax);
    const steer = THREE.MathUtils.clamp(delta / maxSteer, -1, 1);

    // speed control from the precomputed profile slightly ahead
    const vAllow = Math.min(q.vT, this.track.sampleAt(q.s + v * 0.25).vT) * 0.985;
    let throttle = 0, brake = 0;
    if (v > vAllow + 0.6) brake = THREE.MathUtils.clamp((v - vAllow) * 0.30, 0.15, 1);
    else throttle = THREE.MathUtils.clamp((vAllow - v) * 0.55 + 0.35, 0, 1);
    // ease off throttle while steering hard
    throttle *= 1 - Math.min(Math.abs(steer) * 0.30, 0.4);
    return { steer, throttle, brake };
  }
}

function msFmt(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), mil = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

const _f = new THREE.Vector3(), _dir = new THREE.Vector3();
