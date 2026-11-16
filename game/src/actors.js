// Emberline actors: the player and the bots share one body.
// Movement is acceleration-based with per-axis AABB collision against the map.
import * as THREE from 'three';
import { collide } from './map.js';
import { WEAPONS } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const HALF = 0.35;
export const HEIGHT_STAND = 1.75;
export const HEIGHT_CROUCH = 1.15;
export const WALK_SPEED = 5.2;
export const CROUCH_SPEED = 2.6;
export const AIM_SPEED = 3.1;
export const ACCEL = 55;
export const FRICTION = 11;

let nextId = 1;

export function createActor(team, isPlayer, name, x, z, yaw) {
  const a = {
    id: nextId++, name, team, isPlayer,
    pos: { x, y: 0, z }, yaw, pitch: 0,
    vel: { x: 0, z: 0 },
    hp: 100, armor: 0, alive: true,
    crouch: false, moving: false, aiming: false,
    weapon: 'rifle', mag: 0, reserve: 0, grenades: 0,
    spread: 0, recoil: 0, reloadT: 0, fireT: 0, lastShot: -9,
    flashT: 0, hitT: 0, stepT: 0, plantT: 0,
    bot: null, mesh: null, gun: null, bodyMat: null,
  };
  giveWeapon(a, isPlayer ? 'pistol' : 'rifle');
  return a;
}

export function giveWeapon(a, key) {
  const w = WEAPONS[key];
  a.weapon = key;
  a.mag = w.mag;
  a.reserve = w.reserve;
  a.reloadT = 0;
  a.fireT = 0;
}

export function eyeHeight(a) {
  return a.crouch ? EYE_CROUCH : EYE_STAND;
}

export function bodyHeight(a) {
  return a.crouch ? HEIGHT_CROUCH : HEIGHT_STAND;
}

// Move an actor by its velocity for dt, resolving against walls per axis.
// Returns true when it bumped into something.
export function moveActor(a, dt) {
  const h = bodyHeight(a);
  let bumped = false;
  a.pos.x += a.vel.x * dt;
  const px = { x: a.pos.x, z: a.pos.z };
  if (collide(px, HALF, h)) { a.pos.x = px.x; a.pos.z = px.z; a.vel.x = 0; bumped = true; }
  a.pos.z += a.vel.z * dt;
  const pz = { x: a.pos.x, z: a.pos.z };
  if (collide(pz, HALF, h)) { a.pos.x = pz.x; a.pos.z = pz.z; a.vel.z = 0; bumped = true; }
  return bumped;
}

// Accelerate toward a wish direction (unit x,z) up to speed; friction otherwise.
export function accelerate(a, wx, wz, speed, dt) {
  const sp = Math.hypot(a.vel.x, a.vel.z);
  if (wx === 0 && wz === 0) {
    if (sp > 0) {
      const ns = Math.max(0, sp - FRICTION * dt);
      a.vel.x = (a.vel.x / sp) * ns;
      a.vel.z = (a.vel.z / sp) * ns;
    }
    a.moving = false;
    return;
  }
  a.vel.x += wx * ACCEL * dt;
  a.vel.z += wz * ACCEL * dt;
  const sp2 = Math.hypot(a.vel.x, a.vel.z);
  if (sp2 > speed) {
    a.vel.x = (a.vel.x / sp2) * speed;
    a.vel.z = (a.vel.z / sp2) * speed;
  }
  a.moving = sp2 > 0.6;
}

// Head box (top slice) and body box of an actor, for hit tests.
export function hitBoxes(a) {
  const h = bodyHeight(a);
  return {
    body: { x1: a.pos.x - 0.42, x2: a.pos.x + 0.42, y1: 0, y2: h - 0.3, z1: a.pos.z - 0.42, z2: a.pos.z + 0.42 },
    head: { x1: a.pos.x - 0.26, x2: a.pos.x + 0.26, y1: h - 0.3, y2: h, z1: a.pos.z - 0.26, z2: a.pos.z + 0.26 },
  };
}

// --- meshes -----------------------------------------------------------------

const bodyGeo = new THREE.CylinderGeometry(0.34, 0.38, 1.15, 10);
const headGeo = new THREE.SphereGeometry(0.24, 12, 10);
const gunGeo = new THREE.BoxGeometry(0.09, 0.14, 0.72);
const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);

export function buildActorMesh(a) {
  const g = new THREE.Group();
  const color = a.team === 'ember' ? 0xe8641f : 0x2ec4b6;
  const dark = new THREE.MeshStandardMaterial({ color: 0x232120, roughness: 0.85 });
  const teamMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: color, emissiveIntensity: 0.25 });
  a.bodyMat = teamMat;
  const body = new THREE.Mesh(bodyGeo, dark);
  body.position.y = 0.95; body.castShadow = true;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.42), teamMat);
  vest.position.y = 1.05; vest.castShadow = true;
  const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x8a6f5c, roughness: 0.8 }));
  head.position.y = 1.62; head.castShadow = true;
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
  helm.position.y = 1.64;
  const gun = new THREE.Mesh(gunGeo, dark);
  gun.position.set(0.28, 1.25, 0.3);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.14, 0.25, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.14, 0.25, 0);
  g.add(body, vest, head, helm, gun, legL, legR);
  g.userData.legs = [legL, legR];
  a.mesh = g;
  a.gun = gun;
  return g;
}

// Sync a bot's mesh to its sim state (called from render, not sim).
export function syncMesh(a, time) {
  const g = a.mesh;
  if (!g) return;
  g.visible = a.alive;
  if (!a.alive) return;
  g.position.set(a.pos.x, 0, a.pos.z);
  g.rotation.y = a.yaw;
  const h = bodyHeight(a);
  g.scale.y = h / HEIGHT_STAND;
  const swing = a.moving ? Math.sin(time * 11) * 0.35 : 0;
  g.userData.legs[0].rotation.x = swing;
  g.userData.legs[1].rotation.x = -swing;
  g.children[2].rotation.x = a.pitch * 0.4; // head follows pitch a little
}

// First-person viewmodel: a chunky gun made of boxes, parented to the camera.
export function buildViewmodel(camera) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.55, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xe8641f, roughness: 0.5, metalness: 0.3, emissive: 0xe8641f, emissiveIntensity: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.42);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), dark);
  mag.position.set(0, -0.14, -0.05); mag.rotation.x = 0.25;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), accent);
  sight.position.set(0, 0.09, -0.1);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
  grip.position.set(0, -0.12, 0.16); grip.rotation.x = 0.4;
  g.add(body, barrel, mag, sight, grip);
  g.position.set(0.26, -0.24, -0.45);
  camera.add(g);
  return g;
}
