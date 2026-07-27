// Voxel Grand Prix — bootstrapping, menu, game loop, visual sync.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACKS, TRACK_ORDER } from './config.js';
import { CIRCUITS } from './data/circuits.js';
import { Track } from './track.js';
import { buildEnvironment, groundHeightAt } from './environment.js';
import { buildOpenWorld } from './openworld.js';
import { OnFoot, loadCharacter } from './onfoot.js';
import { buildSculptedCar, buildCarInstance, clearCarCache } from './carSculpt.js';
import { TEAMS, TEAM_ORDER, loadSelectedTeam } from './teams.js';
import { CarPhysics } from './physics.js';
import { Garage } from './garage.js';
import { CameraRig, CAMERA_MODES } from './cameras.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Particles, SkidMarks } from './particles.js';
import { Hud, drawTrackMap } from './hud.js';
import { Race } from './race.js';

// ------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);

const input = new Input();
const audio = new GameAudio();
const hud = new Hud();

let G = null; // current game session
let selTrack = TRACK_ORDER[0];
let selTeam = loadSelectedTeam();
let selMode = ['race', 'roam', 'explore'].includes(localStorage.getItem('voxelf1-mode'))
  ? localStorage.getItem('voxelf1-mode') : 'time';
let paused = false;
const RACE_LOD = 0.022;      // AI cars in a full 10-car race (keeps FPS up)
const PLAYER_LOD = 0.016;    // player's car: showroom-grade sculpt. Measured:
                             // surface detail saturates here — finer voxels
                             // add build cost but no extra rendered geometry.
const RACE_LAPS = 3;

const garage = new Garage(
  renderer,
  teamId => { selTeam = teamId; refreshTeamChip(); garage.close(); hud.show('menu', true); },
  () => { garage.close(); hud.show('menu', true); }
);

function refreshTeamChip() {
  const t = TEAMS[selTeam];
  const chip = document.getElementById('selected-team');
  if (chip) chip.innerHTML = `<i style="background:${t.uiColor}"></i>${t.name} <b>#${t.number}</b>`;
}

function openGarage() {
  hud.show('menu', false);
  garage.open(selTeam);
}

// ------------------------------------------------------------ menu
function setupMenu() {
  const cards = document.getElementById('track-cards');
  cards.innerHTML = '';
  for (const id of TRACK_ORDER) {
    const cfg = TRACKS[id];
    const card = document.createElement('div');
    card.className = 'track-card' + (id === selTrack ? ' selected' : '');
    card.dataset.id = id;
    card.innerHTML = `
      <canvas width="240" height="180"></canvas>
      <div class="tc-name">${cfg.flag} ${cfg.name}<span class="tc-full">${cfg.fullName}</span></div>
      <div class="tc-stats">${(CIRCUITS[id].length / 1000).toFixed(3)} km · ${cfg.corners.length} 弯</div>
      <div class="tc-desc">${cfg.desc}</div>`;
    cards.appendChild(card);
    const cv = card.querySelector('canvas');
    drawTrackMap(cv.getContext('2d'), CIRCUITS[id].pts, 240, 180, cfg.minimapRot, { width: 3.5, color: '#e8ecf4', pad: 14 });
    card.addEventListener('click', () => {
      selTrack = id;
      cards.querySelectorAll('.track-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
    });
  }
  refreshTeamChip();
  const refreshMode = () => {
    document.querySelectorAll('.mode-chip').forEach(c => c.classList.toggle('on', c.dataset.mode === selMode));
    const btn = document.getElementById('btn-start');
    if (btn) btn.textContent = selMode === 'race' ? `发车 · ${RACE_LAPS} 圈正赛`
      : selMode === 'roam' ? '开始探索 · FREE ROAM'
      : selMode === 'explore' ? '进入开放世界 · OPEN WORLD'
      : '进入赛道 · LIGHTS OUT';
  };
  document.querySelectorAll('.mode-chip').forEach(c => c.addEventListener('click', () => {
    selMode = ['race', 'roam', 'explore'].includes(c.dataset.mode) ? c.dataset.mode : 'time';
    localStorage.setItem('voxelf1-mode', selMode);
    refreshMode();
  }));
  refreshMode();
  document.getElementById('btn-garage').addEventListener('click', () => {
    audio.init(); audio.resume();
    openGarage();
  });
  document.getElementById('btn-start').addEventListener('click', () => {
    audio.init(); audio.resume();
    startGame(selTrack, selTeam);
  });
  document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
  document.getElementById('btn-restart').addEventListener('click', () => { setPaused(false); startGame(selTrack, selTeam); });
  document.getElementById('btn-menu').addEventListener('click', () => { setPaused(false); toMenu(); });
  document.getElementById('btn-res-again').addEventListener('click', () => { hud.show('results', false); startGame(selTrack, selTeam); });
  document.getElementById('btn-res-menu').addEventListener('click', () => { hud.show('results', false); toMenu(); });
}

function toMenu() {
  if (G) disposeGame();
  garage.close();
  hud.show('menu', true);
  hud.show('hud', false);
  hud.show('lights', false);
}

function setPaused(v) {
  if (!G) return;
  paused = v;
  hud.show('pause', v);
  if (audio.ctx) { v ? audio.ctx.suspend() : audio.ctx.resume(); }
}

// exit the car to walk (or get back in if within range)
function toggleOnFoot() {
  if (!G || !G.onfoot) return;
  const p = G.physics, foot = G.onfoot;
  if (!G.onFootActive) {
    // step out beside the car (left side), stop the car
    const Lf = p.left(new THREE.Vector3());
    const x = p.pos.x + Lf.x * 2.2, z = p.pos.z + Lf.z * 2.2;
    foot.placeAt(x, z, p.heading);
    foot.group.visible = true;
    p.vx = p.vy = p.yawRate = 0;
    G.onFootActive = true;
    G.rig.setFootTarget(foot);
    input.lockPointer(); // hide cursor, capture mouse for look
    hud.message('🚶 下车步行 · 鼠标转向 · WASD 移动 · C 视角 · F 上车<br><span class="en">ON FOOT · mouse to look</span>', 2600);
  } else {
    // must be near the car to get back in
    const d = Math.hypot(foot.pos.x - p.pos.x, foot.pos.z - p.pos.z);
    if (d > 6) { hud.message('走近赛车才能上车', 1400); return; }
    foot.group.visible = false;
    G.onFootActive = false;
    G.rig.setFootTarget(null);
    input.unlockPointer();
    hud.message('🏎 已上车<br><span class="en">BACK IN THE CAR</span>', 1600);
  }
}

// ------------------------------------------------------------ game session
function disposeGame() {
  if (!G) return;
  if (G.race) G.race.cancelTimers();
  G.env.dispose();
  if (G.track) { G.track.dispose(); G.scene.remove(G.track.group); }
  G.particles.dispose(G.scene);
  G.skids.dispose(G.scene);
  clearCarCache(); // cloned car geometries are disposed with the scene
  G.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  G = null;
  window.__game = null;
}

let starting = false;
async function startGame(trackId, teamId) {
  if (starting) return;
  starting = true;
  garage.close();
  hud.show('menu', false);
  hud.show('loading', true);
  try {
    await new Promise(r => setTimeout(r, 30));
    disposeGame();
    if (selMode === 'explore') await buildOpenWorldGame(teamId);
    else await buildGame(trackId, teamId);
    hud.show('loading', false);
    hud.show('hud', true);
    G.race.start();
  } finally {
    starting = false;
  }
}

async function buildGame(trackId, teamId) {
  const cfg = TRACKS[trackId];
  const team = TEAMS[teamId] || TEAMS.redbull;
  const loadMsg = document.getElementById('loading-msg');

  const scene = new THREE.Scene();
  renderer.toneMappingExposure = cfg.sky.exposure;

  if (loadMsg) loadMsg.textContent = '正在铺设赛道…';
  const track = new Track(cfg);
  scene.add(track.group);
  if (loadMsg) loadMsg.textContent = '正在生成地形与光照…';
  await new Promise(r => setTimeout(r, 16));
  const env = buildEnvironment(scene, track, cfg, renderer);

  // night races render through a bloom composer so emissives glow
  let composer = null;
  if (cfg.sky.type === 'night') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.68);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- cars: player (+ 9 AI in race mode) ----
  // player's car gets a finer voxel grid (0.016) than the AI pack (0.022):
  // ~2x the surface detail while the 9 AI cars stay light for frame rate.
  const car = await buildCarInstance(team, PLAYER_LOD, (f, label) => {
    if (loadMsg && label) loadMsg.textContent = label;
  }, 'race');
  car.group.rotation.order = 'YXZ';
  scene.add(car.group);
  const physics = new CarPhysics(track);
  const playerEntry = {
    physics, car, team, isPlayer: true, skill: 1, bias: 0,
    name: `${team.short} #${team.number} · 你`, short: team.short,
    roll: 0, dive: 0,
  };

  const entries = [];
  if (selMode === 'race') {
    // full 2022 grid: every team fields one car; player takes their team's seat
    const slots = TEAM_ORDER.filter(id => id !== team.id);
    const skills = [0.985, 0.978, 0.971, 0.964, 0.957, 0.950, 0.942, 0.934, 0.926];
    for (let i = 0; i < slots.length; i++) {
      if (loadMsg) loadMsg.textContent = `打造 AI 赛车 ${i + 1}/${slots.length}…`;
      await new Promise(r => setTimeout(r, 0));
      const t = TEAMS[slots[i]];
      const c = await buildCarInstance(t, RACE_LOD, () => {}, 'race');
      c.group.rotation.order = 'YXZ';
      scene.add(c.group);
      entries.push({
        physics: new CarPhysics(track), car: c, team: t, isPlayer: false,
        skill: skills[i], bias: (Math.random() * 2 - 1) * 1.1,
        name: `${t.short} #${t.number}`, short: t.short,
        roll: 0, dive: 0,
      });
    }
  }
  entries.push(playerEntry); // player starts at the back of the grid

  // placement: race/time use the painted grid slots; roam drops the player
  // on the start line, ready to drive immediately with no countdown.
  if (selMode === 'roam') {
    physics.placeAt(0.001, 0);
    physics.freeRoam = true;
    physics.locked = false;
    physics.groundYFn = q => groundHeightAt(track, q);
  } else {
    entries.forEach((e, i) => {
      const back = 9 + i * 9;
      e.physics.placeAt(((-back / track.length) % 1 + 1) % 1, (i % 2 === 0 ? 1 : -1) * track.width * 0.22);
      e.physics.locked = true;
    });
  }

  const rig = new CameraRig(camera, car, physics, track);
  const particles = new Particles(scene);
  const skids = new SkidMarks(scene);
  const race = new Race(track, entries, hud, audio, { mode: selMode, laps: RACE_LAPS });
  race.onPlayerFinish = cls => showResults(cls);

  hud.setTrack(cfg, track);
  hud.setMode(selMode, RACE_LAPS);
  hud.setCameraLabel(CAMERA_MODES[0].label);

  G = {
    scene, track, env, car, physics, entries, rig, particles, skids, race, cfg, team, composer,
    accum: 0, smoke: { t: 0 }, lastGear: 1, wallCd: 0,
  };
  window.__game = G;
}

// ------------------------------------------------------------ open-world session
// A minimal session with no Race object: one player car free-driving on a
// procedural terrain. `race` is a tiny shim so the shared game loop + HUD work.
async function buildOpenWorldGame(teamId) {
  const team = TEAMS[teamId] || TEAMS.redbull;
  const loadMsg = document.getElementById('loading-msg');
  const scene = new THREE.Scene();
  renderer.toneMappingExposure = 1.0; // night exposure (matches Singapore)

  if (loadMsg) loadMsg.textContent = '正在生成开放世界地形与模型…';
  await new Promise(r => setTimeout(r, 16));
  const env = await buildOpenWorld(scene, renderer);
  const world = env.world;

  // bloom composer: glows lamps/windows at night. Strength is driven by the
  // day/night cycle each frame (near 0 by day so the sky/car don't glow), and
  // a high threshold keeps only genuinely bright pixels blooming.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.0, 0.6, 0.85);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);

  if (loadMsg) loadMsg.textContent = '正在打造你的赛车…';
  const car = await buildCarInstance(team, PLAYER_LOD, (f, label) => {
    if (loadMsg && label) loadMsg.textContent = label;
  }, 'race');
  car.group.rotation.order = 'YXZ';
  scene.add(car.group);

  const physics = new CarPhysics(null);
  physics.world = world;
  const sp = world.spawn();
  physics.placeAtWorld(sp.x, sp.z, sp.heading);
  physics.locked = false;

  const playerEntry = {
    physics, car, team, isPlayer: true, skill: 1, bias: 0,
    name: `${team.short} #${team.number} · 你`, short: team.short, roll: 0, dive: 0,
  };
  const entries = [playerEntry];

  const rig = new CameraRig(camera, car, physics, null);
  const particles = new Particles(scene);
  const skids = new SkidMarks(scene);

  // on-foot character (hidden until the player exits the car)
  if (loadMsg) loadMsg.textContent = '正在准备驾驶员…';
  const charModel = await loadCharacter();
  charModel.visible = false;
  scene.add(charModel);
  const onfoot = new OnFoot(world, charModel);

  // race shim: satisfies the game loop + HUD without laps/AI. Also tracks the
  // silo landmarks as simple exploration checkpoints.
  const landmarks = env.landmarks || [];
  const race = {
    mode: 'explore', state: 'racing', autopilotActive: false,
    entries, player: playerEntry,
    lapCount: 1, lastLapMs: null, currentLapMs: 0, bestLapMs: null, playerPos: 1,
    wrongWay: false, found: 0,
    start() {
      hud.message(`🗺 开放世界 · 找到全部 ${landmarks.length} 座地标筒仓!<br><span class="en">EXPLORE · ${landmarks.length} LANDMARKS</span>`, 3000, 'go');
    },
    cancelTimers() {},
    reset() {
      const s = world.spawn(); physics.placeAtWorld(s.x, s.z, s.heading);
      hud.message('已回到出发点', 1400);
    },
    inputFor(e, userInput) { return userInput; },
    resolveCollisions() {},
    update() {
      // landmark checkpoints: drive within 22 m of an unreached silo
      for (const lm of landmarks) {
        if (lm.reached) continue;
        if (Math.hypot(physics.pos.x - lm.x, physics.pos.z - lm.z) < 22) {
          lm.reached = true; this.found++;
          if (this.found >= landmarks.length) {
            hud.message('🏆 你找到了所有地标!自由探索继续<br><span class="en">ALL LANDMARKS FOUND</span>', 3200, 'purple');
          } else {
            hud.message(`✅ 地标 ${this.found}/${landmarks.length}`, 1600);
          }
        }
      }
    },
    gaps() { return null; },
  };

  hud.setMode('explore', 0);
  hud.setCameraLabel(CAMERA_MODES[0].label);

  hud.setOpenWorldMap(world.mapData);

  G = {
    scene, track: null, env, car, physics, entries, rig, particles, skids, race,
    cfg: { flag: '🗺', name: '开放世界', fullName: 'Open World', corners: [], sky: { type: 'night' } },
    team, composer, bloomPass, accum: 0, smoke: { t: 0 }, lastGear: 1, wallCd: 0,
    onfoot, world, onFootActive: false,
  };
  window.__game = G;
}

function showResults(cls) {
  const box = document.getElementById('results-rows');
  if (!box) return;
  box.innerHTML = '';
  const playerRow = cls.find(r => r.isPlayer);
  document.getElementById('results-pos').textContent = `P${playerRow ? playerRow.pos : '-'}`;
  for (const r of cls) {
    const div = document.createElement('div');
    div.className = 'res-row' + (r.isPlayer ? ' me' : '');
    const gap = r.pos === 1 ? '冠军' : (r.finished && r.gapMs != null ? `+${(r.gapMs / 1000).toFixed(2)}s` : '—');
    div.innerHTML = `<b>P${r.pos}</b><span class="rn">${r.name}</span><span class="rg">${gap}</span>`;
    box.appendChild(div);
  }
  if (G) G.rig.setMode('tv'); // victory-lap broadcast view behind the overlay
  hud.show('results', true);
}

// ------------------------------------------------------------ per-frame visual sync
const SMOKE_GRAY = new THREE.Color(0xcfd2d6);
const SPRAY_GREEN = new THREE.Color(0x69a04a);
const _wpos = new THREE.Vector3(), _f2 = new THREE.Vector3(), _l2 = new THREE.Vector3();

function syncCarVisual(e, dt) {
  const car = e.car, p = e.physics;
  car.group.position.copy(p.pos);
  car.group.rotation.y = p.heading;
  car.group.rotation.x = p.groundPitch;
  const rollT = THREE.MathUtils.clamp(p.latG * 0.026, -0.06, 0.06);
  const diveT = THREE.MathUtils.clamp(-p.longG * 0.014, -0.03, 0.045);
  e.roll = THREE.MathUtils.damp(e.roll, rollT, 9, dt);
  e.dive = THREE.MathUtils.damp(e.dive, diveT, 9, dt);
  car.tilt.rotation.z = e.roll;
  car.tilt.rotation.x = e.dive;
  car.tilt.position.y = p.surface === 'kerb' ? Math.sin(performance.now() * 0.09) * 0.012 : 0;
  for (const w of car.wheels) {
    if (w.isFront) w.steer.rotation.y = p.steer;
    w.spin.rotation.x += p.wheelSpin * dt;
  }
  const targetRot = p.drsOpen ? -0.72 : 0;
  car.drsPivot.rotation.x = THREE.MathUtils.damp(car.drsPivot.rotation.x, targetRot, 12, dt);
  car.rainLight.visible = p.brake > 0.12 || (p.throttle < 0.05 && p.speed > 30);
}

function syncVisuals(dt) {
  const { physics: p } = G;
  for (const e of G.entries) syncCarVisual(e, dt);

  // player-only feedback
  if (p.gear !== G.lastGear) { audio.shift(); G.lastGear = p.gear; }
  G.wallCd -= dt;
  if (p.wallHit > 1.6 && G.wallCd <= 0) { audio.wallHit(p.wallHit); G.wallCd = 0.25; }

  // particles + skid marks at rear wheels
  const slide = Math.max(Math.abs(p.slipRear) - 0.10, Math.abs(p.slipFront) - 0.13, 0);
  const F = p.forward(_f2), Lf = p.left(_l2);
  const onRoad = p.surface === 'road' || p.surface === 'kerb';
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    _wpos.copy(p.pos).addScaledVector(F, -1.8).addScaledVector(Lf, side * 0.8);
    _wpos.y = p.pos.y + 0.03;
    if (slide > 0.02 && p.speed > 8) {
      if (onRoad) {
        G.skids.add(i, _wpos, Math.min(slide * 6, 1));
        G.smoke.t += dt;
        if (G.smoke.t > 0.016) {
          G.smoke.t = 0;
          particlesSpawn(_wpos, SMOKE_GRAY, 0.8 + slide * 2, p);
        }
      } else {
        G.skids.breakStreak(i);
        if (Math.random() < 0.55) particlesSpawn(_wpos, SPRAY_GREEN, 0.65, p);
      }
    } else {
      G.skids.breakStreak(i);
    }
  }
  if (p.surface === 'grass' && p.speed > 12 && Math.random() < 0.4) {
    _wpos.copy(p.pos).addScaledVector(F, -2.0);
    particlesSpawn(_wpos, SPRAY_GREEN, 0.8, p);
  }

  G.particles.update(dt);

  // audio update
  audio.update(dt, {
    rpm: p.rpm, throttle: p.throttle,
    speed01: Math.min(p.speed / 92, 1),
    slide: slide * 5,
    onKerb: p.surface === 'kerb',
    onGrass: p.surface === 'grass',
    cockpit: G.rig.mode !== 'chase',
  });
}

function particlesSpawn(pos, color, size, p) {
  _f2.set((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2);
  G.particles.spawn(pos, _f2, color, size, 0.55 + Math.random() * 0.5);
}

// ------------------------------------------------------------ main loop
const FIXED = 1 / 120;
let lastT = performance.now();

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  tick(dt);
}

function tick(dt, render = true) {
  // garage showroom has its own scene + camera
  if (garage.active) {
    for (const ev of input.takeEvents()) {
      if (ev === 'pause') { garage.close(); hud.show('menu', true); }
    }
    garage.update(dt);
    return;
  }

  // one-shot events work even in menus
  for (const ev of input.takeEvents()) {
    if (!G) continue;
    if (ev === 'camera') {
      if (G.onFootActive) { const lbl = G.rig.cycleFootView(); hud.setCameraLabel(lbl); }
      else { const m = G.rig.cycle(); hud.setCameraLabel(m.label); }
    }
    if (ev === 'reset' && !paused) G.race.reset();
    if (ev === 'pause') setPaused(!paused);
    if (ev === 'mute') { audio.setMuted(!audio.muted); hud.message(audio.muted ? '🔇 已静音' : '🔊 声音开启', 1000); }
    if (ev === 'autopilot') {
      G.race.autopilotActive = !G.race.autopilotActive;
      // demo mode watches from the trackside TV pods
      const m = G.rig.setMode(G.race.autopilotActive ? 'tv' : 'chase');
      hud.setCameraLabel(m.label);
      hud.message(G.race.autopilotActive ? '🤖 演示模式 · 观战视角' : '🎮 手动驾驶', 1400);
    }
    if (ev === 'enter' && G.onfoot && !paused) toggleOnFoot();
  }

  if (G && !paused) {
    input.update(dt);
    if (G.onFootActive) {
      // mouse controls the look direction; WASD only walks (relative to it)
      const md = input.takeMouse();
      if (md.dx || md.dy) G.rig.applyMouseLook(md.dx, md.dy);
      const ax = input.footAxes();
      const yaw = G.rig.lookYaw || 0;
      const fX = Math.sin(yaw), fZ = Math.cos(yaw);   // camera forward
      const rX = -Math.cos(yaw), rZ = Math.sin(yaw);  // camera right (D = right)
      G.onfoot.step(dt, {
        dirX: fX * ax.fwd + rX * ax.strafe,
        dirZ: fZ * ax.fwd + rZ * ax.strafe,
        run: ax.run,
      });
      // hide the character in first-person so it doesn't block the view
      G.onfoot.group.visible = G.rig.footView !== 'first';
      G.rig.update(dt);
      G.env.update(dt, G.onfoot.pos);
      // parked car idles quietly in the distance — its faint hum falls off with
      // how far the driver has walked from the car (silent once well away)
      const footDist = Math.hypot(G.onfoot.pos.x - p.pos.x, G.onfoot.pos.z - p.pos.z);
      audio.update(dt, { rpm: 0.12, throttle: 0, speed01: 0, slide: 0, footIdle: true, footDist });
      hud.update(G);
    } else {
      G.accum = Math.min(G.accum + dt, FIXED * 8);
      const inp = { steer: input.steer, throttle: input.throttle, brake: input.brake };
      while (G.accum >= FIXED) {
        for (const e of G.entries) {
          const ein = G.race.inputFor(e, inp);
          e._lastInput = ein;
          e.physics.step(FIXED, ein);
        }
        G.accum -= FIXED;
      }
      if (G.entries.length > 1) G.race.resolveCollisions();
      G.race.update(dt, inp);
      syncVisuals(dt);
      G.rig.update(dt);
      G.env.update(dt, G.physics.pos);
      hud.update(G);
    }
  }

  if (G && render) {
    // open world: bloom only at night (near 0 by day so nothing glows)
    if (G.bloomPass && G.env && typeof G.env.nightFactor === 'number') {
      G.bloomPass.strength = G.env.nightFactor * 0.7;
    }
    if (G.composer) G.composer.render();
    else renderer.render(G.scene, camera);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (G && G.composer) G.composer.setSize(window.innerWidth, window.innerHeight);
  garage.resize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !paused) setPaused(true); });

// re-capture the mouse for look when walking (e.g. after Esc released it)
renderer.domElement.addEventListener('click', () => {
  if (G && G.onFootActive && !paused && !input.pointerLocked) input.lockPointer();
});

setupMenu();
frame();

// ---- dev helpers (screenshot pipeline + programmatic control) ----
window.__renderer = renderer;
window.__camera = camera;
window.__startGame = startGame;
window.__tick = tick;
window.__setPaused = setPaused;
window.__garage = garage;
window.__shot = (name = `shot-${Date.now()}`) => {
  const scene = garage.active ? garage.scene : (G && G.scene);
  const cam = garage.active ? garage.camera : camera;
  if (!scene) return Promise.resolve('no scene');
  if (!garage.active && G && G.composer) G.composer.render();
  else renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  return fetch(`/__shot?name=${name}`, { method: 'POST', body: url }).then(r => r.text());
};
