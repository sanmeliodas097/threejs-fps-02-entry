// EMBERLINE — boot and the one loop. A fixed 60 Hz simulation (player,
// bots, rounds, grenades) feeds rendering at the display rate. main.js is
// the only module that knows every other module; the rest talk through the
// game context G and the single state store.
import * as THREE from 'three';
import { createGameState, mulberry32, PHASE, TEAM, clamp } from './state.js';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createPlayer, EYE_STAND } from './player.js';
import { createBots } from './bots.js';
import { createRounds, PLANT_SECONDS, DEFUSE_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import {
  WEAPONS, GRENADE, ARMOR, createWeaponSet, currentSpread, tryFire,
  startReload, finishReload,
} from './weapons.js';
import { rayWalls, rayBody, applyDamage, losClear } from './combat.js';
import { sfx, unlockAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = mulberry32(seed);

const state = createGameState();
const fx = createRenderer(document.getElementById('game'));
const { scene, camera } = fx;
const world = createWorld(scene);
const player = createPlayer(world.colliders);
const botsApi = createBots(scene, world, state, rng);
const hud = createHud();
const input = createInput(fx.renderer.domElement, onLockChange);
const weapon = createWeaponSet();
const owned = new Set(['pistol']);
const perWeapon = { pistol: { mag: 12, reserve: 48 } };
let grenade = null; // {pos, vel, fuse} or null
let prevFiring = false;
let plantHold = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let started = false;

state.player = player.state;

// ---- game context handed to the bots ----
const G = {
  state,
  world,
  player,
  bots: botsApi.bots,
  fx,
  onPlayerDamaged(dmg) {
    if (player.state.hp > 0) { hud.damageFlash(); sfx.hurt(); }
  },
  onPlayerKilled(killer) {
    state.deaths += 1;
    hud.killfeed(`${killer.name} ▸ You`);
    hud.banner('ELIMINATED', `${killer.name} took you down — your squad fights on`, 'bad');
    input.releaseLock();
  },
  onBotKilled(victim, killer, headshot) {
    const vName = victim.name || 'You';
    const kName = killer === player.state ? 'You' : killer.name;
    hud.killfeed(`${kName} ▸ ${vName}${headshot ? ' (headshot)' : ''}`);
    if (killer === player.state) {
      state.kills += 1;
      state.money += 300;
      hud.hitmarker(true);
      sfx.kill();
    }
    if (victim.isCarrier) {
      victim.isCarrier = false;
      const next = botsApi.bots.find((b) => b.alive && b.team === TEAM.EMBER);
      if (next) next.isCarrier = true;
    }
  },
  onBombPlanted(site, by) {
    rounds.plant(site);
    hud.banner('CHARGE PLANTED', `at site ${site} — hold it for ${40}s`, 'alert');
    sfx.bombBeep();
  },
  onBombDefused(by) {
    rounds.defuse();
    rounds.endRound(TEAM.VANTA, 'charge defused');
  },
};

const rounds = createRounds(state, {
  onRoundStart(round) {
    // reset positions, refill ammo, open the buy menu
    const spawns = world.spawns.ember;
    player.reset(spawns[0][0], spawns[0][1], 0);
    botsApi.resetRound(state);
    for (const key of owned) {
      const def = WEAPONS[key];
      perWeapon[key] = { mag: def.mag, reserve: def.reserve };
    }
    weapon.current = owned.has('rifle') ? 'rifle' : owned.has('smg') ? 'smg' : owned.has('shotgun') ? 'shotgun' : owned.has('sniper') ? 'sniper' : 'pistol';
    const w = perWeapon[weapon.current];
    weapon.mag = w.mag;
    weapon.reserve = w.reserve;
    weapon.grenades = owned.has('grenade') ? Math.max(weapon.grenades, 1) : weapon.grenades;
    weapon.reloading = 0;
    weapon.bloom = 0;
    plantHold = 0;
    fx.buildGun(weapon.current);
    grenade = null;
    hud.setBuyOpen(true, state.money);
    hud.refreshBuy(state.money, owned);
    hud.setAlive(5, 5);
    hud.banner(`ROUND ${round}`, 'Buy phase — press B for the buy menu', '');
  },
  onRoundEnd(winner, reason) {
    const won = winner === TEAM.EMBER;
    hud.setBuyOpen(false, state.money);
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won ? 'good' : 'bad');
    hud.setAlive(aliveCount(TEAM.EMBER), aliveCount(TEAM.VANTA));
  },
  onMatchEnd(winner) {
    const won = winner === TEAM.EMBER;
    hud.showOverlay('match');
    document.getElementById('overlay-title').textContent = won ? 'EMBERLINE — MATCH WON' : 'MATCH LOST';
    document.getElementById('overlay-copy').textContent = `Final score Ember ${state.score[TEAM.EMBER]} — ${state.score[TEAM.VANTA]} Vanta.`;
    input.releaseLock();
  },
  onPlant() {},
  onDefuse() {},
  onLive() {
    hud.setBuyOpen(false, state.money);
  },
  onDetonate(site) {
    const s = world.sites[site];
    fx.explosion(s.x, 0, s.z);
    sfx.explosion();
  },
  onBuy(item) {
    if (item === 'grenade') {
      weapon.grenades += 1;
      owned.add('grenade');
      return;
    }
    if (item === 'armor') {
      player.state.armor = Math.min(100, player.state.armor + ARMOR.value);
      owned.add('armor');
      return;
    }
    owned.add(item);
    perWeapon[item] = { mag: WEAPONS[item].mag, reserve: WEAPONS[item].reserve };
    switchWeapon(item);
  },
});

function aliveCount(team) {
  let n = botsApi.aliveCount(team);
  if (team === TEAM.EMBER && player.state.alive) n += 1;
  return n;
}

function switchWeapon(key) {
  if (!owned.has(key) || !WEAPONS[key]) return;
  const cur = perWeapon[weapon.current];
  if (cur) { cur.mag = weapon.mag; cur.reserve = weapon.reserve; }
  weapon.current = key;
  const w = perWeapon[key];
  weapon.mag = w.mag;
  weapon.reserve = w.reserve;
  weapon.reloading = 0;
  weapon.bloom = 0;
  fx.buildGun(key);
}

// ---- player shooting ----
const dirVec = new THREE.Vector3();
function shoot(now) {
  const def = WEAPONS[weapon.current];
  if (!tryFire(weapon, def, now)) {
    if (weapon.mag === 0) sfx.dryFire();
    return;
  }
  const p = player.state;
  camera.getWorldDirection(dirVec);
  const spread = currentSpread(weapon, def, p.speed, p.crouched);
  const pellets = def.pellets || 1;
  const muzzle = { x: 0, y: 0, z: 0 };
  camera.getWorldPosition(dirVec);
  muzzle.x = dirVec.x; muzzle.y = dirVec.y; muzzle.z = dirVec.z;
  camera.getWorldDirection(dirVec);
  const ox = muzzle.x;
  const oy = muzzle.y;
  const oz = muzzle.z;
  let anyHit = false;
  let anyKill = false;
  for (let i = 0; i < pellets; i += 1) {
    const dx = dirVec.x + (rng() * 2 - 1) * spread;
    const dy = dirVec.y + (rng() * 2 - 1) * spread;
    const dz = dirVec.z + (rng() * 2 - 1) * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const wallT = rayWalls(world.colliders, ox, oy, oz, nx, ny, nz, def.range);
    let bestBot = null;
    let bestHit = null;
    for (const b of botsApi.bots) {
      if (!b.alive || b.team === TEAM.EMBER) continue;
      const hit = rayBody(ox, oy, oz, nx, ny, nz, Math.min(wallT, def.range), b.pos.x, b.pos.z, false);
      if (hit && (!bestHit || hit.dist < bestHit.dist)) { bestHit = hit; bestBot = b; }
    }
    const endT = bestHit ? bestHit.dist : wallT;
    const ex = ox + nx * endT;
    const ey = oy + ny * endT;
    const ez = oz + nz * endT;
    fx.tracer(muzzle, { x: ex, y: ey, z: ez });
    if (bestBot) {
      const dist = bestHit.dist;
      const falloff = dist > def.range * 0.5 ? def.falloff : 1;
      const dmg = def.damage * falloff * (bestHit.part === 'head' ? def.headMult : bestHit.part === 'legs' ? 0.75 : 1);
      const died = applyDamage(bestBot, dmg);
      anyHit = true;
      fx.impact(ex, ey, ez);
      if (died) { anyKill = true; G.onBotKilled(bestBot, player.state, bestHit.part === 'head'); }
    } else if (wallT < def.range) {
      fx.impact(ex, ey, ez);
    }
  }
  fx.muzzle(ox + dirVec.x * 0.6, oy + dirVec.y * 0.6 - 0.08, oz + dirVec.z * 0.6);
  fx.kickViewmodel(def.kick);
  player.kick(def.recoil, (rng() * 2 - 1) * def.recoil * 0.4);
  sfx.shot(def.kind);
  botsApi.hearShot(p.x, p.z, TEAM.EMBER);
  if (anyHit && !anyKill) { hud.hitmarker(false); sfx.hit(); }
  hud.update(G, player.state, weapon);
}

function throwGrenade() {
  if (weapon.grenades <= 0 || grenade) return;
  weapon.grenades -= 1;
  const p = player.state;
  camera.getWorldDirection(dirVec);
  grenade = {
    pos: new THREE.Vector3(p.pos.x, p.pos.y + p.eye - 0.2, p.pos.z),
    vel: new THREE.Vector3(dirVec.x * 16, dirVec.y * 16 + 3.5, dirVec.z * 16),
    fuse: 1.6,
  };
  sfx.grenadePin();
}

function stepGrenade(dt) {
  if (!grenade) return;
  grenade.fuse -= dt;
  grenade.vel.y -= 13 * dt;
  const np = grenade.pos;
  const next = { x: np.x + grenade.vel.x * dt, y: np.y + grenade.vel.y * dt, z: np.z + grenade.vel.z * dt };
  // point vs boxes: bounce off the face we hit
  let bounced = false;
  for (const c of world.colliders) {
    if (next.x > c.minX && next.x < c.maxX && next.y > c.minY && next.y < c.maxY && next.z > c.minZ && next.z < c.maxZ) {
      const px = Math.min(next.x - c.minX, c.maxX - next.x);
      const py = Math.min(next.y - c.minY, c.maxY - next.y);
      const pz = Math.min(next.z - c.minZ, c.maxZ - next.z);
      if (px < py && px < pz) { grenade.vel.x *= -0.4; next.x = np.x; }
      else if (py < pz) { grenade.vel.y *= -0.4; next.y = np.y; }
      else { grenade.vel.z *= -0.4; next.z = np.z; }
      bounced = true;
    }
  }
  if (next.y < 0.05) { next.y = 0.05; grenade.vel.y *= -0.35; bounced = true; }
  np.set(next.x, next.y, next.z);
  if (bounced && Math.abs(grenade.vel.x) + Math.abs(grenade.vel.y) + Math.abs(grenade.vel.z) > 2) sfx.bounce();
  if (grenade.fuse <= 0) {
    const { x, y, z } = grenade.pos;
    fx.explosion(x, y, z);
    sfx.explosion();
    const victims = [...botsApi.bots];
    for (const b of victims) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < GRENADE.radius) {
        const dmg = GRENADE.damage * (1 - d / GRENADE.radius);
        if (applyDamage(b, dmg)) G.onBotKilled(b, player.state, false);
      }
    }
    const pd = Math.hypot(player.state.pos.x - x, player.state.pos.z - z);
    if (pd < GRENADE.radius && player.state.alive) {
      const dmg = GRENADE.damage * 0.6 * (1 - pd / GRENADE.radius);
      if (applyDamage(player.state, dmg)) G.onPlayerKilled({ name: 'your own Spark' });
    }
    grenade = null;
  }
}

function tryPlant(dt, keys) {
  const bomb = state.bomb;
  if (bomb.state !== 'idle' || state.phase !== PHASE.LIVE) { plantHold = 0; return; }
  const p = player.state;
  if (!p.alive) return;
  let near = null;
  for (const site of ['A', 'B']) {
    const s = world.sites[site];
    if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) { near = site; break; }
  }
  if (!near || !keys.has('KeyE')) { plantHold = 0; return; }
  plantHold += dt;
  bomb.plantProgress = plantHold / PLANT_SECONDS;
  if (Math.floor(plantHold * 2) !== Math.floor((plantHold - dt) * 2)) sfx.plantBeep();
  if (plantHold >= PLANT_SECONDS) {
    plantHold = 0;
    G.onBombPlanted(near, player.state);
  }
}

// ---- fixed simulation step ----
function step(dt) {
  state.time += dt;
  const p = player.state;
  const keys = input.state.keys;

  // buy-phase keys: 1-7 buy in BUY_LIST order (rifle, smg, shotgun, sniper, pistol, grenade, armor)
  if (state.phase === PHASE.BUY) {
    if (keys.has('KeyB')) { hud.setBuyOpen(true, state.money); hud.refreshBuy(state.money, owned); }
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];
    const buyList = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'grenade', 'armor'];
    for (let i = 0; i < buyKeys.length; i += 1) {
      if (keys.has(buyKeys[i])) {
        keys.delete(buyKeys[i]);
        if (rounds.buy(buyList[i])) hud.refreshBuy(state.money, owned);
      }
    }
  }
  if (state.phase === PHASE.LIVE) {
    if (keys.has('Digit1')) switchWeapon('pistol');
    if (keys.has('Digit2')) switchWeapon(owned.has('rifle') ? 'rifle' : 'smg');
    if (keys.has('Digit3')) switchWeapon('shotgun');
    if (keys.has('Digit4')) switchWeapon('sniper');
  }
  if (keys.has('KeyR') && state.phase === PHASE.LIVE) {
    const def = WEAPONS[weapon.current];
    if (startReload(weapon, def)) { sfx.reload(); fx.reloadDip(); }
  }
  if (keys.has('KeyG') && state.phase === PHASE.LIVE) throwGrenade();

  // movement works in buy and live phases; combat only when live
  if ((state.phase === PHASE.LIVE || state.phase === PHASE.BUY) && p.alive) {
    const stepped = player.step(dt, keys);
    if (stepped) sfx.step();
    // recoil decay
    p.recoilPitch = Math.max(0, p.recoilPitch - dt * 0.09);
    p.recoilYaw *= Math.max(0, 1 - dt * 8);
  }
  if (state.phase === PHASE.LIVE && p.alive) {
    // firing
    const firing = input.state.firing;
    const def = WEAPONS[weapon.current];
    if (firing && (def.auto || !prevFiring)) shoot(state.time);
    prevFiring = firing;
    // reload progress
    if (weapon.reloading > 0) {
      weapon.reloading -= dt;
      if (weapon.reloading <= 0) finishReload(weapon, def);
    }
    weapon.bloom = Math.max(0, weapon.bloom - dt * 0.06);
    tryPlant(dt, keys);
    stepGrenade(dt);
  }

  botsApi.step(dt, G);
  rounds.step(dt, { ember: aliveCount(TEAM.EMBER), vanta: aliveCount(TEAM.VANTA) });

  // bomb beeps while planted
  if (state.bomb.state === 'planted' && Math.floor(state.time * 1.4) !== Math.floor((state.time - dt) * 1.4)) sfx.bombBeep();

  hud.setAlive(aliveCount(TEAM.EMBER), aliveCount(TEAM.VANTA));
}

function syncCamera() {
  const p = player.state;
  fx.setCamera(
    p.pos.x,
    p.pos.y + p.eye,
    p.pos.z,
    p.yaw + p.recoilYaw,
    p.pitch + p.recoilPitch,
  );
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (input.state.locked) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    fx.update(dt, player.state.speed, state.time);
    hud.update(G, player.state, weapon);
    const spreadPx = currentSpread(weapon, WEAPONS[weapon.current], player.state.speed, player.state.crouched) * 2600;
    hud.setCrosshairSpread(4 + Math.min(26, spreadPx));
  }
  fx.renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.setBuyOpen(false, state.money);
    unlockAudio();
  } else if (state.phase === PHASE.MATCH_END) {
    // match overlay stays
  } else if (state.phase === PHASE.BUY) {
    hud.showOverlay('start');
    document.getElementById('overlay-title').textContent = 'BUY PHASE';
    document.getElementById('overlay-copy').textContent = 'Spend your money — press 1–7 to buy, or click DEPLOY to start the round.';
    document.getElementById('play').textContent = 'Deploy';
  } else if (started) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  unlockAudio();
  if (state.phase === PHASE.MENU || state.phase === PHASE.MATCH_END) {
    if (state.phase === PHASE.MATCH_END) {
      state.score = [0, 0];
      state.round = 1;
      state.money = 800;
      state.lossStreak = 0;
      state.kills = 0;
      state.deaths = 0;
      owned.clear();
      owned.add('pistol');
      weapon.grenades = 0;
    }
    rounds.startBuy();
  }
  input.requestLock();
});

hud.onBuy((item) => {
  if (rounds.buy(item)) hud.refreshBuy(state.money, owned);
});

hud.onDeploy(() => {
  hud.setBuyOpen(false, state.money);
  hud.hideOverlay();
  input.requestLock();
});

// Debug hook for automated playtests (not part of the game UI).
window.__ember = {
  state, player: player.state, bots: botsApi.bots, weapon, owned,
  step(n) { for (let i = 0; i < n; i += 1) step(FIXED_STEP); syncCamera(); },
  aimAt(x, y, z) { aimAt(x, y, z); },
  fire() { if (state.phase === PHASE.LIVE) shoot(state.time); },
};

window.addEventListener('resize', () => fx.resize());

// ---- deterministic screenshot setups (?shot=start|play|buy|end) ----
function settle(n) { for (let i = 0; i < n; i += 1) step(FIXED_STEP); }

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    // decay muzzle flash / tracers a little so the capture is clean but alive
    fx.update(0.02, 0, state.time);
    fx.renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(x, y, z) {
  const p = player.state;
  const dx = x - p.pos.x;
  const dy = y - (p.pos.y + p.eye);
  const dz = z - p.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(clamp(dy / len, -1, 1));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.setBuyOpen(false, state.money);
  rounds.startBuy();
  if (name === 'start') {
    player.reset(0, 24, 0);
    settle(10);
    aimAt(0, 1.5, -10);
    hud.showOverlay('start');
  } else if (name === 'buy') {
    player.reset(0, 24, 0);
    state.money = 5400;
    settle(10);
    aimAt(0, 1.5, -10);
    hud.setBuyOpen(true, state.money);
    hud.refreshBuy(state.money, owned);
  } else if (name === 'play' || name === 'end') {
    rounds.startLive();
    hud.clearBanner();
    // stage a mid-yard firefight: two Vanta bots visible ahead
    const vanta = botsApi.bots.filter((b) => b.team === TEAM.VANTA);
    vanta[0].pos.set(-3, 0, -2); vanta[0].yaw = Math.PI; vanta[0].state = 'hold';
    vanta[1].pos.set(4, 0, -8); vanta[1].yaw = Math.PI; vanta[1].state = 'hold';
    vanta[2].pos.set(0, 0, -14); vanta[2].yaw = Math.PI; vanta[2].state = 'hold';
    const ember = botsApi.bots.filter((b) => b.team === TEAM.EMBER);
    ember[0].pos.set(-6, 0, 8); ember[0].yaw = 0;
    player.reset(0, 10, 0);
    settle(30);
    aimAt(vanta[0].pos.x, 1.3, vanta[0].pos.z);
    shoot(state.time);
    settle(6);
    aimAt(vanta[1].pos.x, 1.3, vanta[1].pos.z);
    if (name === 'end') {
      // end the round: eliminate the Vanta squad on the books
      for (const b of vanta) { b.alive = false; b.hp = 0; b.deadT = 1; b.mesh.rotation.x = -Math.PI / 2; }
      rounds.endRound(TEAM.EMBER, 'enemy team eliminated');
      hud.setAlive(aliveCount(TEAM.EMBER), 0);
    }
    settle(10);
  }
  if (name !== 'buy') hud.setBuyOpen(false, state.money);
  hud.update(G, player.state, weapon);
  paintTwiceThenReady();
}

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
