// EMBERLINE — the player body: acceleration-based movement, crouch, jump,
// axis-separated AABB collision against the world's colliders. The camera
// rides at eye height; viewmodel kick and recoil live on the player state.
import * as THREE from 'three';
import { clamp } from './state.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const RADIUS = 0.35;

// Shared axis-separated AABB slide for any body (bots reuse the player's
// collision). pos is feet position; returns true when standing on something.
export function slideMove(pos, vel, dt, colliders, radius, height) {
  let onGround = false;
  const half = radius;
  const axes = [[0, vel.x * dt], [2, vel.z * dt], [1, vel.y * dt]];
  for (const [axis, delta] of axes) {
    if (delta === 0) continue; // at rest on this axis: never shove the body
    if (axis === 0) pos.x += delta;
    else if (axis === 1) pos.y += delta;
    else pos.z += delta;
    for (const c of colliders) {
      const ox = pos.x + half > c.minX && pos.x - half < c.maxX;
      const oy = pos.y < c.maxY && pos.y + height > c.minY;
      const oz = pos.z + half > c.minZ && pos.z - half < c.maxZ;
      if (!(ox && oy && oz)) continue;
      if (axis === 0) pos.x = delta > 0 ? c.minX - half : c.maxX + half;
      else if (axis === 2) pos.z = delta > 0 ? c.minZ - half : c.maxZ + half;
      else if (delta <= 0) { pos.y = c.maxY; onGround = true; }
      else pos.y = c.minY - height;
    }
    if (axis === 0) pos.x = clamp(pos.x, -31.5, 31.5);
    if (axis === 2) pos.z = clamp(pos.z, -27.5, 27.5);
    if (axis === 1 && pos.y < 0) { pos.y = 0; onGround = true; }
  }
  return onGround;
}

export function createPlayer(colliders) {
  const state = {
    pos: new THREE.Vector3(0, 0, 24),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: EYE_STAND,
    crouched: false,
    onGround: true,
    hp: 100,
    armor: 0,
    alive: true,
    speed: 0,          // horizontal speed, for spread + HUD
    recoilPitch: 0,    // visual kick, decays
    recoilYaw: 0,
    stepAcc: 0,
    lastStep: 0,
  };

  function collideAxis(axis, delta) {
    // A body at rest on an axis is never shoved by it: zero delta means
    // "not moving", and resolving it would pick an arbitrary side.
    if (delta === 0) return;
    const p = state.pos;
    const half = RADIUS;
    const height = state.crouched ? 1.15 : 1.75;
    if (axis === 0) p.x += delta;
    else if (axis === 1) p.y += delta;
    else p.z += delta;
    for (const c of colliders) {
      const overlapX = p.x + half > c.minX && p.x - half < c.maxX;
      const overlapY = p.y < c.maxY && p.y + height > c.minY;
      const overlapZ = p.z + half > c.minZ && p.z - half < c.maxZ;
      if (!(overlapX && overlapY && overlapZ)) continue;
      if (axis === 0) p.x = delta > 0 ? c.minX - half : c.maxX + half;
      else if (axis === 1) {
        if (delta > 0) p.y = c.minY - height;
        else { p.y = c.maxY; state.onGround = true; }
      } else p.z = delta > 0 ? c.minZ - half : c.maxZ + half;
    }
    // arena floor + bounds
    if (axis === 1 && p.y < 0) { p.y = 0; state.onGround = true; }
    if (axis === 0) p.x = clamp(p.x, -31.5, 31.5);
    if (axis === 2) p.z = clamp(p.z, -27.5, 27.5);
  }

  return {
    state,
    reset(x, z, yaw) {
      state.pos.set(x, 0, z);
      state.vel.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.hp = 100;
      state.armor = 0;
      state.alive = true;
      state.eye = EYE_STAND;
      state.crouched = false;
      state.recoilPitch = 0;
      state.recoilYaw = 0;
    },
    look(dx, dy) {
      state.yaw -= dx * 0.0021;
      state.pitch = clamp(state.pitch - dy * 0.0021, -1.45, 1.45);
    },
    kick(pitch, yaw) {
      state.recoilPitch += pitch;
      state.recoilYaw += yaw;
    },
    step(dt, keys) {
      const s = state;
      const wantCrouch = keys.has('ControlLeft') || keys.has('KeyC');
      s.crouched = wantCrouch;
      const targetEye = wantCrouch ? EYE_CROUCH : EYE_STAND;
      s.eye += (targetEye - s.eye) * Math.min(1, dt * 14);

      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const sin = Math.sin(s.yaw);
      const cos = Math.cos(s.yaw);
      let mx = -sin * fwd + cos * strafe;
      let mz = -cos * fwd - sin * strafe;
      const len = Math.hypot(mx, mz);
      if (len > 0) { mx /= len; mz /= len; }
      const maxSpeed = s.crouched ? 2.1 : 4.4;
      const accel = s.onGround ? 42 : 10;
      s.vel.x += mx * accel * dt;
      s.vel.z += mz * accel * dt;
      // friction: strong on ground, weak in air — stopping to aim pays.
      const fr = s.onGround ? Math.max(0, 1 - dt * 11) : Math.max(0, 1 - dt * 0.6);
      s.vel.x *= fr;
      s.vel.z *= fr;
      const hs = Math.hypot(s.vel.x, s.vel.z);
      if (hs > maxSpeed) { s.vel.x *= maxSpeed / hs; s.vel.z *= maxSpeed / hs; }
      s.speed = hs;

      if (keys.has('Space') && s.onGround) {
        s.vel.y = 5.2;
        s.onGround = false;
      }
      s.vel.y -= 14 * dt;
      s.onGround = false;
      collideAxis(0, s.vel.x * dt);
      collideAxis(2, s.vel.z * dt);
      collideAxis(1, s.vel.y * dt);
      if (s.onGround) s.vel.y = 0;

      // footstep sounds while moving on the ground
      s.stepAcc += hs * dt;
      if (s.stepAcc - s.lastStep > 2.2 && hs > 1.5 && s.onGround) {
        s.lastStep = s.stepAcc;
        return true; // stepped
      }
      return false;
    },
  };
}
