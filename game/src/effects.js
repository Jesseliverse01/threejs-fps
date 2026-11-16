// Emberline effects: pooled tracers, impact sparks and explosion flashes.
// Pools are fixed at construction; the sim never allocates in the hot loop.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_BURSTS = 16;
const SPARKS = 10;

export function createEffects(scene) {
  const tracers = [];
  const tracerGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_TRACERS * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(tracerGeo, tracerMat);
  lines.frustumCulled = false;
  scene.add(lines);

  const bursts = [];
  const burstGeo = new THREE.BufferGeometry();
  const bpos = new Float32Array(MAX_BURSTS * SPARKS * 3);
  burstGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  const burstMat = new THREE.PointsMaterial({ color: 0xffb37a, size: 0.14, transparent: true, opacity: 0.95 });
  const points = new THREE.Points(burstGeo, burstMat);
  points.frustumCulled = false;
  scene.add(points);

  const flash = new THREE.PointLight(0xffc46b, 0, 9, 1.6);
  scene.add(flash);

  const boom = new THREE.PointLight(0xff6a1f, 0, 26, 1.4);
  scene.add(boom);

  const fx = {
    tracerCursor: 0,
    burstCursor: 0,
    tracerLife: new Float32Array(MAX_TRACERS),
    burstLife: new Float32Array(MAX_BURSTS),
    burstVel: new Float32Array(MAX_BURSTS * SPARKS * 3),
    flashT: 0,
    boomT: 0,
    tracer(ax, ay, az, bx, by, bz) {
      const i = fx.tracerCursor;
      fx.tracerCursor = (fx.tracerCursor + 1) % MAX_TRACERS;
      positions[i * 6] = ax; positions[i * 6 + 1] = ay; positions[i * 6 + 2] = az;
      positions[i * 6 + 3] = bx; positions[i * 6 + 4] = by; positions[i * 6 + 5] = bz;
      fx.tracerLife[i] = 0.07;
      tracerGeo.attributes.position.needsUpdate = true;
    },
    spark(x, y, z) {
      const i = fx.burstCursor;
      fx.burstCursor = (fx.burstCursor + 1) % MAX_BURSTS;
      for (let s = 0; s < SPARKS; s++) {
        const o = (i * SPARKS + s) * 3;
        bpos[o] = x; bpos[o + 1] = y; bpos[o + 2] = z;
        const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
        const sp = 2 + Math.random() * 3;
        fx.burstVel[o] = Math.cos(a) * Math.cos(e) * sp;
        fx.burstVel[o + 1] = Math.sin(e) * sp + 1.5;
        fx.burstVel[o + 2] = Math.sin(a) * Math.cos(e) * sp;
      }
      fx.burstLife[i] = 0.4;
      burstGeo.attributes.position.needsUpdate = true;
    },
    muzzle(x, y, z) {
      flash.position.set(x, y, z);
      flash.intensity = 26;
      fx.flashT = 0.05;
    },
    explosion(x, y, z) {
      boom.position.set(x, y + 1, z);
      boom.intensity = 220;
      fx.boomT = 0.5;
      fx.spark(x, y + 0.5, z);
      fx.spark(x, y + 0.5, z);
    },
    update(dt) {
      for (let i = 0; i < MAX_TRACERS; i++) {
        if (fx.tracerLife[i] > 0) {
          fx.tracerLife[i] -= dt;
          if (fx.tracerLife[i] <= 0) {
            positions[i * 6 + 3] = positions[i * 6];
            positions[i * 6 + 4] = positions[i * 6 + 1];
            positions[i * 6 + 5] = positions[i * 6 + 2];
            tracerGeo.attributes.position.needsUpdate = true;
          }
        }
      }
      for (let i = 0; i < MAX_BURSTS; i++) {
        if (fx.burstLife[i] > 0) {
          fx.burstLife[i] -= dt;
          for (let s = 0; s < SPARKS; s++) {
            const o = (i * SPARKS + s) * 3;
            bpos[o] += fx.burstVel[o] * dt;
            bpos[o + 1] += fx.burstVel[o + 1] * dt;
            bpos[o + 2] += fx.burstVel[o + 2] * dt;
            fx.burstVel[o + 1] -= 9 * dt;
            if (bpos[o + 1] < 0.03) bpos[o + 1] = 0.03;
          }
          burstGeo.attributes.position.needsUpdate = true;
        }
      }
      if (fx.flashT > 0) { fx.flashT -= dt; if (fx.flashT <= 0) flash.intensity = 0; }
      if (fx.boomT > 0) { fx.boomT -= dt; boom.intensity = Math.max(0, fx.boomT * 440); }
    },
  };
  return fx;
}
