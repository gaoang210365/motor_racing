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
      times: $('hud-times'),
      lap: $('hud-lap'), trackName: $('hud-track-name'), corner: $('hud-corner'),
      camLabel: $('hud-camera-label'), minimap: $('minimap'),
      lights: $('lights'), msg: $('center-msg'), wrongway: $('wrongway'),
      autopilot: $('hud-autopilot'),
      pos: $('hud-pos'), gaps: $('hud-gaps'), results: $('results'),
    };
    this.mode = 'time';
    this.raceLaps = 3;
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

  setMode(mode, laps) {
    this.mode = mode;
    this.raceLaps = laps;
    this.el.pos.classList.toggle('hidden', mode !== 'race');
    this.el.gaps.classList.toggle('hidden', mode !== 'race');
    // the top-centre lap-timer block is meaningless when exploring
    if (this.el.times) this.el.times.classList.toggle('hidden', mode === 'explore');
    this.openWorldMap = null;
  }

  // supply the open-world map metadata; the minimap then draws the ring road,
  // landmarks (silos) and gas stations instead of a track polyline
  setOpenWorldMap(data) { this.openWorldMap = data; }

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
    const gearTxt = (p.reversing || p.speed > 0.3 && p.vx < -0.05) ? 'R' : String(p.gear);
    if (this._lastVals.gear !== gearTxt) { this.el.gear.textContent = gearTxt; this._lastVals.gear = gearTxt; }
    this.el.rpmFill.style.width = `${Math.round(p.rpm * 100)}%`;
    this.el.rpmFill.classList.toggle('redline', p.rpm > 0.94);

    const drsState = p.drsOpen ? 'on' : (p.drsAvailable ? 'armed' : 'off');
    if (this._lastVals.drs !== drsState) {
      this.el.drs.className = `drs-${drsState}`;
      this._lastVals.drs = drsState;
    }

    this.el.time.textContent = formatTime(race.currentLapMs);
    const lapTxt = this.mode === 'race'
      ? `${Math.min(race.lapCount, this.raceLaps)} / ${this.raceLaps}`
      : String(race.lapCount);
    if (this._lastVals.lap !== lapTxt) { this.el.lap.textContent = lapTxt; this._lastVals.lap = lapTxt; }
    if (this._lastVals.last !== race.lastLapMs) { this.el.last.textContent = formatTime(race.lastLapMs); this._lastVals.last = race.lastLapMs; }
    if (this._lastVals.best !== race.bestLapMs) { this.el.best.textContent = formatTime(race.bestLapMs); this._lastVals.best = race.bestLapMs; }

    // race position + gaps around the player
    if (this.mode === 'race') {
      const posTxt = `P${race.playerPos}`;
      if (this._lastVals.pos !== posTxt) {
        this.el.pos.innerHTML = `${posTxt}<i>/${race.entries.length}</i>`;
        this._lastVals.pos = posTxt;
      }
      const gaps = race.gaps();
      if (gaps) {
        const ah = gaps.ahead ? `▲ ${gaps.ahead.e.short} +${gaps.ahead.s.toFixed(1)}s` : '🏆 领跑';
        const bh = gaps.behind ? `▼ ${gaps.behind.e.short} -${gaps.behind.s.toFixed(1)}s` : '';
        const t = `${ah}${bh ? ' · ' + bh : ''}`;
        if (this._lastVals.gaps !== t) { this.el.gaps.textContent = t; this._lastVals.gaps = t; }
      }
    }

    // corner callout
    const frac = p.info ? p.info.frac : 0;
    let corner = null;
    for (const c of (this.cfg ? this.cfg.corners : [])) {
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
    if (this.openWorldMap) { this.drawOpenWorldMap(ctx, state); return; }
    if (this.mapBase) ctx.drawImage(this.mapBase, 0, 0);
    if (this.mapFn) {
      for (const e of race.entries) {
        if (e.isPlayer) continue;
        const [ax, az] = this.mapFn(e.physics.pos.x, e.physics.pos.z);
        ctx.fillStyle = e.team?.uiColor || '#9aa2b1';
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ax, az, 3.4, 0, 7); ctx.fill(); ctx.stroke();
      }
      const [cx, cz] = this.mapFn(p.pos.x, p.pos.z);
      ctx.fillStyle = '#ffd21e';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cz, 5, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  // open-world minimap: world is a big disc; draw the ring road, silos, gas
  // stations and the player (heading arrow, cyan when on foot)
  drawOpenWorldMap(ctx, state) {
    const m = this.openWorldMap;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const R = W / 2 - 6, cx = W / 2, cy = H / 2;
    const sc = R / m.radius;             // world metres -> px
    const mapX = x => cx + x * sc, mapZ = z => cy + z * sc;
    // backdrop disc
    ctx.fillStyle = 'rgba(24,32,24,0.72)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, 7); ctx.stroke();
    // ring road
    ctx.strokeStyle = 'rgba(210,214,220,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, m.roadR * sc, 0, 7); ctx.stroke();
    // gas stations
    for (const g of (m.gasStations || [])) {
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.arc(mapX(g.x), mapZ(g.z), 4, 0, 7); ctx.fill();
    }
    // landmark silos (green = found, white = not)
    for (const lm of (m.landmarks || [])) {
      ctx.fillStyle = lm.reached ? '#57d977' : '#e8ecf4';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(mapX(lm.x), mapZ(lm.z), 3.4, 0, 7); ctx.fill(); ctx.stroke();
    }
    // player: arrow pointing along heading (look direction when on foot)
    const onFoot = !!(state.onFootActive);
    const pos = onFoot ? state.onfoot.pos : state.physics.pos;
    const heading = onFoot ? (state.rig?.lookYaw ?? state.onfoot.heading) : state.physics.heading;
    const px = mapX(pos.x), pz = mapZ(pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-heading);                // screen +z is down; heading 0 = +z
    ctx.fillStyle = onFoot ? '#39d7e8' : '#ffd21e';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
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
