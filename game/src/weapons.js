// Emberline weapons: one table, no duplicated per-weapon code.
// damage is body damage at close range; head multiplies it; falloff past 30 m.
export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, auto: false, slot: 1,
    damage: 26, headMult: 2, rof: 0.26, mag: 12, reserve: 36, reload: 1.1,
    spread: 0.011, moveSpread: 0.020, bloom: 0.012, recoil: 0.011, kick: 0.35,
    range: 900, tracer: 0xffd27a, sound: 'pistol',
  },
  smg: {
    name: 'Hornet SMG', price: 1500, auto: true, slot: 2,
    damage: 22, headMult: 2, rof: 0.075, mag: 25, reserve: 100, reload: 1.6,
    spread: 0.016, moveSpread: 0.030, bloom: 0.014, recoil: 0.008, kick: 0.25,
    range: 900, tracer: 0xffd27a, sound: 'smg',
  },
  rifle: {
    name: 'VK-9 Repeater', price: 2700, auto: true, slot: 2,
    damage: 34, headMult: 2, rof: 0.10, mag: 30, reserve: 90, reload: 2.1,
    spread: 0.008, moveSpread: 0.028, bloom: 0.011, recoil: 0.014, kick: 0.5,
    range: 1200, tracer: 0xffc46b, sound: 'rifle',
  },
  dmr: {
    name: 'Longshot DMR', price: 4000, auto: false, slot: 2,
    damage: 88, headMult: 2, rof: 0.9, mag: 10, reserve: 30, reload: 2.6,
    spread: 0.002, moveSpread: 0.05, bloom: 0.02, recoil: 0.03, kick: 1.2,
    range: 1600, tracer: 0x9be8ff, sound: 'dmr',
  },
};

export const GRENADE = { name: 'Cinder Grenade', price: 300, damage: 110, radius: 6, fuse: 1.6 };
export const ARMOR = { name: 'Kevlar Vest', price: 650, absorb: 0.5 };
export const START_MONEY = 800;

export function weaponDamage(w, dist, head) {
  let d = w.damage * (head ? w.headMult : 1);
  if (dist > 30) d *= 0.75;
  return d;
}

// Apply armor: half the damage goes to armor first, the rest to health.
export function applyDamage(actor, dmg) {
  if (!actor.alive) return 0;
  let rest = dmg;
  if (actor.armor > 0) {
    const absorbed = Math.min(actor.armor, rest * ARMOR.absorb);
    actor.armor -= absorbed;
    rest -= absorbed;
  }
  actor.hp -= rest;
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.alive = false;
  }
  return rest;
}
