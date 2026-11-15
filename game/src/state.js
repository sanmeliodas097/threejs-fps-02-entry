// EMBERLINE — one state store, shared helpers. All mutable match state lives
// in the object createGameState returns; modules read and write it, nobody
// keeps a second copy. No allocation in the hot path: temp vectors live here.
import * as THREE from 'three';

export function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Scratch vectors reused by combat, bots and the player — never `new` per frame.
export const TMP = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

export const TEAM = { EMBER: 0, VANTA: 1 };
export const PHASE = { MENU: 'menu', BUY: 'buy', LIVE: 'live', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd' };

export function createGameState() {
  return {
    time: 0,
    phase: PHASE.MENU,
    round: 1,
    winsToTake: 8,
    maxRounds: 15,
    score: [0, 0],          // [ember, vanta]
    timer: 0,               // seconds left in the current phase
    freezeLeft: 0,
    money: 800,
    lossStreak: 0,
    bomb: { state: 'idle', site: null, plantedAt: 0, fuse: 40, plantProgress: 0, defuseProgress: 0 },
    player: null,           // filled by createPlayer
    bots: [],               // filled by createBots
    kills: 0,
    deaths: 0,
    killFeed: [],           // {text, t}
    banner: null,           // {title, sub, tone, until}
    roundWinner: -1,
    matchWinner: -1,
    roundLog: [],
  };
}
