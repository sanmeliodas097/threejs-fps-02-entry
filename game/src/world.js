// EMBERLINE — the map: "Foundry Yard", an original industrial yard.
// Three lanes (A-long west, Mid, B-hall east), two bomb sites, attacker spawn
// south, defender spawn north. Every solid is an axis-aligned box: the same
// list drives the meshes and the collision / bullet tests.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, 512, 512);
  // asphalt noise
  for (let i = 0; i < 9000; i += 1) {
    const v = 34 + Math.floor(Math.random() * 22);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // yard lane lines (map x -32..32 -> 0..512, z -28..28 -> 0..512)
  const px = (x) => (x + 32) * 8;
  const pz = (z) => (z + 28) * (512 / 56);
  g.strokeStyle = 'rgba(240,168,48,0.55)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(px(-12), pz(28)); g.lineTo(px(-12), pz(-28)); g.stroke();
  g.beginPath(); g.moveTo(px(12), pz(28)); g.lineTo(px(12), pz(-28)); g.stroke();
  g.beginPath(); g.moveTo(px(-32), pz(0)); g.lineTo(px(32), pz(0)); g.stroke();
  g.setLineDash([]);
  // site letters painted on the ground
  g.fillStyle = 'rgba(240,168,48,0.85)';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('A', px(-22), pz(-16));
  g.fillStyle = 'rgba(46,158,138,0.85)';
  g.fillText('B', px(22), pz(-16));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createWorld(scene) {
  const colliders = [];   // {minX,minY,minZ,maxX,maxY,maxZ}
  const boxes = [];       // {x0,z0,x1,z1,h,mat}
  const matCache = new Map();
  function mat(color) {
    if (!matCache.has(color)) {
      matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 }));
    }
    return matCache.get(color);
  }
  // add a solid box: mesh + collider. h is height; y0 defaults to 0.
  function box(x0, z0, x1, z1, h, color, y0 = 0) {
    const w = x1 - x0;
    const d = z1 - z0;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    mesh.castShadow = h > 1.4;
    mesh.receiveShadow = true;
    scene.add(mesh);
    colliders.push({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y0 + h, maxZ: z1 });
    boxes.push({ x0, z0, x1, z1, h });
    return mesh;
  }

  // ---- ground ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(66, 58),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- outer walls ----
  box(-33, -29, 33, -28, 6, PALETTE.steelDark);
  box(-33, 28, 33, 29, 6, PALETTE.steelDark);
  box(-33, -28, -32, 28, 6, PALETTE.steelDark);
  box(32, -28, 33, 28, 6, PALETTE.steelDark);

  // ---- lane dividers (gaps at mid z -4..4 and north of -20) ----
  box(-13, 4, -12, 20, 3.4, PALETTE.steel);
  box(-13, -20, -12, -4, 3.4, PALETTE.steel);
  box(12, 4, 13, 20, 3.4, PALETTE.steel);
  box(12, -20, 13, -4, 3.4, PALETTE.steel);

  // ---- B hall: tall warehouse shell around site B ----
  box(14, -27, 15, -14, 5.5, PALETTE.steelDark);    // west wall, door gap z -14..-10
  box(14, -10, 15, -6, 5.5, PALETTE.steelDark);
  box(15, -27, 31, -26, 5.5, PALETTE.steelDark);    // north inner wall

  // ---- A site: container stack ----
  box(-27, -22, -21, -20, 2.6, PALETTE.containerA);
  box(-27, -19.4, -23, -17.4, 2.6, PALETTE.containerB);
  box(-26, -22, -22, -20, 2.6, PALETTE.containerC, 2.6); // stacked second level
  box(-18, -24, -16, -21, 2.6, PALETTE.containerB);

  // ---- B site crates + tanks ----
  box(24, -24, 28, -21, 2.4, PALETTE.containerC);
  box(17, -24, 20, -22, 1.2, PALETTE.crate);
  box(26, -14, 29, -11, 1.2, PALETTE.crate);

  // ---- mid yard cover: crates, forklift block, low walls ----
  // (the crate that used to sit at (-2,2)-(2,5) now sits east of mid so the
  // A/B diagonals from node 4 run clear of it)
  box(5, -1, 8, 2, 1.2, PALETTE.crate);
  box(-5, -3, -2, 0, 1.2, PALETTE.crate);
  box(3, -6, 6, -3, 1.2, PALETTE.crate);
  box(-6, 8, -3, 10, 1.2, PALETTE.crate);
  box(4, 8, 7, 10, 1.2, PALETTE.crate);
  box(-1.5, -12, 1.5, -9, 1.6, PALETTE.rust);       // mid choke block
  box(-9, 14, -6, 16, 1.2, PALETTE.crate);
  box(6, 14, 9, 16, 1.2, PALETTE.crate);
  box(-10, -14, -8, -11, 1.2, PALETTE.crate);
  box(8, -14, 10, -11, 1.2, PALETTE.crate);

  // ---- spawn cover: flank blocks only — the mid lane stays open so the
  // first waypoint is reachable in a straight line (a bot pushing straight
  // into a wall face never sidesteps) ----
  box(-8, 24, -6, 25, 1.4, PALETTE.steelDark);
  box(6, 24, 8, 25, 1.4, PALETTE.steelDark);
  box(-8, -25, -6, -24, 1.4, PALETTE.steelDark);
  box(6, -25, 8, -24, 1.4, PALETTE.steelDark);

  // ---- site markers: painted rings + lights ----
  function siteRing(x, z, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.0, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    scene.add(ring);
    const light = new THREE.PointLight(color, 12, 16, 1.8);
    light.position.set(x, 4, z);
    scene.add(light);
  }
  siteRing(-22, -18, PALETTE.siteA);
  siteRing(22, -18, PALETTE.siteB);

  // ---- nav graph: waypoints over the lanes ----
  // Every edge is a straight line verified clear of walls: the lane
  // dividers (x -13..-12 and 12..13) are crossed only through the mid gap
  // (z -4..4), the B hall only through its door (z -14..-10) or from the
  // open south, and the mid choke block (-1.5..1.5, -12..-9) is rounded
  // through node 6 at (4,-12). A straight-line path into a wall face is a
  // trap for axis-separated sliding, so no edge aims through one.
  // nodes: [x, z]
  const nodes = [
    [0, 22], [-8, 18], [8, 18],        // 0-2 attacker spawn
    [0, 12], [0, 7], [0, -4], [4, -12], // 3-6 mid (6 rounds the choke)
    [-16, 0], [-22, 6], [-24, -4], [-22, -12], [-22, -18], // 7-11 A lane + site
    [16, 0], [22, 6], [24, -4], [22, -12], [22, -18],      // 12-16 B lane + site
    [0, -22], [-10, -22], [10, -22],    // 17-19 defender spawn
    [-18, -14], [-26, -22], [18, -14], [26, -22], [-4, -10], [-14, -8], [16, -8], // 20-26 holds
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 4], [4, 5], [5, 6], [6, 17],
    [4, 7], [5, 7], [7, 8], [8, 9], [9, 10], [10, 11],
    [4, 12], [5, 12], [12, 13], [13, 14], [14, 15], [15, 16],
    [6, 15],
    [17, 18], [17, 19], [17, 24],
    // NOTE: the south-corridor edges [18,21], [21,20], [19,23], [23,22]
    // were REMOVED — they run head-on into the A/B site crates (the
    // z=-22 line is blocked by the crate faces at x -18..-16 / -27..-21
    // west and x 17..20 / 24..28 east), so bots pushed into the crate
    // faces forever with no slide component to route around. Defenders
    // now rotate to either site through mid (17-24-7/12), which BFS
    // picks once the blocked shortcuts are gone. Nodes 21/23 are
    // orphans now and unused; keep them (indices are load-bearing).
    [24, 5], [24, 7], [24, 12],
    [7, 25], [25, 20], [25, 9], [10, 20], [20, 11],
    [12, 26], [26, 22], [26, 14], [15, 22], [22, 16],
  ];
  const adj = nodes.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }

  return {
    colliders,
    nodes,
    adj,
    sites: {
      A: { x: -22, z: -18, r: 3.2, node: 11 },
      B: { x: 22, z: -18, r: 3.2, node: 16 },
    },
    spawns: {
      ember: [[-5, 26.5], [-2.5, 27], [0, 26.5], [2.5, 27], [5, 26.5]],
      vanta: [[-5, -26.5], [-2.5, -27], [0, -26.5], [2.5, -27], [5, -26.5]],
    },
  };
}
