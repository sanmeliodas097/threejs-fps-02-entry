// EMBERLINE — HUD: every DOM element is cached once; updates write only
// when a value changed. Buy menu, banners, kill feed, damage vignette and
// the round-end / match-end screens live here.
import { WEAPONS, GRENADE, ARMOR, BUY_LIST } from './weapons.js';
import { PHASE, TEAM } from './state.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('health-value'),
    healthBar: $('health-bar'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammo: $('ammo'),
    money: $('money-value'),
    timer: $('timer-value'),
    scoreEmber: $('score-ember'),
    scoreVanta: $('score-vanta'),
    aliveEmber: $('alive-ember'),
    aliveVanta: $('alive-vanta'),
    weapon: $('weapon-name'),
    grenades: $('grenade-count'),
    bomb: $('bomb-status'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    vignette: $('vignette'),
    roundLabel: $('round-label'),
  };
  const last = {};
  function set(key, element, text) {
    if (last[key] !== text) { last[key] = text; element.textContent = text; }
  }

  let onPlayCb = null;
  let onBuyCb = null;
  let onDeployCb = null;
  el.play.addEventListener('click', () => { if (onPlayCb) onPlayCb(); });
  const deployBtn = document.getElementById('deploy');
  if (deployBtn) deployBtn.addEventListener('click', () => { if (onDeployCb) onDeployCb(); });

  // build the buy menu once (keys 1-7 in BUY_LIST order)
  const items = [];
  for (let i = 0; i < BUY_LIST.length; i += 1) {
    const key = BUY_LIST[i];
    const def = key === 'grenade' ? GRENADE : key === 'armor' ? ARMOR : WEAPONS[key];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-item';
    row.dataset.item = key;
    row.innerHTML = `<b>[${i + 1}] ${def.name}</b><span>${def.price === 0 ? 'OWNED' : '$' + def.price}</span><i>${key === 'grenade' ? 'Frag grenade — press G to throw' : key === 'armor' ? 'Absorbs half of incoming damage' : key === 'pistol' ? 'Sidearm, always carried' : `${def.damage} dmg · ${def.mag} rounds`}</i>`;
    row.addEventListener('click', () => { if (onBuyCb) onBuyCb(key); });
    el.buyItems.appendChild(row);
    items.push({ key, row, price: def.price });
  }

  function showOverlay(kind) {
    el.overlay.hidden = false;
    if (kind === 'start') {
      el.overlayTitle.textContent = 'EMBERLINE';
      el.overlayCopy.textContent = 'Tactical strike in the Foundry Yard. Plant the charge at A or B — or eliminate the Vanta squad. Click to play.';
      el.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      el.overlayTitle.textContent = 'Paused';
      el.overlayCopy.textContent = 'Click to return to the round.';
      el.play.textContent = 'Resume';
    } else if (kind === 'match') {
      el.overlayTitle.textContent = 'Match over';
      el.overlayCopy.textContent = '';
      el.play.textContent = 'Play again';
    }
  }
  function hideOverlay() { el.overlay.hidden = true; }

  function banner(title, sub, tone) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.className = `show ${tone || ''}`;
    clearTimeout(banner._t);
    // in screenshot mode the banner must survive until the capture
    if (!new URLSearchParams(window.location.search).has('shot')) {
      banner._t = setTimeout(() => { el.banner.className = ''; }, 3400);
    }
  }

  function clearBanner() {
    clearTimeout(banner._t);
    el.banner.className = '';
  }

  function killfeed(text) {
    const div = document.createElement('div');
    div.textContent = text;
    el.killfeed.prepend(div);
    while (el.killfeed.children.length > 4) el.killfeed.removeChild(el.killfeed.lastChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 5000);
  }

  function hitmarker(kill) {
    el.hitmarker.classList.add('on');
    if (kill) el.hitmarker.classList.add('kill');
    setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), 110);
  }

  function damageFlash() {
    el.vignette.classList.add('hurt');
    setTimeout(() => el.vignette.classList.remove('hurt'), 220);
  }

  function setBuyOpen(open, money) {
    el.buyMenu.hidden = !open;
    if (open) set('buyMoney', el.buyMoney, '$' + money);
  }

  function refreshBuy(money, owned) {
    set('buyMoney', el.buyMoney, '$' + money);
    for (const it of items) {
      const afford = money >= it.price || it.price === 0;
      const isOwned = owned.has(it.key);
      it.row.classList.toggle('cant', !afford && !isOwned);
      it.row.classList.toggle('owned', isOwned);
    }
  }

  return {
    onPlay(cb) { onPlayCb = cb; },
    onBuy(cb) { onBuyCb = cb; },
    onDeploy(cb) { onDeployCb = cb; },
    showOverlay,
    hideOverlay,
    banner,
    clearBanner,
    killfeed,
    hitmarker,
    damageFlash,
    setBuyOpen,
    refreshBuy,
    setCrosshairSpread(px) {
      el.crosshair.style.setProperty('--gap', `${px}px`);
    },
    update(G, player, weapon) {
      const s = G.state;
      set('hp', el.health, `${Math.ceil(player.hp)}`);
      el.healthBar.style.width = `${Math.max(0, player.hp)}%`;
      set('armor', el.armor, `${Math.ceil(player.armor)}`);
      set('mag', el.ammoMag, `${weapon.mag}`);
      set('res', el.ammoReserve, `/ ${weapon.reserve}`);
      el.ammo.classList.toggle('empty', weapon.mag === 0);
      set('money', el.money, '$' + s.money);
      const t = Math.max(0, Math.ceil(s.timer));
      set('timer', el.timer, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      set('se', el.scoreEmber, `${s.score[TEAM.EMBER]}`);
      set('sv', el.scoreVanta, `${s.score[TEAM.VANTA]}`);
      set('round', el.roundLabel, `ROUND ${s.round} / ${s.maxRounds}`);
      const def = WEAPONS[weapon.current];
      set('wname', el.weapon, def.name);
      set('nades', el.grenades, `◉ ${weapon.grenades}`);
      const bomb = s.bomb;
      let bombText = '';
      if (bomb.state === 'planted') bombText = `CHARGE @ ${bomb.site} — ${Math.ceil(bomb.fuse)}s`;
      else if (bomb.state === 'defused') bombText = 'CHARGE DEFUSED';
      else if (bomb.state === 'detonated') bombText = 'CHARGE DETONATED';
      else if (s.phase === PHASE.LIVE) bombText = 'PLANT @ A / B — HOLD E';
      set('bomb', el.bomb, bombText);
      el.bomb.style.display = bombText ? '' : 'none';
      el.bomb.classList.toggle('alert', bomb.state === 'planted');
    },
    setAlive(ember, vanta) {
      set('ae', el.aliveEmber, `EMBER ${ember} ALIVE`);
      set('av', el.aliveVanta, `VANTA ${vanta} ALIVE`);
    },
  };
}
