// Emberline bots: waypoint navigation, perception, and fire discipline.
// Each bot has a role; defenders hold sites and rotate on a plant, attackers
// push lanes, and the carrier plants when the site is clear.
import { WAYPOINTS, nearestWaypoint, findPath, lineBlocked, inSite, siteAt } from './map.js';
import { fireWeapon, startReload, finishReload, throwGrenade } from './combat.js';
import { eyeHeight, accelerate, moveActor, WALK_SPEED, CROUCH_SPEED } from './actors.js';
import { dist2 } from './state.js';

const EMBER_NAMES = ['Vex', 'Rook', 'Iris', 'Moss'];
const CINDER_NAMES = ['Ash', 'Flint', 'Sable', 'Onyx', 'Cinder'];
const HOLD_SPOTS = { holdA: [3, 17], holdB: [11, 12] };
const ROAM_ROUTE = [7, 6, 8, 19, 20, 7];

export function makeBot(actor, role, spot) {
  actor.bot = {
    role, spot: spot || 0,
    path: [], pathI: 0, targetWp: -1,
    target: null, reactT: 0, seenT: -9,
    burstLeft: 0, burstPause: 0,
    perceiveT: Math.random() * 0.12,
    strafeDir: 1, strafeT: 0,
    stuckT: 0, lastX: actor.pos.x, lastZ: actor.pos.z,
    scanDir: 1, scanYaw: actor.yaw,
    roamI: 0, investigate: null, investigateT: 0,
  };
  return actor;
}

export function botNames(team) {
  return team === 'ember' ? EMBER_NAMES : CINDER_NAMES;
}

function canSee(state, a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 42 * 42) return false;
  const eyeA = eyeHeight(a), eyeB = eyeHeight(b);
  if (lineBlocked(a.pos.x, eyeA, a.pos.z, b.pos.x, eyeB, b.pos.z)) return false;
  return true;
}

function facingDot(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  return (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / l;
}

function setPath(bot, fromX, fromZ, toWp) {
  const from = nearestWaypoint(fromX, fromZ);
  bot.path = findPath(from, toWp);
  bot.pathI = 0;
  bot.targetWp = toWp;
}

function followPath(a, dt) {
  const bot = a.bot;
  if (bot.pathI >= bot.path.length) return false;
  const wp = WAYPOINTS[bot.path[bot.pathI]];
  const dx = wp[0] - a.pos.x, dz = wp[1] - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { bot.pathI++; return bot.pathI < bot.path.length; }
  const sp = a.crouch ? CROUCH_SPEED : WALK_SPEED * 0.82;
  accelerate(a, dx / d, dz / d, sp, dt);
  a.yaw = Math.atan2(-dx, -dz);
  return true;
}

function perceive(state, a, dt) {
  const bot = a.bot;
  bot.perceiveT -= dt;
  if (bot.perceiveT > 0) return;
  bot.perceiveT = 0.12;
  let best = null, bd = Infinity;
  for (const e of state.actors) {
    if (!e.alive || e.team === a.team) continue;
    const d2 = dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z);
    if (d2 < bd && canSee(state, a, e) && (facingDot(a, e) > -0.2 || d2 < 36)) {
      best = e; bd = d2;
    }
  }
  if (best) {
    if (bot.target !== best) {
      bot.target = best;
      bot.reactT = 0.25 + Math.random() * 0.3;
      bot.burstLeft = 0;
    }
    bot.seenT = state.time;
  } else if (bot.target && state.time - bot.seenT > 1.2) {
    bot.target = null;
  }
  // React to nearby gunfire.
  if (!bot.target) {
    for (const n of state.noises) {
      if (state.time - n.t < 1.2 && dist2(a.pos.x, a.pos.z, n.x, n.z) < n.r * n.r) {
        bot.investigate = { x: n.x, z: n.z };
        bot.investigateT = 2.5;
        break;
      }
    }
  }
}

function engage(state, a, dt, fx, onShot) {
  const bot = a.bot;
  const t = bot.target;
  if (!t || !t.alive) { bot.target = null; return false; }
  const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  const baseYaw = Math.atan2(-dx, -dz);
  const basePitch = Math.atan2(eyeHeight(t) - 0.25 - eyeHeight(a), dist);
  const err = 0.02 + dist * 0.0012 + (Math.hypot(t.vel.x, t.vel.z) > 1 ? 0.015 : 0);
  a.yaw = baseYaw + (Math.random() - 0.5) * err * 2;
  a.pitch = basePitch + (Math.random() - 0.5) * err * 2;
  bot.reactT -= dt;
  if (bot.reactT > 0) return true;
  // Strafe while firing.
  bot.strafeT -= dt;
  if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.5 + Math.random() * 0.7; }
  const rx = Math.cos(a.yaw) * bot.strafeDir, rz = -Math.sin(a.yaw) * bot.strafeDir;
  accelerate(a, rx, rz, WALK_SPEED * 0.45, dt);
  if (a.reloadT > 0) return true;
  if (a.mag <= 0) {
    if (!startReload(a)) {
      // Out of everything: fall back to the sidearm.
      if (a.weapon !== 'pistol') { a.weapon = 'pistol'; a.mag = 12; a.reserve = 36; }
    }
    return true;
  }
  if (bot.burstLeft <= 0) {
    bot.burstPause -= dt;
    if (bot.burstPause <= 0) {
      bot.burstLeft = 3 + Math.floor(Math.random() * 3);
      bot.burstPause = 0.45 + Math.random() * 0.5;
    } else return true;
  }
  if (a.fireT <= 0) {
    fireWeapon(state, a, fx, onShot);
    bot.burstLeft--;
  }
  return true;
}

function roleGoal(state, a) {
  const bot = a.bot;
  const bomb = state.bomb;
  // Defenders rotate to a planted bomb.
  if (a.team === 'cinder' && bomb.state === 'planted') {
    return bomb.site === 'A' ? 3 : 11;
  }
  // The carrier pushes its site; attackers follow their lane.
  if (a.team === 'ember') {
    if (bomb.state === 'dropped') return nearestWaypoint(bomb.x, bomb.z);
    if (bot.role === 'pushB') return 11;
    if (bot.role === 'pushMid') return 7;
    return 3;
  }
  if (bot.role === 'roam') return ROAM_ROUTE[bot.roamI % ROAM_ROUTE.length];
  if (bot.role === 'holdA' || bot.role === 'holdB') {
    return HOLD_SPOTS[bot.role][bot.spot % HOLD_SPOTS[bot.role].length];
  }
  return 7;
}

export function updateBot(state, a, dt, fx, onShot) {
  const bot = a.bot;
  if (!a.alive || !bot) return;
  a.fireT = Math.max(0, a.fireT - dt);
  a.spread = Math.max(0, a.spread - dt * 0.05);
  a.recoil = Math.max(0, a.recoil - dt * 0.09);
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) finishReload(a);
  }
  perceive(state, a, dt);

  // Planting: the carrier stops inside a site and holds still.
  const bomb = state.bomb;
  if (a.team === 'ember' && bomb.carrier === a && (bomb.state === 'carried')) {
    const site = siteAt(a.pos.x, a.pos.z);
    if (site && (!bot.target || state.time - bot.seenT > 1.5)) {
      a.wantPlant = true;
      a.vel.x = 0; a.vel.z = 0;
      moveActor(a, dt);
      return;
    }
  }
  a.wantPlant = false;

  // Defusing: a defender at the planted charge holds still.
  if (a.team === 'cinder' && bomb.state === 'planted') {
    const d = Math.sqrt(dist2(a.pos.x, a.pos.z, bomb.x, bomb.z));
    if (d < 2.0 && (!bot.target || state.time - bot.seenT > 1.5)) {
      a.wantDefuse = true;
      bomb.defuser = a;
      a.vel.x = 0; a.vel.z = 0;
      moveActor(a, dt);
      return;
    }
  }
  a.wantDefuse = false;

  // Fight first.
  if (bot.target && bot.target.alive) {
    if (engage(state, a, dt, fx, onShot)) {
      moveActor(a, dt);
      return;
    }
  }

  // Investigate a noise.
  if (bot.investigate) {
    bot.investigateT -= dt;
    const d = Math.hypot(bot.investigate.x - a.pos.x, bot.investigate.z - a.pos.z);
    if (d < 1.2 || bot.investigateT <= 0) { bot.investigate = null; }
    else {
      const goal = nearestWaypoint(bot.investigate.x, bot.investigate.z);
      if (bot.targetWp !== goal) setPath(bot, a.pos.x, a.pos.z, goal);
      if (!followPath(a, dt)) bot.investigate = null;
      moveActor(a, dt);
      return;
    }
  }

  const goal = roleGoal(state, a);
  const holding = (bot.role === 'holdA' || bot.role === 'holdB') && a.team === 'cinder';
  if (holding) {
    const wp = WAYPOINTS[goal];
    const d = Math.hypot(wp[0] - a.pos.x, wp[1] - a.pos.z);
    if (d > 1.2) {
      if (bot.targetWp !== goal) setPath(bot, a.pos.x, a.pos.z, goal);
      followPath(a, dt);
    } else {
      // Hold the angle: slow yaw sweep.
      bot.scanYaw += bot.scanDir * dt * 0.5;
      if (bot.scanYaw > 1.1 || bot.scanYaw < -1.1) bot.scanDir *= -1;
      const base = Math.atan2(-(wp[0] - 0), -(wp[1] - 0));
      a.yaw = base + bot.scanYaw * 0.4;
      a.vel.x = 0; a.vel.z = 0;
      a.crouch = Math.random() < 0.002 ? !a.crouch : a.crouch;
    }
    moveActor(a, dt);
    return;
  }
  if (bot.role === 'roam') {
    const wp = WAYPOINTS[goal];
    if (Math.hypot(wp[0] - a.pos.x, wp[1] - a.pos.z) < 1.2) bot.roamI++;
  }
  if (bot.targetWp !== goal || bot.pathI >= bot.path.length) setPath(bot, a.pos.x, a.pos.z, goal);
  followPath(a, dt);
  // Stuck? Shuffle sideways and repath.
  if (Math.hypot(a.pos.x - bot.lastX, a.pos.z - bot.lastZ) < 0.15) {
    bot.stuckT += dt;
    if (bot.stuckT > 1.2) {
      bot.stuckT = 0;
      bot.path = [];
      a.yaw += 1.2;
    }
  } else bot.stuckT = 0;
  bot.lastX = a.pos.x; bot.lastZ = a.pos.z;
  moveActor(a, dt);
}
