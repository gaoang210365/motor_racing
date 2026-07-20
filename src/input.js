// Keyboard (WASD + arrows) and optional gamepad input with smoothed
// digital-steer so keyboard driving still feels analog.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;          // -1..1 (+ = left)
    this.throttle = 0;
    this.brake = 0;
    this.events = [];        // one-shot: 'camera' | 'reset' | 'pause' | 'mute' | 'autopilot'
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'c' || k === 'v') this.events.push('camera');
      if (k === 'r') this.events.push('reset');
      if (k === 'escape') this.events.push('pause');
      if (k === 'm') this.events.push('mute');
      if (k === 'p') this.events.push('autopilot');
      if (k === 'f') this.events.push('enter'); // enter/exit car (open world)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // ---- mouse-look (pointer lock) for on-foot FPS control ----
    this.mouseDX = 0; this.mouseDY = 0;
    this.pointerLocked = false;
    window.addEventListener('mousemove', e => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement != null;
      if (!this.pointerLocked) this.events.push('pointerunlock');
    });
  }

  lockPointer() {
    const el = document.getElementById('app') || document.body;
    if (el.requestPointerLock) el.requestPointerLock();
  }
  unlockPointer() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  // consume accumulated mouse delta since last call
  takeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  takeEvents() { const ev = this.events; this.events = []; return ev; }

  // raw digital movement axes for the on-foot walker (W/S = fwd, A/D = strafe)
  footAxes() {
    const k = this.keys;
    let fwd = 0, strafe = 0;
    if (k.has('w') || k.has('arrowup')) fwd += 1;
    if (k.has('s') || k.has('arrowdown')) fwd -= 1;
    if (k.has('a') || k.has('arrowleft')) strafe -= 1;
    if (k.has('d') || k.has('arrowright')) strafe += 1;
    const run = k.has('shift');
    return { fwd, strafe, run };
  }

  update(dt) {
    const k = this.keys;
    let sTarget = 0;
    if (k.has('a') || k.has('arrowleft')) sTarget += 1;
    if (k.has('d') || k.has('arrowright')) sTarget -= 1;
    let th = (k.has('w') || k.has('arrowup')) ? 1 : 0;
    let br = (k.has('s') || k.has('arrowdown') || k.has(' ')) ? 1 : 0;

    // gamepad overrides when active
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      if (Math.abs(ax) > 0.09) sTarget = -Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.09) / 0.85);
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.04) th = rt;
      if (lt > 0.04) br = lt;
      if (gp.buttons[0]?.pressed && !this._padA) this.events.push('camera');
      this._padA = !!gp.buttons[0]?.pressed;
      if (gp.buttons[3]?.pressed && !this._padY) this.events.push('reset');
      this._padY = !!gp.buttons[3]?.pressed;
      break;
    }

    // smooth digital steering: fast attack, faster centering
    const attack = 3.4, release = 5.2;
    if (sTarget !== 0 && Math.sign(sTarget) !== Math.sign(this.steer) && this.steer !== 0) {
      this.steer += sTarget * (attack + release) * dt;
    } else if (sTarget !== 0) {
      this.steer += Math.sign(sTarget - this.steer) * attack * dt;
      if (Math.abs(this.steer) > Math.abs(sTarget)) this.steer = sTarget;
    } else {
      const dec = release * dt;
      this.steer = Math.abs(this.steer) <= dec ? 0 : this.steer - Math.sign(this.steer) * dec;
    }
    this.steer = Math.max(-1, Math.min(1, this.steer));
    this.throttle += Math.sign(th - this.throttle) * Math.min(Math.abs(th - this.throttle), 6 * dt);
    this.brake += Math.sign(br - this.brake) * Math.min(Math.abs(br - this.brake), 9 * dt);
  }
}
