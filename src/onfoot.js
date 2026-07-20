// On-foot character controller for the open world. Builds an ARTICULATED
// driver rig procedurally (jointed hips/knees/shoulders/elbows) so it can play
// a real walk cycle, walks it across the terrain with WASD, follows ground
// height and respects the same prop colliders as the car. F to exit/enter car.
import * as THREE from 'three';

const WALK = 3.4;   // m/s stroll
const RUN = 7.0;    // m/s with shift
const FOOT_R = 0.5; // collision disc

// ---- materials (shared across the rig) ----
function mats() {
  const M = c => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.85, metalness: 0.05 });
  return {
    suit: M(0x28448f), suitDark: M(0x1c3168), accent: M(0xe8c020),
    skin: M(0xd2a07f), glove: M(0x1a1a22), boot: M(0x141419),
    helmet: M(0xd83228), helmetTrim: M(0xf2f4f8), visor: (() => {
      const m = M(0x11151f); m.roughness = 0.25; m.metalness = 0.7; return m;
    })(),
  };
}

// a capsule limb segment pivoting from its TOP (y=0 at the joint, extends -y)
function segment(len, r1, r2, mat) {
  const g = new THREE.Group();
  const geo = new THREE.CapsuleGeometry((r1 + r2) / 2, len - (r1 + r2), 6, 12);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  g.add(m);
  return g;
}

function ball(r, mat, y = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
  m.position.y = y; m.castShadow = true;
  return m;
}

// Build a detailed articulated driver, ~1.8 m tall, origin at the feet,
// FACING +Z (so a chase cam sitting behind at -Z sees the back).
export async function loadCharacter() {
  const M = mats();
  const root = new THREE.Group();

  // pelvis at ~0.92 m; whole upper body hangs off it
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  root.add(pelvis);
  pelvis.add(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.26, 0.24), M.suit)).castShadow = true;

  // torso: tapered chest + accent band + collar
  const torso = new THREE.Group();
  torso.position.y = 0.13;
  pelvis.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.27), M.suit);
  chest.position.y = 0.23; chest.castShadow = true; torso.add(chest);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.12, 0.28), M.accent);
  band.position.y = 0.24; band.castShadow = true; torso.add(band);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.24), M.suitDark);
  collar.position.y = 0.47; torso.add(collar);

  // head + helmet with visor
  const neck = new THREE.Group(); neck.position.y = 0.52; torso.add(neck);
  neck.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), M.skin));
  const head = new THREE.Group(); head.position.y = 0.14; neck.add(head);
  const helmet = ball(0.19, M.helmet, 0); head.add(helmet);
  helmet.scale.set(1, 1.08, 1.02);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 20), M.helmetTrim);
  trim.rotation.x = Math.PI / 2; trim.position.y = 0.02; head.add(trim);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.11, 0.14), M.visor);
  visor.position.set(0, 0.0, 0.12); head.add(visor);

  // helper to make an arm/leg limb with a mid joint
  const makeLimb = (upperLen, lowerLen, rU, rL, matUpper, matLower, endMat, endR) => {
    const hip = new THREE.Group();                 // shoulder/hip pivot
    const upper = segment(upperLen, rU, rU * 0.85, matUpper);
    hip.add(upper);
    const knee = new THREE.Group();                // knee/elbow pivot
    knee.position.y = -upperLen;
    upper.add(knee);
    const lower = segment(lowerLen, rL, rL * 0.8, matLower);
    knee.add(lower);
    const end = ball(endR, endMat, -lowerLen);     // hand/foot
    if (endMat === M.boot) { end.scale.set(1.1, 0.7, 1.5); end.position.z = 0.05; }
    lower.add(end);
    return { hip, knee };
  };

  // shoulders + arms
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = ball(0.1, M.suit); shoulder.position.set(s * 0.28, 0.42, 0);
    torso.add(shoulder);
    const limb = makeLimb(0.32, 0.30, 0.075, 0.06, M.suit, M.suit, M.glove, 0.075);
    limb.hip.position.set(s * 0.28, 0.42, 0);
    torso.add(limb.hip);
    arms.push(limb);
  }

  // hips + legs
  const legs = [];
  for (const s of [-1, 1]) {
    const limb = makeLimb(0.44, 0.42, 0.10, 0.085, M.suit, M.suitDark, M.boot, 0.1);
    limb.hip.position.set(s * 0.12, 0, 0);
    pelvis.add(limb.hip);
    legs.push(limb);
  }

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.userData.rig = { pelvis, torso, arms, legs };
  return root;
}

export class OnFoot {
  constructor(world, model) {
    this.world = world;
    this.group = model;              // visual character group
    this.rig = model.userData.rig;   // { pelvis, torso, arms, legs }
    this.pos = new THREE.Vector3();
    this.heading = 0;                // facing (radians); model faces +z at 0
    this.faceYaw = 0;                // smoothed visual yaw
    this.speed = 0;
    this.cycle = 0;                  // walk-cycle phase
    this.active = false;
  }

  placeAt(x, z, heading = 0) {
    this.pos.set(x, this.world.heightAt(x, z), z);
    this.heading = heading;
    this.faceYaw = heading;
    this.speed = 0;
    this.cycle = 0;
  }

  // ax: { dirX, dirZ, run } — a WORLD-space desired move direction from caller
  step(dt, ax) {
    const mag = Math.hypot(ax.dirX, ax.dirZ);
    const target = mag > 0.05 ? (ax.run ? RUN : WALK) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);
    if (mag > 0.05) {
      const nx = ax.dirX / mag, nz = ax.dirZ / mag;
      // model faces +z at heading 0, so heading = atan2(x, z)
      this.heading = Math.atan2(nx, nz);
      this.pos.x += nx * this.speed * dt;
      this.pos.z += nz * this.speed * dt;
    }
    // prop collision
    const hit = this.world.collide(this.pos.x, this.pos.z, FOOT_R);
    if (hit) { this.pos.x += hit.nx * hit.pen; this.pos.z += hit.nz * hit.pen; }
    // world boundary
    const b = this.world.bounds;
    const dx = this.pos.x - b.cx, dz = this.pos.z - b.cz, r = Math.hypot(dx, dz);
    if (r > b.radius) { this.pos.x -= dx / r * (r - b.radius); this.pos.z -= dz / r * (r - b.radius); }
    // ground follow
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    // advance walk cycle by distance travelled (so it matches actual speed)
    this.cycle += this.speed * dt * 2.6;
    this.animate(dt);
    this.sync(dt);
  }

  // rotate the jointed limbs into a walk pose
  animate(dt) {
    const rig = this.rig;
    if (!rig) return;
    const moving = this.speed > 0.25;
    const sw = moving ? Math.sin(this.cycle) : 0;      // leg swing
    const sw2 = moving ? Math.sin(this.cycle * 2) : 0; // knee/bounce (2x)
    const amp = THREE.MathUtils.clamp(this.speed / RUN, 0, 1) * 0.9 + (moving ? 0.15 : 0);

    // legs swing opposite; knees bend on the return
    const [lL, lR] = rig.legs;
    lL.hip.rotation.x = sw * amp;
    lR.hip.rotation.x = -sw * amp;
    lL.knee.rotation.x = Math.max(0, -Math.cos(this.cycle)) * amp * 1.2;
    lR.knee.rotation.x = Math.max(0, Math.cos(this.cycle)) * amp * 1.2;

    // arms counter-swing to the legs, slight elbow bend
    const [aL, aR] = rig.arms;
    aL.hip.rotation.x = -sw * amp * 0.8;
    aR.hip.rotation.x = sw * amp * 0.8;
    aL.knee.rotation.x = -0.3 - Math.abs(sw) * 0.3;
    aR.knee.rotation.x = -0.3 - Math.abs(sw) * 0.3;

    // torso bob + subtle sway
    rig.pelvis.position.y = 0.92 + (moving ? Math.abs(sw2) * 0.04 : 0);
    rig.torso.rotation.z = moving ? sw * 0.04 : 0;
    rig.torso.rotation.y = moving ? sw * 0.05 : 0;
  }

  sync(dt) {
    const g = this.group;
    g.position.set(this.pos.x, this.pos.y, this.pos.z);
    // smooth the visual turn so facing changes aren't instant
    let d = this.heading - this.faceYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.faceYaw += d * Math.min(1, (dt || 0.016) * 10);
    g.rotation.y = this.faceYaw;
  }
}
