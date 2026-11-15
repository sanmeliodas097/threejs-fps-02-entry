// EMBERLINE — bots. One module owns every bot: body, mesh, and brain.
// Roles: Ember (attackers) push a site in a loose formation and plant the
// charge; Vanta (defenders) hold angles, rotate on sound or contact, and
// defuse a planted charge. A bot sees through a field of view + line of
// sight, hears gunfire, reacts after a delay, and fires in bursts whose
// accuracy falls with distance and target movement.
import * as THREE from 'three';
import { TEAM } from './state.js';
import { findPath, nearestNode } from './nav.js';
import { losClear, applyDamage, rayWalls } from './combat.js';
import { slideMove } from './player.js';
import { PALETTE } from './palette.js';
import { sfx } from './audio.js';

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Spark'];
const VANTA_NAMES = ['Shade', 'Hollow', 'Wraith', 'Dusk', 'Vex'];
const BOT_WEAPONS = {
  rifle: { damage: 26, headMult: 3, rate: 0.13, range: 60 },
  smg: { damage: 20, headMult: 3, rate: 0.09, range: 35 },
};

function buildBotMesh(scene, team) {
  const color = team === TEAM.EMBER ? PALETTE.amber : PALETTE.violet;
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.9 });
  function part(w, h, d, x, y, z, m) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || cloth);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }
  part(0.52, 0.62, 0.3, 0, 1.18, 0);            // torso
  part(0.54, 0.2, 0.32, 0, 1.42, 0, accent);    // chest plate
  part(0.3, 0.3, 0.3, 0, 1.66, 0, skin);         // head
  part(0.32, 0.1, 0.32, 0, 1.78, 0, accent);    // visor band
  part(0.2, 0.62, 0.22, -0.14, 0.45, 0);        // legs
  part(0.2, 0.62, 0.22, 0.14, 0.45, 0);
  part(0.14, 0.5, 0.14, -0.34, 1.2, 0.1);       // arms
  part(0.14, 0.5, 0.14, 0.34, 1.2, 0.1);
  const gun = part(0.08, 0.1, 0.75, 0.34, 1.28, 0.35); // gun
  gun.material = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.7 });
  scene.add(group);
  return group;
}

export function createBots(scene, world, state, rng) {
  const bots = [];
  const colliders = world.colliders;

  function makeBot(team, index, weaponKey) {
    const spawn = world.spawns[team === TEAM.EMBER ? 'ember' : 'vanta'][index];
    const name = (team === TEAM.EMBER ? EMBER_NAMES : VANTA_NAMES)[index % 5];
    const bot = {
      id: bots.length,
      team,
      name,
      weapon: weaponKey,
      alive: true,
      hp: 100,
      armor: team === TEAM.VANTA ? 50 : 0,
      pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
      vel: new THREE.Vector3(),
      yaw: team === TEAM.EMBER ? 0 : Math.PI,
      pitch: 0,
      speed: 0,
      state: 'idle',       // push | hold | engage | plant | defuse | rotate
      role: 'entry',
      site: 'A',
      path: [],
      pathI: 0,
      holdNode: -1,
      holdYaw: 0,
      scanT: 0,
      target: null,        // {kind:'player'|'bot', ref, x, y, z}
      reactT: 0,
      burstLeft: 0,
      burstPause: 0,
      fireT: 0,
      reloadT: 0,
      mag: 30,
      lastSeen: null,      // {x, z, t}
      alertPos: null,
      plantT: 0,
      defuseT: 0,
      isCarrier: false,
      strafeDir: 1,
      strafeT: 0,
      mesh: null,
      deadT: 0,
    };
    bot.mesh = buildBotMesh(scene, team);
    bots.push(bot);
    return bot;
  }

  // 4 Ember attackers (player is the 5th) vs 5 Vanta defenders.
  for (let i = 0; i < 4; i += 1) makeBot(TEAM.EMBER, i, i === 0 ? 'smg' : 'rifle');
  for (let i = 0; i < 5; i += 1) makeBot(TEAM.VANTA, i, i === 4 ? 'smg' : 'rifle');

  function resetRound(roundState) {
    const sitePick = rng() < 0.5 ? 'A' : 'B';
    bots.forEach((b) => {
      const spawn = world.spawns[b.team === TEAM.EMBER ? 'ember' : 'vanta'][b.id % 5];
      b.pos.set(spawn[0], 0, spawn[1]);
      b.vel.set(0, 0, 0);
      b.hp = 100;
      b.armor = b.team === TEAM.VANTA ? 50 : 0;
      b.alive = true;
      b.mag = 30;
      b.reloadT = 0;
      b.target = null;
      b.lastSeen = null;
      b.alertPos = null;
      b.plantT = 0;
      b.defuseT = 0;
      b.deadT = 0;
      b.mesh.visible = true;
      b.mesh.rotation.set(0, 0, 0);
      b.mesh.position.copy(b.pos);
      b.isCarrier = false;
      if (b.team === TEAM.EMBER) {
        b.site = sitePick;
        b.role = b.id === 0 ? 'entry' : 'support';
        b.state = 'push';
        b.path = findPath(world.adj, nearestNode(world.nodes, b.pos.x, b.pos.z), world.sites[b.site].node);
        b.pathI = 0;
      } else {
        // defenders: A hold, B hold, A connector, B connector, mid watch
        const holdMap = [20, 22, 25, 26, 24];
        const siteMap = ['A', 'B', 'A', 'B', 'A'];
        b.holdNode = holdMap[b.id - 4];
        b.site = siteMap[b.id - 4];
        b.role = 'anchor';
        b.state = 'hold';
        b.path = findPath(world.adj, nearestNode(world.nodes, b.pos.x, b.pos.z), b.holdNode);
        b.pathI = 0;
        // face the lane the attackers come down: A holders look south-west, B south-east
        b.holdYaw = b.site === 'A' ? Math.PI * 0.75 : Math.PI * 1.25;
      }
    });
    // the first living Ember bot carries the charge
    const carrier = bots.find((b) => b.team === TEAM.EMBER);
    if (carrier) carrier.isCarrier = true;
    void roundState;
  }

  // ---- perception: nearest visible enemy (player or enemy bot) ----
  function seeEnemy(bot, player) {
    const eyeY = 1.55;
    let best = null;
    let bestD = 40; // spotting range: cross-map spawn glimpses do not count
    const candidates = [];
    if (player.alive) candidates.push({ kind: 'player', ref: player, x: player.pos.x, y: player.pos.y + (player.crouched ? 0.7 : 1.2), z: player.pos.z, moving: player.speed });
    for (const o of bots) {
      if (!o.alive || o.team === bot.team) continue;
      candidates.push({ kind: 'bot', ref: o, x: o.pos.x, y: o.pos.y + 1.2, z: o.pos.z, moving: o.speed });
    }
    for (const c of candidates) {
      const dx = c.x - bot.pos.x;
      const dy = c.y - eyeY;
      const dz = c.z - bot.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > bestD) continue;
      // field of view: 100 degrees
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.95 && d > 3) continue;
      if (!losClear(colliders, bot.pos.x, eyeY, bot.pos.z, c.x, c.y, c.z)) continue;
      best = c;
      bestD = d;
    }
    return best ? { ...best, dist: bestD } : null;
  }

  function faceToward(bot, x, z, dt) {
    const want = Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
    bot.yaw += turn;
  }

  function moveAlongPath(bot, dt, speed) {
    if (bot.pathI >= bot.path.length) return true;
    const node = world.nodes[bot.path[bot.pathI]];
    const dx = node[0] - bot.pos.x;
    const dz = node[1] - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) { bot.pathI += 1; return bot.pathI >= bot.path.length; }
    const vx = (dx / d) * speed;
    const vz = (dz / d) * speed;
    bot.vel.set(vx, 0, vz);
    bot.speed = speed;
    faceToward(bot, node[0], node[1], dt);
    slideMove(bot.pos, bot.vel, dt, colliders, 0.35, 1.75);
    return false;
  }

  function idleMove(bot, dt) {
    bot.vel.multiplyScalar(Math.max(0, 1 - dt * 10));
    bot.speed = Math.hypot(bot.vel.x, bot.vel.z);
    slideMove(bot.pos, bot.vel, dt, colliders, 0.35, 1.75);
  }

  // ---- bot shooting: burst fire with distance/movement accuracy ----
  function botShoot(bot, target, dt, fx, G) {
    const def = BOT_WEAPONS[bot.weapon];
    bot.fireT -= dt;
    if (bot.reloadT > 0) {
      bot.reloadT -= dt;
      if (bot.reloadT <= 0) bot.mag = 30;
      return;
    }
    if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(rng() * 3);
      bot.burstPause = 0.5 + rng() * 0.5;
    }
    if (bot.fireT > 0) return;
    bot.fireT = def.rate;
    if (bot.mag <= 0) { bot.reloadT = 2.0; return; }
    bot.mag -= 1;
    bot.burstLeft -= 1;

    const dist = target.dist;
    const moving = target.moving || 0;
    let p = 0.34 - dist * 0.005 - moving * 0.03;
    if (target.kind === 'player' && target.ref.crouched) p -= 0.06;
    p = Math.max(0.05, Math.min(0.5, p));
    const muzzle = { x: bot.pos.x, y: bot.pos.y + 1.35, z: bot.pos.z };
    const hit = rng() < p;
    let endX = target.x;
    let endY = target.y;
    let endZ = target.z;
    if (!hit) {
      endX += (rng() - 0.5) * 2.2;
      endY += (rng() - 0.5) * 1.4;
      endZ += (rng() - 0.5) * 2.2;
    }
    // wall blocks the shot
    const dx = endX - muzzle.x;
    const dy = endY - muzzle.y;
    const dz = endZ - muzzle.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const wallT = rayWalls(colliders, muzzle.x, muzzle.y, muzzle.z, dx / len, dy / len, dz / len, len);
    if (wallT < len) {
      endX = muzzle.x + (dx / len) * wallT;
      endY = muzzle.y + (dy / len) * wallT;
      endZ = muzzle.z + (dz / len) * wallT;
      fx.tracer(muzzle, { x: endX, y: endY, z: endZ });
      fx.impact(endX, endY, endZ);
      sfx.shot(bot.weapon === 'smg' ? 'smg' : 'rifle', 0.4);
      return;
    }
    fx.tracer(muzzle, { x: endX, y: endY, z: endZ });
    sfx.shot(bot.weapon === 'smg' ? 'smg' : 'rifle', 0.4);
    if (!hit) return;
    const headshot = rng() < 0.08;
    const dmg = def.damage * (headshot ? def.headMult : 1);
    const victim = target.ref;
    const died = applyDamage(victim, dmg);
    if (target.kind === 'player') {
      G.onPlayerDamaged(dmg, bot);
      if (died) G.onPlayerKilled(bot);
    } else {
      G.onBotKilled(victim, bot, headshot);
    }
  }

  function stepBot(bot, dt, G) {
    if (!bot.alive) return;
    const player = G.player.state;
    // Freeze time: bots move to their positions but nobody fights, plants
    // or defuses before the round goes live.
    const live = G.state.phase === 'live';
    const seen = live ? seeEnemy(bot, player) : null;
    // Close contacts (<= 28 m) are fought; farther ones are only noted —
    // a bot never stops its push to plink at a speck across the map.
    // Once the charge is planted, Vanta defenders only stop for close
    // threats (<= 15 m): the defuse is the job, not the duel.
    const engageRange = (G.state.bomb.state === 'planted' && bot.team === TEAM.VANTA) ? 15 : 28;
    if (seen && seen.dist <= engageRange) {
      if (!bot.target || bot.target.ref !== seen.ref) {
        bot.target = seen;
        bot.reactT = 0.35 + rng() * 0.35 + seen.dist * 0.006;
      }
      bot.target = seen;
      bot.lastSeen = { x: seen.x, z: seen.z, t: G.state.time };
    } else if (seen) {
      bot.lastSeen = { x: seen.x, z: seen.z, t: G.state.time };
    } else if (bot.target && G.state.time - (bot.lastSeen ? bot.lastSeen.t : 0) > 1.2) {
      bot.target = null;
    }

    const bomb = G.state.bomb;
    // Objective channels are sticky: a bot that is planting or defusing
    // finishes the job instead of breaking off to duel.
    if (live && bot.state === 'defuse' && bomb.state === 'planted') {
      bot.defuseT += dt;
      if (Math.floor(bot.defuseT * 2) !== Math.floor((bot.defuseT - dt) * 2)) sfx.defuse();
      if (bot.defuseT >= 5) G.onBombDefused(bot);
      idleMove(bot, dt);
      return;
    }
    if (live && bot.state === 'plant') {
      bot.plantT += dt;
      if (Math.floor(bot.plantT * 2) !== Math.floor((bot.plantT - dt) * 2)) sfx.plantBeep();
      if (bot.plantT >= 3.5) {
        G.onBombPlanted(bot.site, bot);
        bot.state = 'push';
        bot.isCarrier = false;
      }
      idleMove(bot, dt);
      return;
    }

    if (bot.target) {
      // engage: face the target, strafe, fire after reacting
      const t = bot.target;
      faceToward(bot, t.x, t.z, dt);
      bot.reactT -= dt;
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + rng() * 0.8; }
      const plantedVanta = G.state.bomb.state === 'planted' && bot.team === TEAM.VANTA;
      if (bot.reactT <= 0) {
        if (plantedVanta && t.dist > 3) {
          // Push through the duel toward the charge instead of strafing
          // in place for the whole fuse: close on the target (which is
          // at or near the site) and defuse once inside the site radius.
          const dx = t.x - bot.pos.x;
          const dz = t.z - bot.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          bot.vel.set((dx / d) * 3.2, 0, (dz / d) * 3.2);
          bot.speed = 3.2;
          slideMove(bot.pos, bot.vel, dt, colliders, 0.35, 1.75);
          const s = world.sites[G.state.bomb.site];
          if (Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z) < s.r) {
            bot.state = 'defuse';
            bot.defuseT = 0;
            bot.target = null;
          }
        } else {
          const sx = Math.cos(bot.yaw) * bot.strafeDir * 1.6;
          const sz = -Math.sin(bot.yaw) * bot.strafeDir * 1.6;
          bot.vel.set(sx, 0, sz);
          bot.speed = 1.6;
          slideMove(bot.pos, bot.vel, dt, colliders, 0.35, 1.75);
        }
        botShoot(bot, t, dt, G.fx, G);
      } else {
        idleMove(bot, dt);
      }
      return;
    }

    // ---- no target: follow role behaviour ----
    if (bot.team === TEAM.EMBER) {
      if (bomb.state === 'planted') {
        // defend the planted charge: hold near the site
        if (bot.holdNode !== world.sites[bomb.site].node) {
          bot.holdNode = world.sites[bomb.site].node;
          bot.path = findPath(world.adj, nearestNode(world.nodes, bot.pos.x, bot.pos.z), bot.holdNode);
          bot.pathI = 0;
        }
        if (!moveAlongPath(bot, dt, 3.0)) return;
        bot.scanT += dt;
        bot.yaw += Math.sin(bot.scanT * 0.7) * dt * 0.8;
        idleMove(bot, dt);
        return;
      }
      if (live && bot.isCarrier && bot.state === 'push' && bot.pathI >= bot.path.length) {
        // at the site: plant (execution is in the sticky block above)
        bot.state = 'plant';
        bot.plantT = 0;
      }
      moveAlongPath(bot, dt, 3.4);
      return;
    }

    // Vanta defenders
    if (live && bomb.state === 'planted') {
      if (bot.state !== 'defuse' && bot.state !== 'rotate') {
        bot.state = 'rotate';
        bot.path = findPath(world.adj, nearestNode(world.nodes, bot.pos.x, bot.pos.z), world.sites[bomb.site].node);
        bot.pathI = 0;
      }
      if (bot.state === 'rotate') {
        if (moveAlongPath(bot, dt, 3.6)) {
          // reached the site: defuse (execution is in the sticky block above)
          bot.state = 'defuse';
          bot.defuseT = 0;
        }
        return;
      }
    }
    if (bot.alertPos && bot.state !== 'rotate') {
      bot.state = 'rotate';
      bot.path = findPath(world.adj, nearestNode(world.nodes, bot.pos.x, bot.pos.z), nearestNode(world.nodes, bot.alertPos.x, bot.alertPos.z));
      bot.pathI = 0;
    }
    if (bot.state === 'rotate') {
      if (moveAlongPath(bot, dt, 3.4)) {
        bot.state = 'hold';
        bot.alertPos = null;
        bot.path = findPath(world.adj, nearestNode(world.nodes, bot.pos.x, bot.pos.z), bot.holdNode);
        bot.pathI = 0;
      }
      return;
    }
    if (bot.state === 'hold' && bot.pathI < bot.path.length) {
      moveAlongPath(bot, dt, 3.2);
      return;
    }
    // holding: slow scan sweep
    bot.scanT += dt;
    const base = bot.holdYaw || 0;
    bot.yaw = base + Math.sin(bot.scanT * 0.5) * 0.7;
    idleMove(bot, dt);
  }

  function syncMesh(bot, dt) {
    const m = bot.mesh;
    if (!bot.alive) {
      if (bot.deadT < 1) {
        bot.deadT += dt;
        m.rotation.x = -Math.min(1, bot.deadT * 2) * Math.PI * 0.5;
        m.position.y = -0.15 * Math.min(1, bot.deadT);
      }
      return;
    }
    m.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    m.rotation.y = bot.yaw;
    // walk bob
    const bob = bot.speed > 0.5 ? Math.sin(G_time() * 9) * 0.03 : 0;
    m.position.y = bot.pos.y + bob;
  }
  let timeNow = 0;
  function G_time() { return timeNow; }

  return {
    bots,
    resetRound,
    step(dt, G) {
      timeNow = G.state.time;
      for (const b of bots) stepBot(b, dt, G);
      for (const b of bots) syncMesh(b, dt);
    },
    aliveCount(team) {
      let n = 0;
      for (const b of bots) if (b.alive && b.team === team) n += 1;
      return n;
    },
    // gunfire within 28 m alerts defenders to the shooter's position
    hearShot(x, z, shooterTeam) {
      for (const b of bots) {
        if (!b.alive || b.team === shooterTeam) continue;
        const d = Math.hypot(b.pos.x - x, b.pos.z - z);
        if (d < 28 && b.state !== 'engage') {
          b.alertPos = { x, z };
          if (b.state === 'hold') b.state = 'rotate';
        }
      }
    },
  };
}
