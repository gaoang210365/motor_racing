// F1-broadcast-style HUD: speed/gear/RPM dash, lap timer board, corner
// callouts, DRS badge, start lights overlay, minimap with live car dot.
export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const mil = Math.floor(t % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

export function drawTrackMap(ctx, pts, w, h, rot = 0, opts = {}) {
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const rp = pts.map(([x, z]) => [x * cosR - z * sinR, x * sinR + z * cosR]);
  const xs = rp.map(p => p[0]), zs = rp.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const minz = Math.min(...zs), maxz = Math.max(...zs);
  const pad = opts.pad ?? 16;
  const scale = Math.min((w - pad * 2) / (maxx - minx || 1), (h - pad * 2) / (maxz - minz || 1));
  const ox = (w - (maxx - minx) * scale) / 2 - minx * scale;
  const oz = (h - (maxz - minz) * scale) / 2 - minz * scale;
  const map = (x, z) => [ox + (x * cosR - z * sinR) * scale, oz + (x * sinR + z * cosR) * scale];

  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  rp.forEach(([x, z], i) => {
    const px = ox + x * scale, pz = oz + z * scale;
    i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz);
  });
  ctx.closePath();
  if (opts.glow !== false) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = opts.width ? opts.width + 4 : 9;
    ctx.stroke();
  }
  ctx.strokeStyle = opts.color || '#f2f4f8';
  ctx.lineWidth = opts.width || 5;
  ctx.stroke();
  // start line tick
  const [sx, sz] = map(pts[0][0], pts[0][1]);
  ctx.fillStyle = opts.startColor || '#e10600';
  ctx.beginPath(); ctx.arc(sx, sz, opts.width ? opts.width * 0.9 : 4.5, 0, 7); ctx.fill();
  return map;
}

export class Hud {
  constructor() {
    const $ = id => document.getElementById(id);
    this.el = {
      hud: $('hud'), menu: $('menu'), pause: $('pause'), loading: $('loading'),
      speed: $('hud-speed'), gear: $('hud-gear'), rpmFill: $('hud-rpm-fill'),
      drs: $('hud-drs'), time: $('hud-time'), last: $('hud-last'), best: $('hud-best'),
      lap: $('hud-lap'), trackName: $('hud-track-name'), corner: $('hud-corner'),
      camLabel: $('hud-camera-label'), minimap: $('minimap'),
      lights: $('lights'), msg: $('center-msg'), wrongway: $('wrongway'),
      autopilot: $('hud-autopilot'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.mapFn = null;
    this.msgTimer = null;
    this.cornerShown = null;
    this._lastVals = {};
  }

  show(id, on) { this.el[id].classList.toggle('hidden', !on); }

  setTrack(cfg, track) {
    this.el.trackName.innerHTML = `${cfg.flag} <b>${cfg.name}</b> · ${cfg.fullName}`;
    this.track = track;
    this.cfg = cfg;
    this.redrawMap();
  }

  redrawMap() {
    const cv = this.el.minimap;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = cv.width; this.mapBase.height = cv.height;
    const bctx = this.mapBase.getContext('2d');
    this.mapFn = drawTrackMap(bctx, this.track.minimap, cv.width, cv.height, this.cfg.minimapRot, { width: 4.5 });
  }

  update(state) {
    const { physics: p, race } = state;
    const kmh = Math.round(p.speedKmh);
    if (this._lastVals.kmh !== kmh) { this.el.speed.textContent = kmh; this._lastVals.kmh = kmh; }
    if (this._lastVals.gear !== p.gear) { this.el.gear.textContent = p.gear; this._lastVals.gear = p.gear; }
    this.el.rpmFill.style.width = `${Math.round(p.rpm * 100)}%`;
    this.el.rpmFill.classList.toggle('redline', p.rpm > 0.94);

    const drsState = p.drsOpen ? 'on' : (p.drsAvailable ? 'armed' : 'off');
    if (this._lastVals.drs !== drsState) {
      this.el.drs.className = `drs-${drsState}`;
      this._lastVals.drs = drsState;
    }

    this.el.time.textContent = formatTime(race.currentLapMs);
    if (this._lastVals.lap !== race.lapCount) { this.el.lap.textContent = race.lapCount; this._lastVals.lap = race.lapCount; }
    if (this._lastVals.last !== race.lastLapMs) { this.el.last.textContent = formatTime(race.lastLapMs); this._lastVals.last = race.lastLapMs; }
    if (this._lastVals.best !== race.bestLapMs) { this.el.best.textContent = formatTime(race.bestLapMs); this._lastVals.best = race.bestLapMs; }

    // corner callout
    const frac = p.info ? p.info.frac : 0;
    let corner = null;
    for (const c of this.cfg.corners) {
      const d = ((frac - c.f) % 1 + 1) % 1;
      if (d < 0.017 || d > 0.997) { corner = c; break; }
      const before = ((c.f - frac) % 1 + 1) % 1;
      if (before < 0.012) { corner = c; break; }
    }
    if (corner !== this.cornerShown) {
      this.cornerShown = corner;
      if (corner) {
        this.el.corner.innerHTML = `<span class="corner-cn">${corner.cn}</span><span class="corner-en">${corner.n}</span>`;
        this.el.corner.classList.add('visible');
      } else {
        this.el.corner.classList.remove('visible');
      }
    }

    this.show('wrongway', race.wrongWay);
    this.el.autopilot.classList.toggle('hidden', !race.autopilotActive);

    // minimap
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.el.minimap.width, this.el.minimap.height);
    ctx.drawImage(this.mapBase, 0, 0);
    if (this.mapFn) {
      const [cx, cz] = this.mapFn(p.pos.x, p.pos.z);
      ctx.fillStyle = '#ffd21e';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cz, 5, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  setCameraLabel(label) {
    this.el.camLabel.textContent = label;
    this.el.camLabel.classList.add('visible');
    clearTimeout(this._camT);
    this._camT = setTimeout(() => this.el.camLabel.classList.remove('visible'), 1600);
  }

  lights(n) { // 0..5 columns lit
    const cols = this.el.lights.querySelectorAll('.light-col');
    cols.forEach((c, i) => c.classList.toggle('on', i < n));
  }

  lightsOut() {
    this.el.lights.querySelectorAll('.light-col').forEach(c => c.classList.remove('on'));
    setTimeout(() => this.show('lights', false), 900);
  }

  message(html, dur = 2200, cls = '') {
    const el = this.el.msg;
    el.innerHTML = html;
    el.className = `visible ${cls}`;
    clearTimeout(this.msgTimer);
    if (dur > 0) this.msgTimer = setTimeout(() => { el.className = 'hidden'; }, dur);
  }
}
