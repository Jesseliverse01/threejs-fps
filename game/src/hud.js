// Emberline HUD: DOM health/ammo/timer/score, killfeed, crosshair, and menus.
// The sim never touches the DOM directly; main.js calls hud.update each frame.
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';

function el(id) { return document.getElementById(id); }

export function createHud(cb) {
  const cache = {};
  const setText = (id, v) => {
    if (cache[id] !== v) { cache[id] = v; const n = el(id); if (n) n.textContent = v; }
  };
  const setWidth = (id, v) => {
    if (cache[id] !== v) { cache[id] = v; const n = el(id); if (n) n.style.width = v; }
  };

  // Build the buy menu once.
  const items = el('buy-items');
  const defs = [
    { kind: 'weapon', key: 'rifle' }, { kind: 'weapon', key: 'smg' },
    { kind: 'weapon', key: 'dmr' }, { kind: 'grenade', key: 'grenade' },
    { kind: 'armor', key: 'armor' },
  ];
  for (const d of defs) {
    const w = d.kind === 'weapon' ? WEAPONS[d.key] : d.kind === 'grenade' ? GRENADE : ARMOR;
    const div = document.createElement('div');
    div.className = 'buy-item';
    div.dataset.kind = d.kind;
    div.dataset.key = d.key;
    div.innerHTML = `<b>${w.name}</b><span>$${w.price}</span><i>${buyDesc(d)}</i>`;
    div.addEventListener('click', () => cb.onBuy(d.kind, d.key));
    items.appendChild(div);
  }
  function buyDesc(d) {
    if (d.kind === 'weapon') {
      const w = WEAPONS[d.key];
      return `${w.damage} dmg · ${w.mag} rounds · ${w.auto ? 'auto' : 'semi'}`;
    }
    if (d.kind === 'grenade') return 'Thrown explosive · 110 dmg';
    return 'Absorbs half of damage taken';
  }

  el('btn-start').addEventListener('click', () => cb.onStart());
  el('btn-next').addEventListener('click', () => cb.onNextRound());
  el('btn-restart').addEventListener('click', () => cb.onRestart());
  el('btn-resume').addEventListener('click', () => cb.onResume());
  el('btn-close-buy').addEventListener('click', () => cb.onCloseBuy());

  let hitTimer = 0;
  let dmgTimer = 0;

  const hud = {
    update(state, p, dt) {
      if (hitTimer > 0) {
        hitTimer -= dt;
        if (hitTimer <= 0) el('hitmarker').classList.remove('on');
      }
      if (dmgTimer > 0) {
        dmgTimer -= dt;
        el('vignette').style.opacity = String(Math.min(0.85, dmgTimer * 1.6));
        if (dmgTimer <= 0) el('vignette').style.opacity = '0';
      }
      if (!p) return;
      setText('health-num', String(Math.ceil(p.hp)));
      setWidth('health-fill', `${Math.max(0, p.hp)}%`);
      setText('armor-num', p.armor > 0 ? `+${Math.ceil(p.armor)}` : '');
      const w = WEAPONS[p.weapon];
      setText('ammo-mag', String(p.mag));
      setText('ammo-reserve', `/ ${p.reserve}`);
      setText('weapon-name', w.name + (p.grenades > 0 ? ` · ◉ ${p.grenades}` : ''));
      el('ammo').classList.toggle('empty', p.mag === 0);
      setText('money', `$${state.money}`);
      const t = Math.max(0, Math.ceil(state.timer));
      setText('timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      setText('score-ember', String(state.score.ember));
      setText('score-cinder', String(state.score.cinder));
      const ae = state.actors.filter((a) => a.alive && a.team === 'ember').length;
      const ac = state.actors.filter((a) => a.alive && a.team === 'cinder').length;
      setText('alive-ember', '●'.repeat(ae) + '○'.repeat(5 - ae));
      setText('alive-cinder', '●'.repeat(ac) + '○'.repeat(5 - ac));
      setText('round-label', `ROUND ${state.round}`);
      const b = state.bomb;
      let bombTxt = '';
      if (b.state === 'carried' && b.carrier === p) bombTxt = '◈ YOU CARRY THE CHARGE — hold E at a site';
      else if (b.state === 'planted') bombTxt = `◈ CHARGE PLANTED — Site ${b.site} · ${Math.ceil(b.fuse)}s`;
      else if (b.state === 'dropped') bombTxt = '◈ CHARGE DROPPED — pick it up';
      setText('bomb-status', bombTxt);
      // Plant / defuse progress.
      const prog = b.plantProgress > 0 ? b.plantProgress / 3 : b.defuseProgress > 0 ? b.defuseProgress / 5 : 0;
      const bar = el('plant-bar');
      if (prog > 0) {
        bar.hidden = false;
        el('plant-fill').style.width = `${Math.round(prog * 100)}%`;
        setText('plant-label', b.plantProgress > 0 ? 'PLANTING…' : 'DEFUSING…');
      } else bar.hidden = true;
      // Killfeed.
      const feedEl = el('feed');
      const html = state.feed.slice(-5).map((f) => `<div class="${f.good ? 'good' : ''}">${f.text}</div>`).join('');
      if (cache.feed !== html) { cache.feed = html; feedEl.innerHTML = html; }
      // Crosshair spread.
      const gap = 3 + p.spread * 260 + (p.moving ? 4 : 0);
      el('crosshair').style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    flashHit(kill) {
      const h = el('hitmarker');
      h.classList.add('on');
      h.classList.toggle('kill', !!kill);
      hitTimer = kill ? 0.35 : 0.15;
    },
    damageFlash() { dmgTimer = 0.5; },
    show(id) {
      for (const o of ['overlay-start', 'overlay-buy', 'overlay-round', 'overlay-match', 'overlay-pause']) {
        el(o).hidden = o !== id;
      }
    },
    hideAll() { hud.show(null); },
    showStart() { hud.show('overlay-start'); },
    showBuy(money) {
      setText('buy-money', `$${money}`);
      hud.show('overlay-buy');
    },
    showRound(title, reason, score) {
      setText('round-title', title);
      setText('round-reason', reason);
      setText('round-score', score);
      hud.show('overlay-round');
    },
    showMatch(title, score) {
      setText('match-title', title);
      setText('match-score', score);
      hud.show('overlay-match');
    },
    showPause() { hud.show('overlay-pause'); },
    refreshBuy(state, p) {
      setText('buy-money', `$${state.money}`);
      for (const div of items.children) {
        const kind = div.dataset.kind, key = div.dataset.key;
        const price = kind === 'weapon' ? WEAPONS[key].price : kind === 'grenade' ? GRENADE.price : ARMOR.price;
        const owned = kind === 'weapon' ? p.weapon === key : kind === 'armor' ? p.armor >= 100 : false;
        div.classList.toggle('cant', state.money < price && !owned);
        div.classList.toggle('owned', owned);
      }
    },
  };
  return hud;
}
