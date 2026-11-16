// Emberline combat: hitscan fire, grenades, and the bomb.
// All hit tests are segment-vs-AABB slab tests; nothing here allocates per shot.
import { segmentWallT, siteAt } from './map.js';
import { WEAPONS, GRENADE, weaponDamage, applyDamage } from './weapons.js';
import { eyeHeight, hitBoxes } from './actors.js';
import { feed, dist2 } from './state.js';

// Ray (origin + dir * t, t in [0, maxT]) vs an AABB. Returns t or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let t0 = 0, t1 = maxT;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mins = [b.x1, b.y1, b.z1], maxs = [b.x2, b.y2, b.z2];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return -1;
    } else {
      let ta = (mins[i] - o[i]) / d[i], tb = (maxs[i] - o[i]) / d[i];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

function aimDir(a, spread) {
  const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch);
  const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
  // Forward is -Z rotated by yaw; pitch raises it.
  let dx = -sy * cp, dy = sp, dz = -cy * cp;
  if (spread > 0) {
    const ang = Math.random() * Math.PI * 2;
    const r = (Math.random() + Math.random()) * 0.5 * spread;
    const rx = Math.cos(ang) * r, ry = Math.sin(ang) * r;
    // Perturb in the plane perpendicular to the view direction.
    const ux = cy, uz = -sy; // camera right (x,z)
    dx += ux * rx; dy += ry; dz += uz * rx;
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
  }
  return [dx, dy, dz];
}

export function damageActor(state, target, dmg, attacker, head) {
  if (!target.alive) return false;
  applyDamage(target, dmg);
  if (!target.alive) {
    const killer = attacker ? attacker.name : 'the yard';
    feed(state, `${killer} ▸ ${target.name}${head ? ' (headshot)' : ''}`, attacker === state.player);
    if (attacker === state.player) {
      state.money += 300;
      state.stats.kills++;
    }
    if (target === state.player) state.stats.deaths++;
    if (state.bomb.carrier === target) {
      state.bomb.state = 'dropped';
      state.bomb.carrier = null;
      state.bomb.x = target.pos.x;
      state.bomb.z = target.pos.z;
      feed(state, 'The spark charge was dropped', false);
    }
    return true;
  }
  return false;
}

// Fire one hitscan shot. Returns { hit, kill, head, x, y, z } or null on dry fire.
export function fireWeapon(state, a, fx, onShot) {
  const w = WEAPONS[a.weapon];
  if (a.reloadT > 0 || a.fireT > 0) return null;
  if (a.mag <= 0) {
    a.fireT = 0.25;
    onShot('dry', a);
    return null;
  }
  a.mag--;
  a.fireT = w.rof;
  a.lastShot = state.time;
  a.spread = Math.min(0.09, a.spread + w.bloom);
  a.recoil = Math.min(0.06, a.recoil + w.recoil);
  a.pitch += w.recoil * (0.7 + Math.random() * 0.6);
  a.yaw += (Math.random() - 0.5) * w.recoil * 0.5;

  const speed = Math.hypot(a.vel.x, a.vel.z);
  const spread = w.spread + w.moveSpread * Math.min(1, speed / 5.2) + a.spread;
  const ox = a.pos.x, oy = eyeHeight(a), oz = a.pos.z;
  const [dx, dy, dz] = aimDir(a, spread);
  const range = w.range;
  const ex = ox + dx * range, ey = oy + dy * range, ez = oz + dz * range;

  const wallT = segmentWallT(ox, oy, oz, dx * range, dy * range, dz * range);
  let bestT = wallT >= 0 ? wallT : 1;
  let bestActor = null, bestHead = false;
  for (const t of state.actors) {
    if (t === a || !t.alive) continue;
    const boxes = hitBoxes(t);
    const th = rayBox(ox, oy, oz, dx * range, dy * range, dz * range, boxes.head, 1);
    if (th >= 0 && th < bestT) { bestT = th; bestActor = t; bestHead = true; continue; }
    const tb = rayBox(ox, oy, oz, dx * range, dy * range, dz * range, boxes.body, 1);
    if (tb >= 0 && tb < bestT) { bestT = tb; bestActor = t; bestHead = false; }
  }
  const hx = ox + dx * range * bestT, hy = oy + dy * range * bestT, hz = oz + dz * range * bestT;
  const dist = range * bestT;
  // Muzzle point: just ahead and to the right of the eye.
  const mx = ox - Math.sin(a.yaw) * 0.5 + Math.cos(a.yaw) * 0.18;
  const mz = oz - Math.cos(a.yaw) * 0.5 - Math.sin(a.yaw) * 0.18;
  fx.tracer(mx, oy - 0.18, mz, hx, hy, hz);
  fx.muzzle(mx, oy - 0.15, mz);
  if (bestActor) {
    const dmg = weaponDamage(w, dist, bestHead);
    const killed = damageActor(state, bestActor, dmg, a, bestHead);
    fx.spark(hx, hy, hz);
    onShot('hit', a, { target: bestActor, kill: killed, head: bestHead, dist });
    return { hit: true, kill: killed, head: bestHead, x: hx, y: hy, z: hz };
  }
  if (wallT >= 0) fx.spark(hx, hy, hz);
  onShot('shot', a, { dist });
  return { hit: false, kill: false, head: false, x: hx, y: hy, z: hz };
}

export function startReload(a) {
  const w = WEAPONS[a.weapon];
  if (a.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  a.reloadT = w.reload;
  return true;
}

export function finishReload(a) {
  const w = WEAPONS[a.weapon];
  const need = w.mag - a.mag;
  const take = Math.min(need, a.reserve);
  a.mag += take;
  a.reserve -= take;
}

export function throwGrenade(state, a) {
  if (a.grenades <= 0) return false;
  a.grenades--;
  const cp = Math.cos(a.pitch), sp = Math.sin(a.pitch);
  const f = 13;
  state.grenades.push({
    x: a.pos.x, y: eyeHeight(a), z: a.pos.z,
    vx: -Math.sin(a.yaw) * cp * f, vy: sp * f + 3.5, vz: -Math.cos(a.yaw) * cp * f,
    fuse: GRENADE.fuse, owner: a,
  });
  return true;
}

export function updateGrenades(state, dt, fx, onExplode) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.vy -= 18 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.08) { g.y = 0.08; g.vy = -g.vy * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
    const t = segmentWallT(g.x, g.y, g.z, g.vx * dt, g.vy * dt, g.vz * dt);
    if (t >= 0) { g.vx *= -0.35; g.vz *= -0.35; g.vy *= 0.4; }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      fx.explosion(g.x, g.y, g.z);
      onExplode(g);
      for (const a of state.actors) {
        if (!a.alive) continue;
        const d = Math.sqrt(dist2(a.pos.x, a.pos.z, g.x, g.z) + (eyeHeight(a) - g.y) ** 2);
        if (d < GRENADE.radius) {
          const dmg = GRENADE.damage * (1 - d / (GRENADE.radius * 1.4));
          damageActor(state, a, dmg, g.owner, false);
        }
      }
      state.grenades.splice(i, 1);
    }
  }
}

// Bomb plant / defuse progress and the fuse. Sets roundWinner on detonation/defuse.
export function updateBomb(state, dt) {
  const b = state.bomb;
  if (b.state === 'planted') {
    b.fuse -= dt;
    b.beepT -= dt;
    if (b.beepT <= 0) {
      b.beepT = Math.max(0.25, b.fuse / 35);
      if (state.player && state.player.alive) state.bomb.beep = (state.bomb.beep || 0) + 1;
    }
    if (b.fuse <= 0) {
      b.state = 'detonated';
      state.roundWinner = 'ember';
      state.roundReason = 'The charge detonated at Site ' + b.site;
    }
    return;
  }
  // Planting: the carrier holds E inside a site.
  const carrier = b.carrier;
  if ((b.state === 'carried' || b.state === 'dropped') && carrier && carrier.alive && carrier.wantPlant) {
    const site = siteAt(carrier.pos.x, carrier.pos.z);
    if (site && !carrier.moving) {
      b.plantProgress += dt;
      if (b.plantProgress >= 3.0) {
        b.state = 'planted';
        b.site = site;
        b.x = carrier.pos.x; b.z = carrier.pos.z;
        b.fuse = 35;
        b.plantProgress = 0;
        state.stats.plants += carrier === state.player ? 1 : 0;
        if (carrier === state.player) state.money += 300;
        feed(state, `Charge planted at Site ${site}`, carrier === state.player);
      }
    } else {
      b.plantProgress = Math.max(0, b.plantProgress - dt * 2);
    }
  }
  // Defusing: a defender holds E near the planted charge.
  if (b.state === 'planted' && b.defuser && b.defuser.alive && b.defuser.wantDefuse) {
    const d = Math.sqrt(dist2(b.defuser.pos.x, b.defuser.pos.z, b.x, b.z));
    if (d < 2.2 && !b.defuser.moving) {
      b.defuseProgress += dt;
      if (b.defuseProgress >= 5.0) {
        b.state = 'defused';
        state.roundWinner = 'cinder';
        state.roundReason = 'The charge was defused';
        if (b.defuser === state.player) { state.money += 300; state.stats.defuses++; }
      }
    } else {
      b.defuseProgress = Math.max(0, b.defuseProgress - dt * 2);
    }
  }
}

// The bomb drops where the carrier fell; a friendly bot can pick it up.
export function updateBombPickup(state) {
  const b = state.bomb;
  if (b.state !== 'dropped') return;
  for (const a of state.actors) {
    if (!a.alive || a.team !== 'ember' || a.isPlayer) continue;
    if (dist2(a.pos.x, a.pos.z, b.x, b.z) < 1.2) {
      b.state = 'carried';
      b.carrier = a;
      feed(state, `${a.name} picked up the charge`, false);
      return;
    }
  }
  const p = state.player;
  if (p && p.alive && dist2(p.pos.x, p.pos.z, b.x, b.z) < 1.2) {
    b.state = 'carried';
    b.carrier = p;
    feed(state, 'You picked up the charge', true);
  }
}
