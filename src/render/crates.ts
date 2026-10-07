import * as THREE from 'three';
import { MODS, RES, Res, RES_INFO } from '../sim/defs';
import { Mod, Sim, amountKeys } from '../sim/sim';

const CS = 0.26;
const GAP = 0.03;
const BASE_Y = 0.5;
const MAX = 5000;
const STORE_RES = RES.filter((r) => r !== 'ewaste');

interface Col { res: Res; x: number; z: number; foot: 1 | 2; cap: number; count: number }

/** Where each resource stack sits on a module, and how many crates it shows. */
function columns(m: Mod): Col[] {
  const def = MODS[m.type];
  const cols: Col[] = [];
  if (!m.built) {
    const ks = amountKeys(def.cost);
    ks.forEach((r, i) => cols.push({ res: r, x: (i - (ks.length - 1) / 2) * 0.6, z: 0, foot: 1, cap: 12, count: m.inv[r] }));
    return cols;
  }
  if (m.type === 'core') {
    STORE_RES.forEach((r, i) => {
      const a = (i / STORE_RES.length) * Math.PI * 2 + 0.3;
      cols.push({ res: r, x: Math.sin(a) * 2.75, z: Math.cos(a) * 2.75, foot: 2, cap: 20, count: m.inv[r] });
    });
    return cols;
  }
  if (m.type === 'dome') {
    STORE_RES.forEach((r, i) => {
      const c = i % 4, row = Math.floor(i / 4);
      cols.push({ res: r, x: (c - 1.5) * 1.1, z: (row - 0.5) * 1.3, foot: 2, cap: 24, count: m.inv[r] });
    });
    return cols;
  }
  const R = def.radius;
  if (def.recipe) {
    amountKeys(def.recipe.in).forEach((r, i) => cols.push({ res: r, x: -R * 0.7, z: (i - 0.5) * 0.55, foot: 1, cap: 6, count: m.inv[r] }));
    const outs = RES.filter((r) => m.out[r] > 0 || def.recipe!.out[r]);
    outs.forEach((r, i) => cols.push({ res: r, x: R * 0.7, z: (i - 0.5) * 0.55, foot: 1, cap: 6, count: m.out[r] }));
  }
  if (def.auto) cols.push({ res: def.auto.res, x: R * 0.62, z: 0.6, foot: 1, cap: 6, count: m.out[def.auto.res] });
  if (def.sink) cols.push({ res: def.sink.res, x: -R * 0.6, z: 0.6, foot: 2, cap: 8, count: m.inv[def.sink.res] });
  return cols;
}

/** Instanced crates stacked on every module, derived from sim counts. */
export class Crates {
  private body: THREE.InstancedMesh;
  private strip: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);
  private bodyCol: Record<Res, THREE.Color>;
  private stripCol: Record<Res, THREE.Color>;

  constructor(scene: THREE.Scene) {
    this.body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CS, CS, CS),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 }),
      MAX,
    );
    this.strip = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CS * 1.03, 0.05, CS * 1.03),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX,
    );
    this.body.count = 0;
    this.strip.count = 0;
    this.body.frustumCulled = false;
    this.strip.frustumCulled = false;
    scene.add(this.body, this.strip);
    this.bodyCol = Object.fromEntries(RES.map((r) => [r, new THREE.Color(RES_INFO[r].color).multiplyScalar(0.35)])) as Record<Res, THREE.Color>;
    this.stripCol = Object.fromEntries(RES.map((r) => [r, new THREE.Color(RES_INFO[r].color).multiplyScalar(1.6)])) as Record<Res, THREE.Color>;
  }

  update(sim: Sim) {
    let n = 0;
    for (const m of sim.mods.values()) {
      for (const c of columns(m)) {
        const count = Math.min(c.count, c.cap);
        for (let i = 0; i < count && n < MAX; i++) {
          let x = c.x, z = c.z, layer = i;
          if (c.foot === 2) {
            layer = Math.floor(i / 4);
            const w = i % 4;
            x += ((w % 2) - 0.5) * (CS + GAP);
            z += (Math.floor(w / 2) - 0.5) * (CS + GAP);
          }
          const y = BASE_Y + CS / 2 + layer * (CS + 0.02);
          this.v.set(m.x + x, y, m.z + z);
          this.m4.compose(this.v, this.q, this.one);
          this.body.setMatrixAt(n, this.m4);
          this.v.y += CS * 0.32;
          this.m4.compose(this.v, this.q, this.one);
          this.strip.setMatrixAt(n, this.m4);
          this.body.setColorAt(n, this.bodyCol[c.res]);
          this.strip.setColorAt(n, this.stripCol[c.res]);
          n++;
        }
      }
    }
    this.body.count = n;
    this.strip.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.strip.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.strip.instanceColor) this.strip.instanceColor.needsUpdate = true;
  }
}
