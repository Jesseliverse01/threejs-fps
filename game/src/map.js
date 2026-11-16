// Emberline map: "Cinder Yard", an industrial scrapyard at dusk.
// Coordinates: x east, z south, ground y = 0. Walls are AABBs {x1,z1,x2,z2,h}.
// Two bomb sites: A "Silo" (north-west) and B "Crane" (south-east), joined by
// A-long (west), B-long (east) and a mid lane through the dozer block.
import * as THREE from 'three';

export const MAP = { x1: -32, x2: 32, z1: -24, z2: 24 };

// [x1, z1, x2, z2, height]
export const WALLS = [
  // outer boundary
  [-32, -24, 32, -23, 4], [-32, 23, 32, 24, 4], [-32, -24, -31, 24, 4], [31, -24, 32, 24, 4],
  // north row blocks
  [-28, -22, -26, -10, 3], [-18, -22, -14, -12, 3], [-6, -22, -2, -14, 3],
  [6, -22, 10, -14, 3], [18, -22, 22, -12, 3],
  // west / east mid blocks
  [-28, 2, -26, 12, 3], [26, -10, 28, -2, 3],
  // mid lane blocks
  [-18, -4, -10, 4, 2.6], [10, -4, 18, 4, 2.6], [-2, -6, 2, 6, 3],
  // south row blocks
  [-28, 14, -20, 18, 2.4], [20, -18, 28, -14, 2.4], [12, 10, 18, 20, 3], [-12, 10, -6, 20, 3],
  [24, 2, 28, 10, 2.6],
  // low crates: block movement, not sight (eye 1.62 clears 1.2)
  [-15, -9, -13, -7, 1.2], [13, 7, 15, 9, 1.2], [-9, 11, -7, 13, 1.2], [7, -13, 9, -11, 1.2],
  [-1, 13, 1, 15, 1.2], [-23, 3, -21, 5, 1.2], [21, -5, 23, -3, 1.2], [3, -17, 5, -15, 1.2],
  [-5, 15, -3, 17, 1.2],
  // barrels (small blocks)
  [-19, -17, -18, -16, 1.1], [19, 16, 20, 17, 1.1], [5, 1, 6, 2, 1.1], [-6, -2, -5, -1, 1.1],
];

export const SITES = {
  A: { name: 'Silo', cx: -22, cz: -14, r: 5.5 },
  B: { name: 'Crane', cx: 22, cz: 14, r: 5.5 },
};

export const SPAWNS = {
  ember: [[-27, 20], [-25, 21], [-24, 19], [-28, 21], [-26, 19]],
  cinder: [[27, -20], [25, -21], [24, -19], [28, -21], [26, -19]],
};

// Waypoint graph: nodes placed in open lanes, edges only along clear lines.
// Verified with a segment-vs-wall checker: every node is clear of walls by
// more than the actor radius, and every edge crosses no wall.
export const WAYPOINTS = [
  [-27, 21], [-16, 21], [0, 21], [16, 21], [20, 21], [29, 21], [29, 8],
  [29, -8], [29, -19], [27, -21], [23, -21], [16, -21], [16, -12], [16, -6],
  [8, -7], [0, -8], [-8, -7], [-16, -11], [-24, -9], [-24, -19], [-22, -19],
  [-22, -14], [-29, -21], [-29, -8], [-29, 8], [-16, 6], [-8, 7], [0, 8],
  [8, 7], [16, 6], [20, 8], [22, 14], [20, 14], [4, 12], [4, 21], [-16, 12],
  [-24, 13], [-24, 8], [-24, -8], [-13, -11], [-13, -19], [24, -10],
  [24, -19], [16, -19], [-29, -9], [-29, 13], [-13, -22], [23, -2], [23, 6],
  [20, -6], [19, -2],
];
export const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [9, 10], [10, 42], [42, 8], [11, 43], [43, 12], [12, 13], [12, 41],
  [41, 49], [49, 50], [50, 47], [47, 48], [48, 30], [30, 32], [32, 31], [30, 29], [13, 14],
  [14, 15], [15, 16], [16, 39], [17, 18], [17, 39], [39, 40], [40, 46],
  [18, 19], [19, 20], [20, 21], [19, 21], [18, 44], [44, 22], [44, 23],
  [23, 24], [24, 45], [45, 36], [36, 35], [35, 1], [35, 25], [25, 26],
  [26, 27], [27, 28], [28, 29], [29, 30], [16, 26], [14, 28], [26, 28],
  [16, 14], [2, 33], [33, 27], [2, 34], [34, 4], [38, 37], [37, 36],
  [38, 18], [25, 37], [29, 48], [16, 40], [15, 40],
];

const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first path of waypoint indices from a to b.
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Int16Array(WAYPOINTS.length).fill(-1);
  const q = [a];
  prev[a] = a;
  while (q.length) {
    const n = q.shift();
    for (const m of ADJ[n]) {
      if (prev[m] < 0) {
        prev[m] = n;
        if (m === b) {
          const path = [b];
          let c = b;
          while (c !== a) { c = prev[c]; path.unshift(c); }
          return path;
        }
        q.push(m);
      }
    }
  }
  return [a];
}

export function inSite(site, x, z) {
  const s = SITES[site];
  const dx = x - s.cx, dz = z - s.cz;
  return dx * dx + dz * dz < s.r * s.r;
}

export function siteAt(x, z) {
  if (inSite('A', x, z)) return 'A';
  if (inSite('B', x, z)) return 'B';
  return null;
}

// Resolve a moving AABB (half-width h, height ht) against wall AABBs.
// pos is mutated in place; returns true if any collision happened.
export function collide(pos, half, ht) {
  let hit = false;
  for (const w of WALLS) {
    if (ht > w[4]) continue;
    if (pos.x + half > w[0] && pos.x - half < w[2] && pos.z + half > w[1] && pos.z - half < w[3]) {
      const dxl = pos.x + half - w[0], dxr = w[2] - (pos.x - half);
      const dzl = pos.z + half - w[1], dzr = w[3] - (pos.z - half);
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) pos.x = w[0] - half;
      else if (m === dxr) pos.x = w[2] + half;
      else if (m === dzl) pos.z = w[1] - half;
      else pos.z = w[3] + half;
      hit = true;
    }
  }
  if (pos.x - half < MAP.x1) { pos.x = MAP.x1 + half; hit = true; }
  if (pos.x + half > MAP.x2) { pos.x = MAP.x2 - half; hit = true; }
  if (pos.z - half < MAP.z1) { pos.z = MAP.z1 + half; hit = true; }
  if (pos.z + half > MAP.z2) { pos.z = MAP.z2 - half; hit = true; }
  return hit;
}

// 3D segment vs wall AABBs: returns nearest hit distance t in [0,1] or -1.
// Slab test, shared by bullets and line-of-sight.
export function segmentWallT(ax, ay, az, dx, dy, dz) {
  let best = -1;
  for (const w of WALLS) {
    let t0 = 0, t1 = 1;
    const mins = [w[0], 0, w[1]], maxs = [w[2], w[4], w[3]];
    const o = [ax, ay, az], d = [dx, dy, dz];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (o[i] < mins[i] || o[i] > maxs[i]) { ok = false; break; }
      } else {
        let ta = (mins[i] - o[i]) / d[i], tb = (maxs[i] - o[i]) / d[i];
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 >= 0 && t0 <= 1 && (best < 0 || t0 < best)) best = t0;
  }
  return best;
}

export function lineBlocked(ax, ay, az, bx, by, bz) {
  return segmentWallT(ax, ay, az, bx - ax, by - ay, bz - az) >= 0;
}

// --- rendering ----------------------------------------------------------------

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#453d33'; g.fillRect(0, 0, 512, 384);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * 512, Math.random() * 384, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  g.strokeStyle = 'rgba(232,100,31,0.35)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 192); g.lineTo(512, 192); g.stroke();
  g.strokeStyle = 'rgba(46,196,182,0.25)';
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 384); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  return t;
}

export function buildMap(scene) {
  const matWall = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9 });
  const matWallTop = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.85 });
  const matRust = new THREE.MeshStandardMaterial({ color: 0x8a4a26, roughness: 0.8, metalness: 0.25 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x6b5a34, roughness: 0.9 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.95 });
  const matTeal = new THREE.MeshStandardMaterial({ color: 0x1f6f68, roughness: 0.7, emissive: 0x0d3f3a });
  const matEmber = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.7, emissive: 0xcc5518, emissiveIntensity: 0.55 });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const addBox = (x1, z1, x2, z2, h, mat, y0 = 0) => {
    const m = new THREE.Mesh(box, mat);
    m.scale.set(x2 - x1, h, z2 - z1);
    m.position.set((x1 + x2) / 2, y0 + h / 2, (z1 + z2) / 2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  for (const w of WALLS) {
    const h = w[4];
    const mat = h <= 1.2 ? matCrate : (h <= 2.6 ? matWall : matRust);
    addBox(w[0], w[1], w[2], w[3], h, mat);
    if (h > 2) addBox(w[0], w[1], w[2], w[3], 0.12, matEmber, h);
  }

  // Site A silo: tall cylinder with hazard ring.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 7, 18), matTeal);
  silo.position.set(-24.5, 3.5, -16.5); silo.castShadow = true;
  scene.add(silo);
  const siloTop = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 18), matRust);
  siloTop.position.set(-24.5, 7.1, -16.5);
  scene.add(siloTop);

  // Site B crane: two legs and a jib of boxes.
  addBox(24, 10, 25, 11, 6, matDark);
  const jib = new THREE.Mesh(box, matRust);
  jib.scale.set(10, 0.5, 0.5); jib.position.set(21, 6.2, 10.5); jib.castShadow = true;
  scene.add(jib);
  const hook = new THREE.Mesh(box, matDark);
  hook.scale.set(0.3, 2.2, 0.3); hook.position.set(17, 5, 10.5);
  scene.add(hook);

  // Site rings on the ground.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.25, s.r, 40),
      new THREE.MeshBasicMaterial({ color: 0xe8641f, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.cx, 0.02, s.cz);
    scene.add(ring);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.2),
      new THREE.MeshBasicMaterial({ color: 0xe8641f, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(s.cx, 0.03, s.cz);
    scene.add(label);
  }

  // Perimeter light posts.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x22201e, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xff9a2a, emissiveIntensity: 1.6 });
  for (const [x, z] of [[-16, -20], [16, -20], [-16, 20], [16, 20], [0, -20], [0, 20]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 8), postMat);
    post.position.set(x, 2.2, z);
    scene.add(post);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMat);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
    const pl = new THREE.PointLight(0xff9a2a, 18, 16, 1.8);
    pl.position.set(x, 4.4, z);
    scene.add(pl);
  }

  // Dusk sun + sky.
  const sun = new THREE.DirectionalLight(0xffb37a, 2.2);
  sun.position.set(-30, 26, -14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x6b5b7a, 0x2a2118, 0.85));
  scene.fog = new THREE.Fog(0x3a2a2e, 40, 95);
  scene.background = new THREE.Color(0x2e2226);
}
