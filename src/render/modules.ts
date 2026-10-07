import * as THREE from 'three';
import { ModType, MODS } from '../sim/defs';

export const COL = {
  CY: 0x00f0ff, PK: 0xff2bd6, PU: 0x9b4dff, TL: 0x3dffc5, YE: 0xffe14d, OR: 0xff7a1a, WH: 0xffffff, RD: 0xff3355,
};

const std = (c: number, r = 0.5, m = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
export const MAT = {
  hull: std(0x3d3366, 0.45, 0.5),
  hull2: std(0x5a4c94, 0.35, 0.5),
  dark: std(0x151022, 0.8, 0.3),
};

const neonCache = new Map<number, THREE.MeshBasicMaterial>();
/** Unlit glowing material; values above 1 push it into the bloom pass. */
export function neon(c: number, boost = 1.6): THREE.MeshBasicMaterial {
  const key = c * 10 + Math.round(boost * 10);
  let m = neonCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(boost), side: THREE.DoubleSide });
    neonCache.set(key, m);
  }
  return m;
}

/** Fades from solid at the base to clear at the top (world Y), for open domes. */
function fadeMat(color: number, side: THREE.Side, emissive: number, ei: number, y0: number, y1: number) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.12, metalness: 0.3, emissive, emissiveIntensity: ei,
    transparent: true, depthWrite: false, side,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying float vWY;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;',
    );
    sh.fragmentShader = 'varying float vWY;\n' + sh.fragmentShader.replace(
      '#include <alphamap_fragment>',
      `#include <alphamap_fragment>\nfloat fa = 1.0 - smoothstep(${y0.toFixed(2)}, ${y1.toFixed(2)}, vWY);\ndiffuseColor.a *= fa * fa * 0.92 + 0.02;`,
    );
  };
  m.customProgramCacheKey = () => `fade-${y0}-${y1}`;
  return m;
}
const DOME_R = 3.0;
const domeShellBack = fadeMat(0x5b3fd6, THREE.BackSide, 0x2a0e6a, 0.9, 0.5, 3.4);
const domeShellFront = fadeMat(0x6a4cff, THREE.FrontSide, 0x2a0e6a, 0.9, 0.5, 3.4);
const domeRib = fadeMat(0x111111, THREE.FrontSide, COL.CY, 1.8, 0.5, 3.4);

export interface ModuleVisual {
  group: THREE.Group;
  anim: (t: number, intensity: number) => void;
  statusY: number;
}

type Parent = THREE.Object3D;
function add(p: Parent, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  p.add(m);
  return m;
}
const box = (p: Parent, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0) =>
  add(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
const cyl = (p: Parent, rt: number, rb: number, h: number, seg: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
  add(p, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
function band(p: Parent, r: number, y: number, col: number, h = 0.1, seg = 32, x = 0, z = 0) {
  return add(p, new THREE.CylinderGeometry(r, r, h, seg, 1, true), neon(col), x, y, z);
}
function ring(p: Parent, r: number, tube: number, col: number, y: number, x = 0, z = 0) {
  const m = add(p, new THREE.TorusGeometry(r, tube, 8, 64), neon(col), x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}
function hexBase(p: Parent, r: number, accent: number) {
  cyl(p, r, r * 1.06, 0.45, 6, MAT.hull, 0, 0.225, 0);
  cyl(p, r * 0.82, r * 0.82, 0.06, 6, MAT.dark, 0, 0.47, 0);
  for (let k = 0; k < 6; k++) {
    const a1 = (k * Math.PI) / 3;
    const a2 = ((k + 1) * Math.PI) / 3;
    const x1 = r * Math.sin(a1), z1 = r * Math.cos(a1), x2 = r * Math.sin(a2), z2 = r * Math.cos(a2);
    const bar = box(p, 0.09, 0.09, r, neon(accent), (x1 + x2) / 2, 0.47, (z1 + z2) / 2);
    bar.rotation.y = Math.atan2(x2 - x1, z2 - z1);
  }
}

type Builder = (g: THREE.Group, spin: [THREE.Object3D, 'x' | 'y' | 'z', number][]) => {
  statusY: number;
  anim?: (t: number, intensity: number) => void;
};

const B: Record<ModType, Builder> = {
  core: (g, spin) => {
    cyl(g, 1.6, 2.0, 1.4, 8, MAT.hull2, 0, 1.15, 0);
    band(g, 1.82, 1.2, COL.CY, 0.14, 8);
    cyl(g, 1.1, 1.5, 1.6, 8, MAT.hull, 0, 2.6, 0);
    band(g, 1.32, 2.4, COL.PK, 0.1, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      box(g, 0.28, 1.6, 0.28, MAT.hull2, Math.sin(a) * 1.9, 1.3, Math.cos(a) * 1.9, a);
      box(g, 0.1, 0.45, 0.1, neon(i % 2 ? COL.CY : COL.PU), Math.sin(a) * 2.05, 1.8, Math.cos(a) * 2.05);
    }
    add(g, new THREE.SphereGeometry(0.85, 32, 20), neon(0xb05cff, 1.15), 0, 4, 0);
    const rings = new THREE.Group();
    rings.position.set(0, 4, 0);
    g.add(rings);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 8, 64), neon(COL.CY));
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.045, 8, 64), neon(COL.PK));
    r2.rotation.x = 1.1;
    rings.add(r1, r2);
    spin.push([r1, 'x', 0.7], [r2, 'y', 0.9]);
    return { statusY: 5.6 };
  },
  relay: (g) => {
    cyl(g, 0.18, 0.3, 1.6, 8, MAT.hull2, 0, 1.25, 0);
    band(g, 0.25, 1.4, COL.CY, 0.08, 12);
    add(g, new THREE.OctahedronGeometry(0.28), neon(COL.CY), 0, 2.25, 0);
    return { statusY: 2.9 };
  },
  quarry: (g) => {
    box(g, 1.9, 1.1, 1.6, MAT.hull2, 0, 1.0, 0.1);
    box(g, 1.92, 0.1, 0.1, neon(COL.CY), 0, 1.3, 0.92);
    box(g, 0.5, 3.4, 0.5, MAT.hull, -0.55, 2.2, -0.5);
    box(g, 1.9, 0.28, 0.28, MAT.hull2, 0.2, 3.8, -0.5);
    cyl(g, 0.09, 0.09, 2.3, 8, MAT.hull2, 0.95, 2.7, -0.5);
    const drill = add(g, new THREE.ConeGeometry(0.3, 0.7, 6), neon(COL.CY), 0.95, 1.4, -0.5);
    drill.rotation.x = Math.PI;
    ring(g, 0.55, 0.04, COL.CY, 0.52, 0.95, -0.5);
    return {
      statusY: 4.6,
      anim: (t, k) => { drill.position.y = 1.4 + Math.sin(t * 6) * 0.18 * k; drill.rotation.y = t * 8 * k; },
    };
  },
  purifier: (g) => {
    for (const o of [-0.65, 0.65]) {
      cyl(g, 0.6, 0.6, 2.4, 24, MAT.hull2, o, 1.65, 0);
      add(g, new THREE.SphereGeometry(0.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.hull, o, 2.85, 0);
      for (const y of [1.0, 1.7, 2.4]) band(g, 0.62, y, COL.CY, 0.08, 24, o, 0);
    }
    const pipe = cyl(g, 0.12, 0.12, 1.3, 10, MAT.hull, 0, 2.2, 0);
    pipe.rotation.z = Math.PI / 2;
    const glow = add(g, new THREE.SphereGeometry(0.22, 12, 8), neon(COL.CY), 0, 2.2, 0);
    return { statusY: 4.0, anim: (t, k) => glow.scale.setScalar(1 + Math.sin(t * 4) * 0.25 * k) };
  },
  pylon: (g, spin) => {
    const tower = cyl(g, 0.22, 0.75, 4.4, 4, MAT.hull2, 0, 2.65, 0);
    tower.rotation.y = Math.PI / 4;
    for (const y of [1.6, 2.8, 3.9]) {
      const b = band(g, 0.75 - ((y - 0.45) / 4.4) * 0.53 + 0.04, y, COL.YE, 0.08, 4);
      b.rotation.y = Math.PI / 4;
    }
    const crystal = add(g, new THREE.OctahedronGeometry(0.6), neon(COL.YE, 1.8), 0, 5.6, 0);
    const halo = ring(g, 0.95, 0.035, COL.PK, 5.6);
    spin.push([halo, 'z', -0.6]);
    return { statusY: 6.8, anim: (t, k) => { crystal.rotation.y = t * 1.5 * (0.2 + k); } };
  },
  fab: (g) => {
    box(g, 2.0, 1.3, 1.7, MAT.hull2, 0, 1.15, 0);
    box(g, 2.02, 0.12, 0.12, neon(COL.PU), 0, 1.55, 0.86);
    box(g, 2.02, 0.12, 0.12, neon(COL.CY), 0, 0.95, 0.86);
    cyl(g, 0.32, 0.4, 2.0, 12, MAT.hull, 0.55, 2.8, -0.4);
    const top = band(g, 0.34, 3.6, COL.PU, 0.14, 16, 0.55, -0.4);
    for (let i = 0; i < 4; i++) box(g, 0.32, 0.05, 1.5, MAT.dark, -0.75 + i * 0.5, 1.82, 0);
    return { statusY: 4.4, anim: (t, k) => top.scale.set(1, 1 + Math.sin(t * 5) * 0.6 * k, 1) };
  },
  scrapyard: (g) => {
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + Math.PI / 6;
      box(g, 1.3, 0.55, 0.18, MAT.hull, Math.sin(a) * 1.55, 0.75, Math.cos(a) * 1.55, a + Math.PI / 2);
    }
    cyl(g, 0.7, 0.9, 1.6, 10, MAT.hull2, 0.3, 1.25, -0.2);
    const fire = add(g, new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16), neon(COL.OR, 2.2), 0.3, 2.08, -0.2);
    return { statusY: 3.2, anim: (t, k) => fire.scale.setScalar(0.7 + (Math.sin(t * 13) * 0.5 + 0.5) * 0.4 * (0.3 + k)) };
  },
  litho: (g, spin) => {
    box(g, 1.9, 1.1, 1.6, MAT.hull2, 0, 1.0, 0);
    box(g, 1.92, 0.1, 0.1, neon(COL.PK), 0, 1.3, 0.81);
    add(g, new THREE.SphereGeometry(0.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), neon(COL.PU, 1.3), 0, 1.55, 0);
    const r = ring(g, 1.0, 0.05, COL.PK, 2.3);
    spin.push([r, 'z', 1.2]);
    return { statusY: 3.6 };
  },
  gpuasm: (g) => {
    for (let i = 0; i < 3; i++) {
      box(g, 0.5, 1.9, 1.3, MAT.hull2, -0.7 + i * 0.6, 1.42, -0.15);
      for (let j = 0; j < 4; j++) box(g, 0.52, 0.06, 1.0, neon(COL.TL), -0.7 + i * 0.6, 0.8 + j * 0.42, -0.15);
    }
    const arm = new THREE.Group();
    arm.position.set(0, 2.5, 0.6);
    g.add(arm);
    box(arm, 0.18, 0.9, 0.18, MAT.hull, 0, 0.3, 0);
    box(arm, 1.1, 0.14, 0.14, MAT.hull, 0.45, 0.75, 0);
    add(arm, new THREE.SphereGeometry(0.12, 10, 8), neon(COL.TL), 1.0, 0.75, 0);
    return { statusY: 3.8, anim: (t, k) => { arm.rotation.y = Math.sin(t * 1.6) * 1.4 * k; } };
  },
  datacenter: (g) => {
    const leds: THREE.MeshBasicMaterial[] = [];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const x = -0.9 + i * 0.9, z = row ? 0.6 : -0.6;
        box(g, 0.7, 1.9, 0.75, MAT.hull2, x, 1.42, z);
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.WH).multiplyScalar(1.4) });
        leds.push(m);
        box(g, 0.72, 1.4, 0.04, m, x, 1.42, z + (row ? 0.38 : -0.38));
      }
    }
    box(g, 2.4, 0.12, 2.0, MAT.hull, 0, 2.43, 0);
    return {
      statusY: 3.6,
      anim: (t, k) => leds.forEach((m, i) => {
        const on = 0.25 + (Math.sin(t * (3 + i) + i * 1.7) * 0.5 + 0.5) * 1.3 * k;
        m.color.setRGB(on * 0.8, on, on * 1.1);
      }),
    };
  },
  bay: (g) => {
    // Lying cylinder half sunk into the base reads as a hangar.
    const hangar = add(g, new THREE.CylinderGeometry(1.15, 1.15, 2.2, 24), MAT.hull2, 0, 0.5, -0.2);
    hangar.rotation.x = Math.PI / 2;
    add(g, new THREE.RingGeometry(0.95, 1.05, 24, 1, 0, Math.PI), neon(COL.PK), 0, 0.5, 0.92);
    add(g, new THREE.RingGeometry(0.95, 1.05, 24, 1, 0, Math.PI), neon(COL.PK), 0, 0.5, -1.32);
    ring(g, 0.55, 0.04, COL.PK, 0.52, 1.4, 1.2);
    return { statusY: 2.6 };
  },
  dome: (g) => {
    const T0 = 0.5;
    const geo = new THREE.SphereGeometry(DOME_R, 48, 24, 0, Math.PI * 2, T0, Math.PI / 2 - T0);
    const back = add(g, geo, domeShellBack, 0, 0.5, 0);
    back.renderOrder = 8;
    const front = add(g, geo, domeShellFront, 0, 0.5, 0);
    front.renderOrder = 10;
    for (let k = 0; k < 10; k++) {
      const ph = (k * Math.PI) / 5;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const th = T0 + ((Math.PI / 2 - T0) * i) / 16;
        pts.push(new THREE.Vector3(DOME_R * 1.005 * Math.sin(th) * Math.cos(ph), 0.5 + DOME_R * 1.005 * Math.cos(th), DOME_R * 1.005 * Math.sin(th) * Math.sin(ph)));
      }
      const rib = add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.04, 6), domeRib);
      rib.renderOrder = 11;
    }
    ring(g, DOME_R * Math.sin(T0), 0.06, COL.PK, 0.5 + DOME_R * Math.cos(T0));
    ring(g, DOME_R, 0.07, COL.CY, 0.52);
    return { statusY: 4.0 };
  },
  model: (g, spin) => {
    const ob = add(g, new THREE.CylinderGeometry(0.5, 1.3, 5.5, 4), MAT.hull2, 0, 3.2, 0);
    ob.rotation.y = Math.PI / 4;
    for (const y of [1.4, 2.6, 3.8, 5.0]) {
      const b = band(g, 1.3 - ((y - 0.45) / 5.5) * 0.8 + 0.04, y, COL.PU, 0.1, 4);
      b.rotation.y = Math.PI / 4;
    }
    const brain = add(g, new THREE.IcosahedronGeometry(0.9, 1), neon(COL.PU, 1.2), 0, 7.2, 0);
    const wire = add(g, new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.PK).multiplyScalar(1.6), wireframe: true }), 0, 7.2, 0);
    const r1 = ring(g, 1.7, 0.05, COL.CY, 7.2);
    const r2 = ring(g, 2.1, 0.04, COL.PK, 7.2);
    spin.push([r1, 'y', 0.5], [r2, 'x', -0.4]);
    return {
      statusY: 9.0,
      anim: (t, k) => {
        brain.rotation.y = t * 0.6;
        wire.rotation.y = -t * 0.4;
        const s = 0.7 + k * 0.8 + Math.sin(t * 2) * 0.05;
        brain.scale.setScalar(s);
        (brain.material as THREE.MeshBasicMaterial).color.setRGB(0.6 * (0.6 + k), 0.3 * (0.6 + k), 1.0 * (0.6 + k) * 1.4);
      },
    };
  },
};

export function buildModule(type: ModType, ghost: THREE.Material | null): ModuleVisual {
  const g = new THREE.Group();
  const def = MODS[type];
  hexBase(g, def.radius, def.accent);
  const spin: [THREE.Object3D, 'x' | 'y' | 'z', number][] = [];
  const res = B[type](g, spin);
  if (ghost) {
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ghost; });
  }
  return {
    group: g,
    statusY: res.statusY,
    anim: (t, k) => {
      if (ghost) return;
      for (const [o, ax, sp] of spin) o.rotation[ax] = t * sp * (0.25 + k * 0.75);
      res.anim?.(t, k);
    },
  };
}
