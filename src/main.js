// Voxel Grand Prix — bootstrapping, menu, game loop, visual sync.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TRACKS, TRACK_ORDER, LIVERIES } from './config.js';
import { CIRCUITS } from './data/circuits.js';
import { Track } from './track.js';
import { buildEnvironment } from './environment.js';
import { buildCar } from './carModel.js';
import { CarPhysics } from './physics.js';
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
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const input = new Input();
const audio = new GameAudio();
const hud = new Hud();

let G = null; // current game session
let selTrack = TRACK_ORDER[0];
let selLivery = LIVERIES[0].id;
let paused = false;

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
  const lrow = document.getElementById('livery-row');
  lrow.innerHTML = '';
  for (const liv of LIVERIES) {
    const sw = document.createElement('div');
    sw.className = 'livery' + (liv.id === selLivery ? ' selected' : '');
    sw.dataset.id = liv.id;
    sw.innerHTML = `<span class="chip" style="background:#${liv.body.toString(16).padStart(6, '0')}"></span>${liv.name} <b>#${liv.number}</b>`;
    sw.addEventListener('click', () => {
      selLivery = liv.id;
      lrow.querySelectorAll('.livery').forEach(c => c.classList.toggle('selected', c.dataset.id === liv.id));
    });
    lrow.appendChild(sw);
  }
  document.getElementById('btn-start').addEventListener('click', () => {
    audio.init(); audio.resume();
    startGame(selTrack, selLivery);
  });
  document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
  document.getElementById('btn-restart').addEventListener('click', () => { setPaused(false); startGame(selTrack, selLivery); });
  document.getElementById('btn-menu').addEventListener('click', () => { setPaused(false); toMenu(); });
}

function toMenu() {
  if (G) disposeGame();
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

// ------------------------------------------------------------ game session
function disposeGame() {
  if (!G) return;
  G.race.cancelTimers();
  G.env.dispose();
  G.track.dispose();
  G.scene.remove(G.track.group);
  G.particles.dispose(G.scene);
  G.skids.dispose(G.scene);
  G.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  G = null;
}

function startGame(trackId, liveryId) {
  hud.show('menu', false);
  hud.show('loading', true);
  setTimeout(() => {
    disposeGame();
    buildGame(trackId, liveryId);
    hud.show('loading', false);
    hud.show('hud', true);
    G.race.start();
  }, 40);
}

function buildGame(trackId, liveryId) {
  const cfg = TRACKS[trackId];
  const livery = LIVERIES.find(l => l.id === liveryId) || LIVERIES[0];

  const scene = new THREE.Scene();
  scene.environment = roomEnv;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.35;
  renderer.toneMappingExposure = cfg.sky.exposure;

  const track = new Track(cfg);
  scene.add(track.group);
  const env = buildEnvironment(scene, track, cfg);

  const car = buildCar(livery);
  car.group.rotation.order = 'YXZ';
  scene.add(car.group);

  const physics = new CarPhysics(track);
  physics.placeAt(1 - 11 / track.length, track.width * 0.22);
  physics.locked = true;

  const rig = new CameraRig(camera, car, physics, track);
  const particles = new Particles(scene);
  const skids = new SkidMarks(scene);
  const race = new Race(track, physics, hud, audio);

  hud.setTrack(cfg, track);
  hud.setCameraLabel(CAMERA_MODES[0].label);

  G = {
    scene, track, env, car, physics, rig, particles, skids, race, cfg, livery,
    accum: 0, smoke: { t: 0 }, roll: 0, dive: 0, lastGear: 1, wallCd: 0,
  };
  window.__game = G;
}

// ------------------------------------------------------------ per-frame visual sync
const SMOKE_GRAY = new THREE.Color(0xcfd2d6);
const SPRAY_GREEN = new THREE.Color(0x69a04a);
const _wpos = new THREE.Vector3(), _f2 = new THREE.Vector3(), _l2 = new THREE.Vector3();

function syncVisuals(dt) {
  const { car, physics: p, race } = G;
  car.group.position.copy(p.pos);
  car.group.rotation.y = p.heading;
  car.group.rotation.x = p.groundPitch;

  // suspension-feel roll & dive
  const rollT = THREE.MathUtils.clamp(p.latG * 0.026, -0.06, 0.06);
  const diveT = THREE.MathUtils.clamp(-p.longG * 0.014, -0.03, 0.045);
  G.roll = THREE.MathUtils.damp(G.roll, rollT, 9, dt);
  G.dive = THREE.MathUtils.damp(G.dive, diveT, 9, dt);
  car.tilt.rotation.z = G.roll;
  car.tilt.rotation.x = G.dive;
  // kerb vibration
  if (p.surface === 'kerb') car.tilt.position.y = Math.sin(performance.now() * 0.09) * 0.012;
  else car.tilt.position.y = 0;

  for (const w of car.wheels) {
    if (w.isFront) w.steer.rotation.y = p.steer;
    w.spin.rotation.x += p.wheelSpin * dt;
  }
  // DRS flap
  const targetRot = p.drsOpen ? -0.72 : 0;
  car.drsPivot.rotation.x = THREE.MathUtils.damp(car.drsPivot.rotation.x, targetRot, 12, dt);
  // rain light: on under braking / lift
  car.rainLight.visible = p.brake > 0.12 || (p.throttle < 0.05 && p.speed > 30);

  // gear shift audio
  if (p.gear !== G.lastGear) { audio.shift(); G.lastGear = p.gear; }
  // wall hit audio
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
  // one-shot events work even in menus
  for (const ev of input.takeEvents()) {
    if (!G) continue;
    if (ev === 'camera') { const m = G.rig.cycle(); hud.setCameraLabel(m.label); }
    if (ev === 'reset' && !paused) G.race.reset();
    if (ev === 'pause') setPaused(!paused);
    if (ev === 'mute') { audio.setMuted(!audio.muted); hud.message(audio.muted ? '🔇 已静音' : '🔊 声音开启', 1000); }
    if (ev === 'autopilot') {
      G.race.autopilotActive = !G.race.autopilotActive;
      hud.message(G.race.autopilotActive ? '🤖 演示模式 · 自动驾驶' : '🎮 手动驾驶', 1400);
    }
  }

  if (G && !paused) {
    input.update(dt);
    G.accum = Math.min(G.accum + dt, FIXED * 8);
    const inp = G.race.autopilotActive
      ? G.race.autopilot(dt)
      : { steer: input.steer, throttle: input.throttle, brake: input.brake };
    while (G.accum >= FIXED) {
      G.physics.step(FIXED, inp);
      G.accum -= FIXED;
    }
    G.race.update(dt, inp);
    syncVisuals(dt);
    G.rig.update(dt);
    G.env.update(dt, G.physics.pos);
    hud.update(G);
  }

  if (G && render) renderer.render(G.scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !paused) setPaused(true); });

setupMenu();
frame();

// ---- dev helpers (screenshot pipeline + programmatic control) ----
window.__renderer = renderer;
window.__camera = camera;
window.__startGame = startGame;
window.__tick = tick;
window.__setPaused = setPaused;
window.__shot = (name = `shot-${Date.now()}`) => {
  if (!G) return Promise.resolve('no game');
  renderer.render(G.scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  return fetch(`/__shot?name=${name}`, { method: 'POST', body: url }).then(r => r.text());
};
