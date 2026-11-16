// Emberline: boot, input, fixed-step simulation, rendering, round flow.
// The sim runs at a fixed 60 Hz step apart from rendering; the DOM is only
// touched by hud.js and this file's overlay wiring.
import * as THREE from 'three';
import { createState, STEP, ROUND_TIME, FREEZE_TIME, ROUNDS_TO_WIN, MAX_ROUNDS, aliveOf, feed, dist2 } from './state.js';
import { buildMap, SITES } from './map.js';
import { WEAPONS, GRENADE, ARMOR, START_MONEY } from './weapons.js';
import {
  createActor, giveWeapon, eyeHeight, accelerate, moveActor, buildActorMesh,
  syncMesh, buildViewmodel, WALK_SPEED, CROUCH_SPEED, AIM_SPEED,
} from './actors.js';
import { makeBot, updateBot, botNames } from './bots.js';
import { fireWeapon, startReload, finishReload, throwGrenade, updateGrenades, updateBomb, updateBombPickup } from './combat.js';
import { createEffects } from './effects.js';
import { ensureAudio, sfx } from './audio.js';
import { createHud } from './hud.js';

const canvasHost = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

buildMap(scene);
const fx = createEffects(scene);
const state = createState();
const viewmodel = buildViewmodel(camera);

// Bomb mesh: a small charge with a blinking light, shown when planted/dropped.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.22, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2 }),
);
bombLight.position.set(0, 0.16, 0);
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const keys = new Set();
let firing = false;
let locked = false;

const hud = createHud({
  onStart: () => { ensureAudio(); startMatch(); lockPointer(); },
  onBuy: (kind, key) => buy(kind, key),
  onNextRound: () => nextRound(),
  onRestart: () => { startMatch(); lockPointer(); },
  onResume: () => { hud.hideAll(); lockPointer(); },
  onCloseBuy: () => { hud.hideAll(); lockPointer(); },
});

function lockPointer() {
  renderer.domElement.requestPointerLock?.();
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && (state.phase === 'live' || state.phase === 'freeze') && !state.buyOpen) {
    hud.showPause();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyB' && (state.phase === 'freeze' || state.phase === 'live')) toggleBuy();
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'KeyG') tryGrenade();
  if (e.code === 'Digit1') switchWeapon('pistol');
  if (e.code === 'Digit2' && state.player?.primary) switchWeapon(state.player.primary);
  if (e.code === 'Escape') state.buyOpen = false;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  ensureAudio();
  if (state.phase === 'menu') return;
  if (!locked) { lockPointer(); return; }
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'live') return;
  const w = WEAPONS[p.weapon];
  if (w.auto) firing = true;
  else tryFire();
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || !state.player) return;
  const p = state.player;
  p.yaw -= e.movementX * 0.0022;
  p.pitch -= e.movementY * 0.0022;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
});
renderer.domElement.addEventListener('wheel', () => {
  const p = state.player;
  if (!p) return;
  switchWeapon(p.weapon === 'pistol' && p.primary ? p.primary : 'pistol');
});

function switchWeapon(key) {
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'live') return;
  if (key === 'pistol' || key === p.primary) {
    if (p.weapon !== key) { giveWeapon(p, key); sfx.click(); }
  }
}

function tryReload() {
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'live') return;
  if (startReload(p)) sfx.reload();
}

function tryGrenade() {
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'live') return;
  if (throwGrenade(state, p)) sfx.grenadePin();
}

function tryFire() {
  const p = state.player;
  if (!p || !p.alive || state.phase !== 'live' || p.reloadT > 0 || p.fireT > 0) return;
  if (p.mag <= 0) {
    sfx.dry();
    if (startReload(p)) sfx.reload();
    return;
  }
  shoot(p);
}

function shoot(a) {
  const result = fireWeapon(state, a, fx, (kind, shooter, info) => {    const d = Math.hypot(a.pos.x - (state.player?.pos.x ?? 0), a.pos.z - (state.player?.pos.z ?? 0));
    if (kind === 'dry') { sfx.dry(); return; }
    sfx.shot(WEAPONS[a.weapon].sound, a === state.player ? 0 : d);
    state.noises.push({ x: a.pos.x, z: a.pos.z, r: 26, t: state.time });
    if (kind === 'hit' && info) {
      if (shooter === state.player) {
        state.stats.hits++;
        hud.flashHit(info.kill);
        sfx.hit();
        if (info.kill) sfx.kill();
      } else if (info.target === state.player) {
        hud.damageFlash();
        sfx.hurt();
        state.shake = Math.min(0.5, state.shake + 0.25);
      }
    }
  });
  if (result && a === state.player && result.hit) {
    // viewmodel kick is applied in render from recoil
  }
  if (result && a === state.player) state.stats.shots++;
}

function toggleBuy() {
  if (state.phase !== 'freeze' && state.phase !== 'live') return;
  if (state.buyOpen) {
    state.buyOpen = false;
    hud.hideAll();
    lockPointer();
  } else {
    state.buyOpen = true;
    document.exitPointerLock?.();
    hud.refreshBuy(state, state.player);
    hud.showBuy(state.money);
  }
}

function buy(kind, key) {
  const p = state.player;
  if (!p || (state.phase !== 'freeze' && state.phase !== 'live')) return;
  if (kind === 'weapon') {
    const w = WEAPONS[key];
    if (p.weapon === key || state.money < w.price) return;
    state.money -= w.price;
    p.primary = key;
    giveWeapon(p, key);
  } else if (kind === 'grenade') {
    if (p.grenades >= 2 || state.money < GRENADE.price) return;
    state.money -= GRENADE.price;
    p.grenades++;
  } else if (kind === 'armor') {
    if (p.armor >= 100 || state.money < ARMOR.price) return;
    state.money -= ARMOR.price;
    p.armor = 100;
  }
  sfx.buy();
  hud.refreshBuy(state, p);
}

// --- teams ------------------------------------------------------------------

function spawnActors() {
  for (const a of state.actors) if (a.mesh) scene.remove(a.mesh);
  state.actors = [];
  state.grenades = [];
  state.noises = [];
  const emberSpawns = [[-27, 20], [-25, 21], [-24, 19], [-28, 21], [-26, 19]];
  const cinderSpawns = [[27, -20], [25, -21], [24, -19], [28, -21], [26, -19]];
  const player = createActor('ember', true, 'You', emberSpawns[0][0], emberSpawns[0][1], Math.atan2(-28, 18));
  player.primary = 'rifle';
  giveWeapon(player, 'pistol');
  player.grenades = 0;
  state.player = player;
  state.actors.push(player);
  const en = botNames('ember');
  const rolesE = ['pushA', 'pushA', 'pushB', 'pushMid'];
  for (let i = 0; i < 4; i++) {
    const b = createActor('ember', false, en[i], emberSpawns[i + 1][0], emberSpawns[i + 1][1], Math.atan2(-28, 18));
    giveWeapon(b, Math.random() < 0.6 ? 'rifle' : 'smg');
    makeBot(b, rolesE[i], 0);
    state.actors.push(b);
  }
  const cn = botNames('cinder');
  const rolesC = ['holdA', 'holdA', 'holdB', 'holdB', 'roam'];
  for (let i = 0; i < 5; i++) {
    const b = createActor('cinder', false, cn[i], cinderSpawns[i][0], cinderSpawns[i][1], Math.atan2(28, -18));
    giveWeapon(b, Math.random() < 0.6 ? 'rifle' : 'smg');
    makeBot(b, rolesC[i], i % 2);
    state.actors.push(b);
  }
  for (const a of state.actors) {
    if (!a.isPlayer) scene.add(buildActorMesh(a));
  }
  state.bomb = {
    state: 'carried', carrier: player, site: null, x: 0, z: 0,
    fuse: 35, plantProgress: 0, defuseProgress: 0, defuser: null, beepT: 0,
  };
}

function startMatch() {
  state.score = { ember: 0, cinder: 0 };
  state.round = 1;
  state.money = START_MONEY;
  state.stats = { shots: 0, hits: 0, kills: 0, deaths: 0, plants: 0, defuses: 0 };
  state.matchWinner = null;
  startRound();
}

function startRound() {
  spawnActors();
  state.phase = 'freeze';
  state.phaseT = 0;
  state.timer = ROUND_TIME;
  state.roundWinner = null;
  state.roundReason = '';
  state.buyOpen = false;
  hud.hideAll();
  feed(state, `Round ${state.round} — press B to buy, then deploy`, true);
}

function endRound(winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  const playerWon = winner === 'ember';
  state.money += playerWon ? 3250 : 1900;
  state.phase = 'roundEnd';
  state.phaseT = 0;
  document.exitPointerLock?.();
  hud.showRound(
    playerWon ? 'ROUND WON' : 'ROUND LOST',
    reason,
    `Ember ${state.score.ember} — ${state.score.cinder} Cinder · Round ${state.round}`,
  );
  if (playerWon) sfx.roundWin(); else sfx.roundLose();
}

function nextRound() {
  if (state.score.ember >= ROUNDS_TO_WIN || state.score.cinder >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
    state.matchWinner = state.score.ember > state.score.cinder ? 'ember' : state.score.ember < state.score.cinder ? 'cinder' : 'draw';
    state.phase = 'matchEnd';
    const title = state.matchWinner === 'ember' ? 'VICTORY' : state.matchWinner === 'cinder' ? 'DEFEAT' : 'DRAW';
    hud.showMatch(title, `Ember ${state.score.ember} — ${state.score.cinder} Cinder · ${state.stats.kills} eliminations`);
    return;
  }
  state.round++;
  startRound();
}

// --- fixed-step simulation ----------------------------------------------------

function updatePlayer(dt) {
  const p = state.player;
  if (!p || !p.alive) return;
  p.fireT = Math.max(0, p.fireT - dt);
  p.spread = Math.max(0, p.spread - dt * 0.05);
  p.recoil = Math.max(0, p.recoil - dt * 0.09);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p);
  }
  const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  p.crouch = keys.has('ControlLeft') || keys.has('KeyC');
  p.aiming = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = p.crouch ? CROUCH_SPEED : p.aiming ? AIM_SPEED : WALK_SPEED;
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * fwd + cy * str;
  let wz = -cy * fwd - sy * str;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  accelerate(p, wx, wz, speed, dt);
  moveActor(p, dt);
  // Footsteps.
  if (p.moving) {
    p.stepT -= dt * Math.hypot(p.vel.x, p.vel.z);
    if (p.stepT <= 0) { p.stepT = 2.4; sfx.step(); }
  }
  // Auto fire while held.
  if (firing && p.weapon && WEAPONS[p.weapon].auto) tryFire();
  // Plant: hold E, standing still, inside a site, carrying the charge.
  p.wantPlant = keys.has('KeyE') && state.bomb.carrier === p && state.bomb.state === 'carried';
}

function step(dt) {
  state.time += dt;
  state.phaseT += dt;
  // Prune old noise.
  while (state.noises.length && state.time - state.noises[0].t > 2) state.noises.shift();

  if (state.phase === 'freeze') {
    updatePlayer(dt);
    if (state.phaseT >= FREEZE_TIME - 1e-6) {
      state.phase = 'live';
      state.phaseT = 0;
      state.buyOpen = false;
      hud.hideAll();
      feed(state, 'Round live — plant the charge at Site A or B', true);
    }
    return;
  }
  if (state.phase !== 'live') return;

  state.timer -= dt;
  updatePlayer(dt);
  for (const a of state.actors) {
    if (!a.isPlayer) updateBot(state, a, dt, fx, () => {});
  }
  updateGrenades(state, dt, fx, (g) => {
    sfx.explosion();
    state.shake = Math.min(0.8, state.shake + 0.5);
    const p = state.player;
    if (p && p.alive) {
      const d = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
      if (d < 14) hud.damageFlash();
    }
  });
  updateBomb(state, dt);
  updateBombPickup(state);

  // Bomb beeps speed up as the fuse runs down.
  const b = state.bomb;
  if (b.state === 'planted') {
    b.beepT -= dt;
    if (b.beepT <= 0) {
      b.beepT = Math.max(0.3, b.fuse / 30);
      sfx.plantBeep(Math.round(b.fuse));
    }
  }

  // Win checks.
  if (state.roundWinner) { endRound(state.roundWinner, state.roundReason); return; }
  const emberAlive = aliveOf(state, 'ember');
  const cinderAlive = aliveOf(state, 'cinder');
  if (emberAlive === 0) {
    endRound('cinder', state.bomb.state === 'planted' ? 'Your team was eliminated after the plant' : 'Your team was eliminated');
    return;
  }
  if (cinderAlive === 0) {
    endRound('ember', state.bomb.state === 'planted' ? 'Enemy team eliminated — the charge will detonate' : 'Enemy team eliminated');
    return;
  }
  if (state.timer <= 0 && b.state !== 'planted') {
    endRound('cinder', 'Time expired before the plant');
  }
}

// --- rendering ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function render(now) {
  requestAnimationFrame(render);
  let frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state.phase === 'live' || state.phase === 'freeze' || state.phase === 'roundEnd') {
    acc += frameDt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      step(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0;
  }
  if (state.phase === 'roundEnd' && state.phaseT > 4.5) nextRound();

  // Camera.
  const p = state.player;
  if (state.phase === 'menu') {
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.08) * 20, 9 + Math.sin(t * 0.05) * 2, Math.cos(t * 0.08) * 16);
    camera.lookAt(0, 1, 0);
  } else if (p && p.alive) {
    camera.position.set(p.pos.x, eyeHeight(p), p.pos.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + p.recoil * 0.6;
    camera.rotation.z = 0;
    if (state.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * state.shake * 0.3;
      camera.position.y += (Math.random() - 0.5) * state.shake * 0.3;
      state.shake = Math.max(0, state.shake - frameDt * 1.8);
    }
  } else if (p) {
    // Spectate the first living teammate.
    const mate = state.actors.find((a) => a.alive && a.team === 'ember' && !a.isPlayer);
    if (mate) {
      const bx = mate.pos.x + Math.sin(mate.yaw) * 2.2, bz = mate.pos.z + Math.cos(mate.yaw) * 2.2;
      camera.position.set(bx, 2.6, bz);
      camera.lookAt(mate.pos.x, 1.4, mate.pos.z);
    }
  }

  // Viewmodel: bob with movement, kick with recoil, dip while reloading.
  const moving = p && p.moving && p.alive;
  const bobT = now / 1000 * 9;
  viewmodel.position.y = -0.24 + (moving ? Math.sin(bobT) * 0.012 : 0);
  viewmodel.position.x = 0.26 + (moving ? Math.cos(bobT * 0.5) * 0.006 : 0);
  viewmodel.position.z = -0.45 + (p ? p.recoil * 1.4 : 0);
  viewmodel.rotation.x = p && p.reloadT > 0 ? -0.5 : 0;
  viewmodel.visible = !!(p && p.alive && state.phase !== 'menu');

  for (const a of state.actors) if (!a.isPlayer) syncMesh(a, now / 1000);

  // Bomb mesh.
  const b = state.bomb;
  if (b.state === 'planted' || b.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(b.x, 0.12, b.z);
    bombLight.material.emissiveIntensity = b.state === 'planted' ? (Math.sin(now / 90) > 0 ? 2.5 : 0.2) : 0.6;
  } else {
    bombMesh.visible = false;
  }

  fx.update(frameDt);
  hud.update(state, p, frameDt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- staging hook (screenshots only): ?stage=action|end ---------------------
// Still the game itself rendering live state; it only picks a starting point.
const stage = new URLSearchParams(location.search).get('stage');
if (stage === 'action' || stage === 'end') {
  ensureAudio();
  startMatch();
  if (stage === 'action') {
    state.phase = 'live';
    state.phaseT = 0;
    const p = state.player;
    p.pos.x = -8; p.pos.z = 8; p.yaw = -Math.PI / 2; p.pitch = 0;
    giveWeapon(p, 'rifle');
    p.primary = 'rifle';
    const foe = state.actors.find((a) => a.team === 'cinder');
    if (foe) {
      foe.pos.x = 6; foe.pos.z = 8; foe.yaw = Math.PI / 2;
      foe.bot.role = 'holdA'; foe.bot.post = { x: 6, z: 8 }; foe.bot.state = 'hold';
    }
    const mate = state.actors.find((a) => a.team === 'ember' && !a.isPlayer);
    if (mate) {
      mate.pos.x = -5; mate.pos.z = 10;
      mate.bot.role = 'holdA'; mate.bot.post = { x: -5, z: 10 }; mate.bot.state = 'hold';
    }
    hud.hideAll();
  } else {
    endRound('ember', 'Enemy team eliminated');
  }
}

if (!stage) hud.showStart();
window.__emberline = {
  state, startMatch, nextRound,
  // Test hook: advance the fixed-step sim by N seconds without rendering.
  advance(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n; i++) step(STEP); },
};
requestAnimationFrame(render);
