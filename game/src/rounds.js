// EMBERLINE — rounds and economy. One module owns the match flow: buy
// phase, live round, plant / defuse, win checks, money, and the match end.
// First to 8 rounds takes the match (max 15). The player attacks every
// round; the charge is carried by the player or the first living Ember bot.
import { PHASE, TEAM } from './state.js';
import { WEAPONS, GRENADE, ARMOR } from './weapons.js';
import { sfx } from './audio.js';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3.5;
export const FUSE_SECONDS = 40;
export const DEFUSE_SECONDS = 5;

export function createRounds(state, hooks) {
  // hooks: { onRoundStart, onRoundEnd(winner, reason), onMatchEnd(winner),
  //          onPlant(site), onDefuse(), onDetonate(site), onBuy(item) }
  function startBuy() {
    state.phase = PHASE.BUY;
    state.timer = BUY_SECONDS;
    state.bomb.state = 'idle';
    state.bomb.site = null;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    hooks.onRoundStart(state.round);
  }

  function startLive() {
    state.phase = PHASE.LIVE;
    state.timer = ROUND_SECONDS;
    if (hooks.onLive) hooks.onLive();
  }

  function endRound(winner, reason) {
    if (state.phase === PHASE.ROUND_END) return;
    state.phase = PHASE.ROUND_END;
    state.roundWinner = winner;
    state.timer = 4;
    state.score[winner] += 1;
    const won = winner === TEAM.EMBER;
    if (won) {
      state.money += 3250;
      state.lossStreak = 0;
      sfx.roundWin();
    } else {
      state.lossStreak += 1;
      state.money += 1900 + Math.min(3, state.lossStreak - 1) * 500;
      sfx.roundLoss();
    }
    state.roundLog.push({ round: state.round, winner, reason });
    hooks.onRoundEnd(winner, reason);
    if (state.score[winner] >= state.winsToTake || state.round >= state.maxRounds) {
      state.phase = PHASE.MATCH_END;
      state.matchWinner = state.score[TEAM.EMBER] > state.score[TEAM.VANTA] ? TEAM.EMBER : TEAM.VANTA;
      state.timer = 999;
      hooks.onMatchEnd(state.matchWinner);
    }
  }

  function nextRound() {
    state.round += 1;
    startBuy();
  }

  function buy(item) {
    if (state.phase !== PHASE.BUY) return false;
    if (item === 'grenade') {
      if (state.money < GRENADE.price) { sfx.denied(); return false; }
      state.money -= GRENADE.price;
      hooks.onBuy(item);
      sfx.buy();
      return true;
    }
    if (item === 'armor') {
      if (state.money < ARMOR.price) { sfx.denied(); return false; }
      state.money -= ARMOR.price;
      hooks.onBuy(item);
      sfx.buy();
      return true;
    }
    const def = WEAPONS[item];
    if (!def || state.money < def.price) { sfx.denied(); return false; }
    state.money -= def.price;
    hooks.onBuy(item);
    sfx.buy();
    return true;
  }

  function plant(site) {
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.plantedAt = state.time;
    state.bomb.fuse = FUSE_SECONDS;
    state.money += 300;
    hooks.onPlant(site);
  }

  function defuse() {
    state.bomb.state = 'defused';
    hooks.onDefuse();
  }

  function detonate() {
    state.bomb.state = 'detonated';
    hooks.onDetonate(state.bomb.site);
  }

  // Called every fixed step; returns nothing, drives phase timers.
  function step(dt, alive) {
    // alive: {ember, vanta} — living fighters per team (player counts for ember)
    if (state.phase === PHASE.BUY) {
      state.timer -= dt;
      if (state.timer <= 0) startLive();
      return;
    }
    if (state.phase === PHASE.ROUND_END) {
      state.timer -= dt;
      if (state.timer <= 0 && state.phase !== PHASE.MATCH_END) nextRound();
      return;
    }
    if (state.phase !== PHASE.LIVE) return;
    state.timer -= dt;
    if (state.bomb.state === 'planted') {
      state.bomb.fuse -= dt;
      if (state.bomb.fuse <= 0) {
        detonate();
        endRound(TEAM.EMBER, 'charge detonated');
        return;
      }
    }
    if (alive.vanta <= 0) { endRound(TEAM.EMBER, 'enemy team eliminated'); return; }
    if (alive.ember <= 0) {
      // if the charge is planted the round continues until it blows or is defused
      if (state.bomb.state === 'planted') return;
      endRound(TEAM.VANTA, 'team eliminated');
      return;
    }
    if (state.timer <= 0) {
      if (state.bomb.state === 'planted') return; // fuse decides it
      endRound(TEAM.VANTA, 'time expired — charge never planted');
    }
  }

  return { startBuy, startLive, endRound, nextRound, buy, plant, defuse, detonate, step };
}
