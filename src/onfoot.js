// On-foot character controller for the open world. Loads the Blender driver
// model and walks it across the terrain with WASD, following ground height and
// respecting the same prop colliders as the car. Used when the player exits
// the car (F). The car stays parked where it was left.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import charUrl from './models/character.glb?url';

const WALK = 3.4;   // m/s stroll
const RUN = 7.0;    // m/s with shift
const FOOT_R = 0.5; // collision disc

let _charProto = null;
export async function loadCharacter() {
  if (_charProto) return _charProto.clone(true);
  const gltf = await new GLTFLoader().loadAsync(charUrl);
  let mesh = null;
  gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  mesh.geometry.computeVertexNormals();
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  _charProto = g;
  return g.clone(true);
}

export class OnFoot {
  constructor(world, model) {
    this.world = world;
    this.group = model;      // visual character group
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.bob = 0;
    this.active = false;
  }

  placeAt(x, z, heading = 0) {
    this.pos.set(x, this.world.heightAt(x, z), z);
    this.heading = heading;
    this.speed = 0;
  }

  // input: { mx, mz, run } where mx/mz are -1..1 movement axes (world-ish),
  // steer/throttle reused from the keyboard. We treat forward = +throttle.
  step(dt, ax) {
    // desired planar move from raw WASD axes (ax.fwd, ax.strafe)
    const fwd = ax.fwd, strafe = ax.strafe;
    const mag = Math.hypot(fwd, strafe);
    const target = mag > 0.05 ? (ax.run ? RUN : WALK) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);
    if (mag > 0.05) {
      // face the movement direction (camera-relative handled by caller giving
      // world-space fwd/strafe already rotated); here axes are world X/Z
      this.heading = Math.atan2(strafe, fwd);
      const dirX = Math.sin(this.heading), dirZ = Math.cos(this.heading);
      const nx = this.pos.x + dirX * this.speed * dt;
      const nz = this.pos.z + dirZ * this.speed * dt;
      this.pos.x = nx; this.pos.z = nz;
    }
    // prop collision: push out of solid props
    const hit = this.world.collide(this.pos.x, this.pos.z, FOOT_R);
    if (hit) { this.pos.x += hit.nx * hit.pen; this.pos.z += hit.nz * hit.pen; }
    // world boundary
    const b = this.world.bounds;
    const dx = this.pos.x - b.cx, dz = this.pos.z - b.cz, r = Math.hypot(dx, dz);
    if (r > b.radius) { this.pos.x -= dx / r * (r - b.radius); this.pos.z -= dz / r * (r - b.radius); }
    // stick to the ground
    this.pos.y = this.world.heightAt(this.pos.x, this.pos.z);
    this.bob += this.speed * dt * 2.6;
    this.sync();
  }

  sync() {
    const g = this.group;
    g.position.set(this.pos.x, this.pos.y, this.pos.z);
    g.rotation.y = this.heading;
    // subtle walking bob
    g.position.y += this.speed > 0.3 ? Math.abs(Math.sin(this.bob)) * 0.06 : 0;
  }
}
