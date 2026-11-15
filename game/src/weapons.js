// EMBERLINE — weapons. Each definition carries its feel: damage, headshot
// multiplier, falloff, fire rate, spread that grows with movement and with
// every shot, recoil, magazine and price. One module owns all gun numbers.
export const WEAPONS = {
  pistol: {
    name: 'Kestrel P9', kind: 'pistol', price: 0, damage: 34, headMult: 3.0,
    falloff: 0.55, range: 40, rate: 0.16, auto: false, mag: 12, reserve: 48,
    reload: 1.1, spread: 0.006, moveSpread: 0.02, bloom: 0.004, recoil: 0.011, kick: 0.35,
  },
  smg: {
    name: 'Hornet-9', kind: 'smg', price: 1500, damage: 26, headMult: 3.0,
    falloff: 0.45, range: 35, rate: 0.085, auto: true, mag: 28, reserve: 112,
    reload: 1.6, spread: 0.011, moveSpread: 0.028, bloom: 0.005, recoil: 0.007, kick: 0.3,
  },
  rifle: {
    name: 'Longbow AR', kind: 'rifle', price: 2700, damage: 34, headMult: 4.0,
    falloff: 0.7, range: 70, rate: 0.105, auto: true, mag: 30, reserve: 90,
    reload: 2.1, spread: 0.004, moveSpread: 0.026, bloom: 0.004, recoil: 0.012, kick: 0.5,
  },
  shotgun: {
    name: 'Breacher-12', kind: 'shotgun', price: 1700, damage: 11, headMult: 2.0,
    falloff: 0.35, range: 22, rate: 0.85, auto: false, mag: 6, reserve: 24,
    reload: 2.6, spread: 0.045, moveSpread: 0.03, bloom: 0.01, recoil: 0.038, kick: 1.0,
    pellets: 8,
  },
  sniper: {
    name: 'Needle .50', kind: 'sniper', price: 4750, damage: 105, headMult: 2.0,
    falloff: 0.9, range: 120, rate: 1.15, auto: false, mag: 5, reserve: 15,
    reload: 2.9, spread: 0.0008, moveSpread: 0.06, bloom: 0.002, recoil: 0.05, kick: 1.4,
  },
};

export const GRENADE = { name: 'Spark Frag', price: 300, damage: 95, radius: 7 };
export const ARMOR = { name: 'Plated Vest', price: 650, value: 50 };

export const BUY_LIST = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'grenade', 'armor'];

export function createWeaponSet() {
  return {
    current: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    grenades: 0,
    cooldown: 0,
    reloading: 0,
    bloom: 0,          // accumulated spread from firing
    lastShot: -10,
  };
}

// Current spread in radians: base + movement penalty + bloom from firing.
export function currentSpread(w, def, moveSpeed, crouched) {
  const move = (moveSpeed / 4.4) * def.moveSpread;
  const crouchBonus = crouched ? -0.3 : 0;
  return Math.max(0.0005, def.spread + move * (1 + crouchBonus) + w.bloom);
}

export function tryFire(w, def, now) {
  if (w.reloading > 0 || w.cooldown > now) return false;
  if (w.mag <= 0) return false;
  w.mag -= 1;
  w.cooldown = now + def.rate;
  w.lastShot = now;
  w.bloom = Math.min(0.05, w.bloom + def.bloom);
  return true;
}

export function startReload(w, def) {
  if (w.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  w.reloading = def.reload;
  return true;
}

export function finishReload(w, def) {
  const need = def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.reloading = 0;
}
