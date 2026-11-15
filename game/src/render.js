// EMBERLINE — rendering and effects. One renderer, one directional sun
// with shadows, site lights from the world, and preallocated effect pools:
// tracers (24 lines), impact sparks (one Points cloud, 240 slots), muzzle
// flash, and the explosion bloom. Nothing is allocated per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const SPARKS = 240;

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(PALETTE.canvas, 30, 95);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0x8a94b8, 0x2a2118, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
  sun.position.set(28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const dusk = new THREE.DirectionalLight(0x5a6cff, 0.5);
  dusk.position.set(-30, 20, -25);
  scene.add(dusk);

  // ---- tracers: pooled lines ----
  const tracerPool = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerI = 0;

  // ---- sparks: one Points cloud, fixed slots ----
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  for (let i = 0; i < SPARKS; i += 1) sparkPos[i * 3 + 1] = -100;
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95 }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkI = 0;

  // ---- muzzle flash: light + quad at the camera ----
  const muzzleLight = new THREE.PointLight(0xffc46b, 0, 12, 1.6);
  scene.add(muzzleLight);
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  camera.add(flash);
  flash.position.set(0.28, -0.22, -0.6);
  let flashLife = 0;

  // ---- explosion bloom ----
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), boomMat);
  scene.add(boom);
  const boomLight = new THREE.PointLight(0xff8a2a, 0, 30, 1.5);
  scene.add(boomLight);
  let boomLife = 0;

  // ---- viewmodel gun ----
  const gunGroup = new THREE.Group();
  camera.add(gunGroup);
  gunGroup.position.set(0.28, -0.24, -0.5);
  let gunParts = null;
  function buildGun(kind) {
    if (gunParts) {
      for (const m of gunParts) gunGroup.remove(m);
    }
    gunParts = [];
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.35, metalness: 0.75 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.9 });
    const accent = new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.4, metalness: 0.5 });
    const dims = {
      pistol: { len: 0.3, barrel: 0.16 },
      smg: { len: 0.5, barrel: 0.24 },
      rifle: { len: 0.72, barrel: 0.4 },
      shotgun: { len: 0.78, barrel: 0.46 },
      sniper: { len: 0.95, barrel: 0.62 },
    }[kind] || { len: 0.72, barrel: 0.4 };
    function add(w, h, d, x, y, z, m) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || dark);
      mesh.position.set(x, y, z);
      gunGroup.add(mesh);
      gunParts.push(mesh);
      return mesh;
    }
    add(0.07, 0.11, dims.len, 0, 0, -dims.len / 2);                 // receiver
    add(0.045, 0.045, dims.barrel, 0, 0.02, -dims.len - dims.barrel / 2 + 0.1); // barrel
    add(0.06, 0.16, 0.09, 0, -0.12, 0.08, grip);                   // grip
    add(0.05, 0.08, 0.22, 0, -0.06, -0.08);                        // magazine
    add(0.02, 0.05, 0.02, 0, 0.075, -dims.len + 0.05, accent);     // front sight
    if (kind === 'sniper' || kind === 'rifle') add(0.05, 0.05, 0.22, 0, 0.08, -0.25); // scope
  }
  buildGun('pistol');

  let kick = 0;
  let reloadDip = 0;

  return {
    renderer,
    scene,
    camera,
    buildGun,
    kickViewmodel(amount) { kick = Math.min(1, kick + amount); },
    reloadDip() { reloadDip = 1; },
    setCamera(x, y, z, yaw, pitch) {
      camera.position.set(x, y, z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    },
    tracer(from, to) {
      const t = tracerPool[tracerI];
      tracerI = (tracerI + 1) % TRACERS;
      const p = t.line.geometry.attributes.position.array;
      p[0] = from.x; p[1] = from.y; p[2] = from.z;
      p[3] = to.x; p[4] = to.y; p[5] = to.z;
      t.line.geometry.attributes.position.needsUpdate = true;
      t.line.material.opacity = 0.9;
      t.life = 0.09;
    },
    impact(x, y, z) {
      for (let i = 0; i < 10; i += 1) {
        const s = sparkI;
        sparkI = (sparkI + 1) % SPARKS;
        sparkPos[s * 3] = x;
        sparkPos[s * 3 + 1] = y;
        sparkPos[s * 3 + 2] = z;
        sparkVel[s * 3] = (Math.random() - 0.5) * 4;
        sparkVel[s * 3 + 1] = Math.random() * 3;
        sparkVel[s * 3 + 2] = (Math.random() - 0.5) * 4;
        sparkLife[s] = 0.35 + Math.random() * 0.25;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    },
    muzzle(x, y, z) {
      muzzleLight.position.set(x, y, z);
      muzzleLight.intensity = 26;
      flashLife = 0.05;
      flashMat.opacity = 0.95;
      flash.rotation.z = Math.random() * Math.PI;
    },
    explosion(x, y, z) {
      boom.position.set(x, y + 0.6, z);
      boomLife = 0.7;
      boomLight.position.set(x, y + 1.5, z);
      boomLight.intensity = 120;
      this.impact(x, y + 0.5, z);
      this.impact(x, y + 0.5, z);
      this.impact(x, y + 0.5, z);
    },
    update(dt, moveSpeed, time) {
      for (const t of tracerPool) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
        }
      }
      let anySpark = false;
      for (let i = 0; i < SPARKS; i += 1) {
        if (sparkLife[i] <= 0) continue;
        anySpark = true;
        sparkLife[i] -= dt;
        sparkVel[i * 3 + 1] -= 9 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        if (sparkLife[i] <= 0) sparkPos[i * 3 + 1] = -100;
      }
      if (anySpark) sparkGeo.attributes.position.needsUpdate = true;
      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) { flashMat.opacity = 0; muzzleLight.intensity = 0; }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        const k = Math.max(0, boomLife / 0.7);
        boom.scale.setScalar(1 + (1 - k) * 7);
        boomMat.opacity = k * 0.55;
        boomLight.intensity = k * 120;
        if (boomLife <= 0) { boomMat.opacity = 0; boomLight.intensity = 0; }
      }
      // viewmodel: bob with movement, kick decay, reload dip
      kick = Math.max(0, kick - dt * 6);
      reloadDip = Math.max(0, reloadDip - dt * 1.4);
      const bob = moveSpeed > 0.3 ? Math.sin(time * 10) * 0.008 * Math.min(1, moveSpeed / 4) : 0;
      gunGroup.position.set(0.28, -0.24 + bob - reloadDip * 0.12, -0.5 + kick * 0.09);
      gunGroup.rotation.x = kick * 0.14 + reloadDip * 0.5;
    },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    },
  };
}
