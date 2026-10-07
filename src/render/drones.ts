import * as THREE from 'three';
import { RES, Res, RES_INFO } from '../sim/defs';
import { Role, Sim } from '../sim/sim';
import { ModuleVisual } from './modules';

export const ROLE_COLOR: Record<Role, number> = { build: 0x4da3ff, operate: 0x3dffc5, carry: 0xffe14d };

const MAX = 600;

interface Vis { x: number; y: number; z: number; yaw: number }

/** Instanced drones: body, role-colored eye, carried crate. */
export class Drones {
  private body: THREE.InstancedMesh;
  private eye: THREE.InstancedMesh;
  private cargo: THREE.InstancedMesh;
  private vis = new Map<number, Vis>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private roleCol: Record<Role, THREE.Color>;
  private resCol: Record<Res, THREE.Color>;

  constructor(scene: THREE.Scene) {
    const bodyGeo = new THREE.OctahedronGeometry(0.34);
    bodyGeo.scale(1, 0.55, 1);
    this.body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x4a3f70, roughness: 0.3, metalness: 0.7 }), MAX);
    this.eye = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.cargo = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    for (const m of [this.body, this.eye, this.cargo]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.roleCol = {
      build: new THREE.Color(ROLE_COLOR.build).multiplyScalar(1.7),
      operate: new THREE.Color(ROLE_COLOR.operate).multiplyScalar(1.7),
      carry: new THREE.Color(ROLE_COLOR.carry).multiplyScalar(1.7),
    };
    this.resCol = Object.fromEntries(RES.map((r) => [r, new THREE.Color(RES_INFO[r].color).multiplyScalar(1.3)])) as Record<Res, THREE.Color>;
  }

  update(sim: Sim, dt: number, t: number, visuals: Map<number, ModuleVisual>) {
    const k = Math.min(1, dt * 10);
    let n = 0;
    for (const d of sim.drones) {
      if (n >= MAX) break;
      let tx = d.x, tz = d.z, ty = 1.4;
      if (d.task?.kind === 'operate' && d.task.stage === 'working') {
        const m = sim.mods.get(d.task.at)!;
        const a = t * 0.8 + d.id * 2.1;
        tx = m.x + Math.cos(a) * 1.0;
        tz = m.z + Math.sin(a) * 1.0;
        ty = (visuals.get(m.id)?.statusY ?? 3) - 0.9;
      } else if (!d.task && d.path.length === 0) {
        const m = sim.mods.get(d.node)!;
        const a = t * 0.35 + d.id * 1.7;
        const r = 1.8 + (d.id % 3) * 0.45;
        tx = m.x + Math.cos(a) * r;
        tz = m.z + Math.sin(a) * r;
        ty = 2.0 + (d.id % 2) * 0.4;
      }
      ty += Math.sin(t * 3 + d.id) * 0.08;
      let v = this.vis.get(d.id);
      if (!v) { v = { x: tx, y: ty, z: tz, yaw: 0 }; this.vis.set(d.id, v); }
      const dx = tx - v.x, dz = tz - v.z;
      if (dx * dx + dz * dz > 1e-4) v.yaw = Math.atan2(dx, dz);
      v.x += dx * k; v.y += (ty - v.y) * k; v.z += dz * k;

      this.e.set(0, v.yaw, 0);
      this.q.setFromEuler(this.e);
      this.p.set(v.x, v.y, v.z);
      this.s.set(1, 1, 1);
      this.m4.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(n, this.m4);
      this.p.y += 0.12;
      this.m4.compose(this.p, this.q, this.s);
      this.eye.setMatrixAt(n, this.m4);
      this.eye.setColorAt(n, this.roleCol[d.role]);
      this.p.y -= 0.42;
      this.s.setScalar(d.carrying ? 1 : 0);
      this.m4.compose(this.p, this.q, this.s);
      this.cargo.setMatrixAt(n, this.m4);
      this.cargo.setColorAt(n, this.resCol[d.carrying ?? 'silicon']);
      n++;
    }
    for (const m of [this.body, this.eye, this.cargo]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
