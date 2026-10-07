import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MODS, ModType, WORLD_R } from '../sim/defs';
import { Mod, PlaceCheck, Sim, Status } from '../sim/sim';
import { buildModule, COL, MAT, ModuleVisual, neon } from './modules';
import { Crates } from './crates';
import { Drones } from './drones';

const STATUS_COLOR: Record<Status, number> = {
  ok: COL.TL, idle: 0x6a6a8a, building: COL.CY, waiting: 0xffb020, nocrew: 0xffb020,
  nopower: COL.RD, clogged: COL.RD, full: 0xffb020, paused: 0x8a6aff,
};

const MIN_D = 10, MAX_D = 80, NEAR_P = 0.95, FAR_P = 0.2;
const tiltFor = (d: number) => {
  const k = Math.min(1, Math.max(0, (d - MIN_D) / (MAX_D - MIN_D)));
  return NEAR_P + (FAR_P - NEAR_P) * Math.pow(k, 0.7);
};

interface ModEntry {
  built: boolean;
  v: ModuleVisual;
  orb: THREE.Mesh;
  orbMat: THREE.MeshBasicMaterial;
  progress: THREE.Mesh | null;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: MapControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private crates: Crates;
  private drones: Drones;
  private mods = new Map<number, ModEntry>();
  private visuals = new Map<number, ModuleVisual>();
  private edgesDrawn = 0;
  private ghost: { type: ModType; group: THREE.Group; line: THREE.Line; mat: THREE.MeshBasicMaterial } | null = null;
  private siteMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.CY).multiplyScalar(1.2), wireframe: true, transparent: true, opacity: 0.4, depthWrite: false });
  private selRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private crateTimer = 0;
  private polar = tiltFor(50);
  private t = 0;

  constructor(private el: HTMLElement, private sim: Sim) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(this.renderer.domElement);

    const BG = 0x0b0618;
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.FogExp2(BG, 0.008);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    const d0 = 50, az = 0.6;
    this.camera.position.set(d0 * Math.sin(this.polar) * Math.sin(az), d0 * Math.cos(this.polar), d0 * Math.sin(this.polar) * Math.cos(az));

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = MIN_D;
    this.controls.maxDistance = MAX_D;
    this.controls.zoomSpeed = 1.0;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomToCursor = true;
    this.controls.minPolarAngle = this.controls.maxPolarAngle = this.polar;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0x9a80ff, 0x2a1048, 2.6));
    const key = new THREE.DirectionalLight(0xcfeeff, 2.4);
    key.position.set(-20, 40, 20);
    this.scene.add(key);
    const coreLight = new THREE.PointLight(0xb070ff, 40, 30, 1.6);
    coreLight.position.set(0, 4, 0);
    this.scene.add(coreLight);

    this.buildEnvironment();

    this.crates = new Crates(this.scene);
    this.drones = new Drones(this.scene);

    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), neon(COL.WH, 1.3));
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.65, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildEnvironment() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1130, roughness: 0.85, metalness: 0.2 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(400, 200, COL.PK, 0x5a2da0);
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.5;
    grid.position.y = 0.02;
    this.scene.add(grid);
    const boundary = new THREE.Mesh(new THREE.RingGeometry(WORLD_R - 0.15, WORLD_R, 128), neon(COL.PU, 1.2));
    boundary.rotation.x = -Math.PI / 2;
    boundary.position.y = 0.03;
    this.scene.add(boundary);
    // Distant neon mountains.
    const hash = (i: number) => { const x = Math.sin(i * 12.9898 + 1.7) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + hash(i) * 0.1;
      const r = 130 + hash(i + 3) * 40;
      const h = 18 + hash(i + 9) * 30;
      const geo = new THREE.ConeGeometry(14 + hash(i + 5) * 12, h, 5);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1a1033, roughness: 1, metalness: 0 }));
      m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      this.scene.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: i % 2 ? COL.PK : COL.PU, transparent: true, opacity: 0.35 }));
      e.position.copy(m.position);
      this.scene.add(e);
    }
    // Drifting motes.
    const N = 1200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const pal = [new THREE.Color(COL.CY), new THREE.Color(COL.PK), new THREE.Color(COL.PU)];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (hash(i + 300) - 0.5) * 160;
      pos[i * 3 + 1] = hash(i + 400) * 16;
      pos[i * 3 + 2] = (hash(i + 500) - 0.5) * 160;
      const c = pal[i % 3];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.motes);
  }
  private motes!: THREE.Points;

  resize() {
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ground point under the pointer. */
  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  setGhost(type: ModType | null) {
    if (this.ghost) {
      this.scene.remove(this.ghost.group, this.ghost.line);
      this.ghost = null;
    }
    if (!type) return;
    const mat = new THREE.MeshBasicMaterial({ color: COL.TL, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false });
    const v = buildModule(type, mat);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: COL.TL }),
    );
    v.group.visible = false;
    line.visible = false;
    this.scene.add(v.group, line);
    this.ghost = { type, group: v.group, line, mat };
  }

  moveGhost(p: THREE.Vector3 | null, check: PlaceCheck | null) {
    if (!this.ghost) return;
    if (!p || !check) { this.ghost.group.visible = false; this.ghost.line.visible = false; return; }
    const g = this.ghost;
    g.group.visible = true;
    g.group.position.set(p.x, 0, p.z);
    const color = check.ok ? COL.TL : COL.RD;
    g.mat.color.setHex(color);
    (g.line.material as THREE.LineBasicMaterial).color.setHex(color);
    const link = check.link !== null ? this.sim.mods.get(check.link) : null;
    if (link) {
      const pos = g.line.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, p.x, 0.6, p.z);
      pos.setXYZ(1, link.x, 0.6, link.z);
      pos.needsUpdate = true;
      g.line.geometry.computeBoundingSphere();
      g.line.visible = true;
    } else g.line.visible = false;
  }

  focus(m: Mod) {
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(m.x, 0, m.z);
    this.camera.position.copy(this.controls.target).add(off);
  }

  private addRoad(a: Mod, b: Mod) {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const road = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, len), MAT.dark);
    road.position.set(mx, 0.05, mz);
    road.rotation.y = ry;
    this.scene.add(road);
    const px = -dz / len, pz = dx / len;
    for (const [o, c] of [[-0.55, COL.CY], [0.55, COL.PU]] as [number, number][]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), neon(c, 1.3));
      line.position.set(mx + px * o, 0.12, mz + pz * o);
      line.rotation.y = ry;
      this.scene.add(line);
    }
  }

  private syncModules() {
    for (const m of this.sim.mods.values()) {
      let e = this.mods.get(m.id);
      if (!e || e.built !== m.built) {
        if (e) {
          this.scene.remove(e.v.group, e.orb);
          if (e.progress) this.scene.remove(e.progress);
        }
        const v = buildModule(m.type, m.built ? null : this.siteMat);
        v.group.position.set(m.x, 0, m.z);
        this.scene.add(v.group);
        const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), orbMat);
        orb.position.set(m.x, v.statusY, m.z);
        this.scene.add(orb);
        let progress: THREE.Mesh | null = null;
        if (!m.built) {
          const r = MODS[m.type].radius + 0.35;
          progress = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.18, 64, 1), neon(COL.CY, 1.6));
          progress.rotation.x = -Math.PI / 2;
          progress.position.set(m.x, 0.08, m.z);
          this.scene.add(progress);
        }
        e = { built: m.built, v, orb, orbMat, progress };
        this.mods.set(m.id, e);
        this.visuals.set(m.id, v);
      }
      e.orbMat.color.setHex(STATUS_COLOR[m.status]).multiplyScalar(1.6);
      if (e.progress) e.progress.geometry.setDrawRange(0, Math.floor(m.buildProg * 64) * 6);
    }
    while (this.edgesDrawn < this.sim.edges.length) {
      const [a, b] = this.sim.edges[this.edgesDrawn++];
      this.addRoad(this.sim.mods.get(a)!, this.sim.mods.get(b)!);
    }
  }

  update(dt: number, selected: number | null) {
    this.t += dt;
    const t = this.t;

    // Zoom drives tilt: top-down when far, low and cinematic when near.
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.polar += (tiltFor(dist) - this.polar) * Math.min(1, dt * 6);
    this.controls.minPolarAngle = this.controls.maxPolarAngle = this.polar;
    const tg = this.controls.target;
    const lim = WORLD_R;
    const len = Math.hypot(tg.x, tg.z);
    if (len > lim) {
      const f = lim / len, ox = tg.x, oz = tg.z;
      tg.x *= f; tg.z *= f;
      this.camera.position.x -= ox - tg.x;
      this.camera.position.z -= oz - tg.z;
    }
    tg.y = 0;
    this.controls.update();

    this.syncModules();
    for (const [id, e] of this.mods) {
      const m = this.sim.mods.get(id)!;
      const k = m.status === 'ok' ? 1 : m.status === 'building' ? 0 : 0.15;
      e.v.anim(t, m.type === 'model' ? Math.min(1, this.sim.fed / this.sim.goal) : k);
      e.orb.position.y = e.v.statusY + Math.sin(t * 2 + id) * 0.08;
    }

    this.crateTimer -= dt;
    if (this.crateTimer <= 0) { this.crateTimer = 0.1; this.crates.update(this.sim); }
    this.drones.update(this.sim, dt, t, this.visuals);

    const sel = selected !== null ? this.sim.mods.get(selected) : null;
    this.selRing.visible = !!sel;
    if (sel) {
      const r = MODS[sel.type].radius + 0.7;
      this.selRing.scale.setScalar(r);
      this.selRing.position.set(sel.x, 0.15 + Math.sin(t * 3) * 0.05, sel.z);
    }

    this.motes.rotation.y = t * 0.01;
    this.composer.render();
  }
}
