// EMBERLINE — combat math: ray vs wall boxes, ray vs body spheres, line of
// sight, damage with armor. Pure functions over the shared colliders; the
// only allocations are the caller's own temp vectors (see state.js TMP).
import { TMP } from './state.js';

// Ray vs one AABB, slab method. Returns entry distance or -1.
export function rayAABB(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0;
  let tmax = Infinity;
  // x
  let inv = 1 / dx;
  let t1 = (c.minX - ox) * inv;
  let t2 = (c.maxX - ox) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  if (tmin > tmax) return -1;
  // y
  inv = 1 / dy;
  t1 = (c.minY - oy) * inv;
  t2 = (c.maxY - oy) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  if (tmin > tmax) return -1;
  // z
  inv = 1 / dz;
  t1 = (c.minZ - oz) * inv;
  t2 = (c.maxZ - oz) * inv;
  if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
  tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  if (tmin > tmax) return -1;
  return tmin;
}

// Nearest wall distance along a ray, or Infinity.
export function rayWalls(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i += 1) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, colliders[i]);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// Ray vs sphere. Returns distance or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

// Line of sight between two points, blocked by any wall box.
export function losClear(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.001) return true;
  const t = rayWalls(colliders, ax, ay, az, dx / len, dy / len, dz / len, len);
  return t >= len;
}

// Body hitboxes for an actor standing at (x, z) with feet y=0.
// Returns {part, dist} of the nearest hit, or null. Head is a sphere,
// torso and legs are spheres too (cheap, rotation-free approximations).
export function rayBody(ox, oy, oz, dx, dy, dz, maxDist, x, z, crouched) {
  const headY = crouched ? 0.95 : 1.55;
  const torsoY = crouched ? 0.62 : 1.05;
  const legY = 0.4;
  let best = maxDist;
  let part = null;
  let t = raySphere(ox, oy, oz, dx, dy, dz, x, headY, z, 0.26);
  if (t >= 0 && t < best) { best = t; part = 'head'; }
  t = raySphere(ox, oy, oz, dx, dy, dz, x, torsoY, z, 0.42);
  if (t >= 0 && t < best) { best = t; part = 'torso'; }
  t = raySphere(ox, oy, oz, dx, dy, dz, x, legY, z, 0.38);
  if (t >= 0 && t < best) { best = t; part = 'legs'; }
  return part ? { part, dist: best } : null;
}

// Damage with armor: armor absorbs 50% of the hit until it runs out.
export function applyDamage(actor, dmg) {
  let rest = dmg;
  if (actor.armor > 0) {
    const absorbed = Math.min(actor.armor, rest * 0.5);
    actor.armor -= absorbed;
    rest -= absorbed;
  }
  actor.hp -= rest;
  if (actor.hp <= 0) {
    actor.hp = 0;
    actor.alive = false;
    return true;
  }
  return false;
}

export { TMP };
