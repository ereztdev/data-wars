import {
  RES, Res, MODS, ModType, Amounts, START,
  OUT_CAP, CELL_TIME, GOAL, LINK_MAX, DRONE_SPEED, WORLD_R,
} from './defs';

export type Inv = Record<Res, number>;
export const zeroInv = (): Inv => ({ silicon: 0, coolant: 0, power: 0, wafer: 0, chip: 0, gpu: 0, compute: 0, ewaste: 0 });
export const invTotal = (i: Inv) => RES.reduce((a, r) => a + i[r], 0);
export const amountKeys = (a: Amounts) => Object.keys(a) as Res[];

export type Role = 'build' | 'operate' | 'carry';
export const ROLES: Role[] = ['build', 'operate', 'carry'];

export type Status = 'ok' | 'idle' | 'building' | 'waiting' | 'nocrew' | 'nopower' | 'clogged' | 'full' | 'paused';

export interface Mod {
  id: number;
  type: ModType;
  x: number;
  z: number;
  built: boolean;
  buildProg: number;
  /** Storage contents, producer input buffer, or construction materials delivered. */
  inv: Inv;
  /** Producer output buffer. */
  out: Inv;
  /** Units reserved to arrive. */
  incoming: Inv;
  /** Units reserved to leave. */
  outgoing: Inv;
  crew: number[];
  paused: boolean;
  working: boolean;
  prog: number;
  timer: number;
  status: Status;
  links: number[];
}

export type Task =
  | { kind: 'haul'; res: Res; from: number; to: number; stage: 'pickup' | 'deliver' }
  | { kind: 'operate'; at: number; stage: 'going' | 'working' };

export interface Drone {
  id: number;
  role: Role;
  /** Role to switch to once the current haul ends. */
  pending: Role | null;
  x: number;
  z: number;
  /** Last node reached. */
  node: number;
  path: number[];
  task: Task | null;
  carrying: Res | null;
  think: number;
}

export interface SimEvent { kind: 'info' | 'warn' | 'good'; msg: string }

export interface Sim {
  t: number;
  mods: Map<number, Mod>;
  /** Construction queue order (creation order). */
  order: number[];
  edges: [number, number][];
  drones: Drone[];
  droneById: Map<number, Drone>;
  nextId: number;
  gridTime: number;
  powered: boolean;
  active: number;
  fed: number;
  goal: number;
  won: boolean;
  wonAt: number;
  events: SimEvent[];
  lastBlackoutMsg: number;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

// ---------- setup ----------

function addMod(sim: Sim, type: ModType, x: number, z: number, link: number | null, built: boolean): Mod {
  const m: Mod = {
    id: sim.nextId++, type, x, z, built, buildProg: built ? 1 : 0,
    inv: zeroInv(), out: zeroInv(), incoming: zeroInv(), outgoing: zeroInv(),
    crew: [], paused: false, working: false, prog: 0, timer: 0, status: built ? 'idle' : 'building', links: [],
  };
  sim.mods.set(m.id, m);
  if (link !== null) {
    const o = sim.mods.get(link)!;
    m.links.push(o.id);
    o.links.push(m.id);
    sim.edges.push([o.id, m.id]);
  }
  if (!built) sim.order.push(m.id);
  return m;
}

function addDrone(sim: Sim, at: Mod, role: Role): Drone {
  const d: Drone = {
    id: sim.nextId++, role, pending: null, x: at.x, z: at.z, node: at.id,
    path: [], task: null, carrying: null, think: 0,
  };
  sim.drones.push(d);
  sim.droneById.set(d.id, d);
  return d;
}

export function createSim(): Sim {
  const sim: Sim = {
    t: 0, mods: new Map(), order: [], edges: [], drones: [], droneById: new Map(), nextId: 1,
    gridTime: CELL_TIME * 1.5, powered: true, active: 0, fed: 0, goal: GOAL, won: false, wonAt: 0, events: [], lastBlackoutMsg: -999,
  };
  const core = addMod(sim, 'core', 0, 0, null, true);
  for (const r of amountKeys(START.inv)) core.inv[r] = START.inv[r]!;
  for (const role of ROLES) for (let i = 0; i < START.drones[role]; i++) addDrone(sim, core, role);
  return sim;
}

// ---------- placement ----------

export interface PlaceCheck { ok: boolean; link: number | null; reason: string }

export function canPlace(sim: Sim, type: ModType, x: number, z: number): PlaceCheck {
  const def = MODS[type];
  if (Math.hypot(x, z) > WORLD_R) return { ok: false, link: null, reason: 'Out of bounds' };
  let best: Mod | null = null;
  let bd = Infinity;
  for (const m of sim.mods.values()) {
    const d = dist(x, z, m.x, m.z);
    if (d < def.radius + MODS[m.type].radius + 0.6) return { ok: false, link: m.id, reason: 'Too close to another module' };
    if (d < bd) { bd = d; best = m; }
  }
  if (!best || bd > LINK_MAX) return { ok: false, link: best?.id ?? null, reason: 'Too far from the network' };
  if (type === 'model' && [...sim.mods.values()].some((m) => m.type === 'model')) {
    return { ok: false, link: best.id, reason: 'Only one Model allowed' };
  }
  return { ok: true, link: best.id, reason: '' };
}

export function place(sim: Sim, type: ModType, x: number, z: number): Mod | null {
  const c = canPlace(sim, type, x, z);
  if (!c.ok || c.link === null) return null;
  return addMod(sim, type, x, z, c.link, false);
}

// ---------- roles ----------

export const effectiveRole = (d: Drone): Role => d.pending ?? d.role;

export function roleCounts(sim: Sim): Record<Role, number> {
  const c: Record<Role, number> = { build: 0, operate: 0, carry: 0 };
  for (const d of sim.drones) c[effectiveRole(d)]++;
  return c;
}

function pickDrone(sim: Sim, role: Role): Drone | null {
  let fallback: Drone | null = null;
  for (const d of sim.drones) {
    if (effectiveRole(d) !== role) continue;
    if (!d.task) return d;
    if (!fallback || (d.task.kind === 'operate' && d.task.stage === 'going')) fallback = d;
  }
  return fallback;
}

function changeRole(sim: Sim, d: Drone, to: Role) {
  if (d.task?.kind === 'operate') {
    const m = sim.mods.get(d.task.at)!;
    m.crew = m.crew.filter((id) => id !== d.id);
    d.task = null;
    d.path = [];
    d.role = to;
    d.pending = null;
    return;
  }
  if (d.task) { d.pending = to === d.role ? null : to; return; }
  d.role = to;
  d.pending = null;
}

/** Move one drone into (delta > 0) or out of (delta < 0) a role. */
export function shiftRole(sim: Sim, role: Role, delta: number): boolean {
  if (delta > 0) {
    for (const from of ['carry', 'build', 'operate'] as Role[]) {
      if (from === role) continue;
      const d = pickDrone(sim, from);
      if (d) { changeRole(sim, d, role); return true; }
    }
    return false;
  }
  const d = pickDrone(sim, role);
  if (!d) return false;
  changeRole(sim, d, role === 'carry' ? 'build' : 'carry');
  return true;
}

/** Pause or resume a module. Pausing sends its operators away and stops its input requests. */
export function togglePause(sim: Sim, id: number) {
  const m = sim.mods.get(id);
  if (!m || !m.built || m.type === 'core') return;
  m.paused = !m.paused;
  if (!m.paused) return;
  for (const did of m.crew) {
    const d = sim.droneById.get(did);
    if (d) { d.task = null; d.path = []; }
  }
  m.crew = [];
}

// ---------- graph ----------

export function findPath(sim: Sim, from: number, to: number): number[] | null {
  if (from === to) return [];
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    for (const n of sim.mods.get(c)!.links) {
      if (prev.has(n)) continue;
      prev.set(n, c);
      if (n === to) {
        const p = [to];
        let k = c;
        while (k !== from) { p.unshift(k); k = prev.get(k)!; }
        return p;
      }
      q.push(n);
    }
  }
  return null;
}

// ---------- inventory helpers ----------

const isStorage = (m: Mod) => m.built && !!MODS[m.type].storage;

export function storageFree(m: Mod): number {
  const cap = MODS[m.type].storage ?? 0;
  return cap - invTotal(m.inv) - invTotal(m.incoming);
}

/** Max units of a single resource one storage module will accept, so one item can't flood it. */
export const perResCap = (m: Mod) => Math.ceil((MODS[m.type].storage ?? 0) / 3);

const storageAccepts = (m: Mod, r: Res) =>
  r !== 'ewaste' && storageFree(m) > 0 && m.inv[r] + m.incoming[r] < perResCap(m);

/** Power cells the core keeps on hand for the grid, on top of normal storage rules. */
export const GRID_RESERVE = 8;

function available(m: Mod, r: Res): number {
  if (!m.built) return 0;
  return MODS[m.type].storage ? m.inv[r] - m.outgoing[r] : m.out[r] - m.outgoing[r];
}

function inputTarget(m: Mod, r: Res): number {
  const def = MODS[m.type];
  if (m.paused) return 0;
  if (m.type === 'core' && r === 'power') return GRID_RESERVE;
  if (def.recipe?.in[r]) return def.recipe.in[r]! * 2;
  if (def.sink?.res === r) return def.sink.buffer;
  return 0;
}

function needs(m: Mod): Res[] {
  const def = MODS[m.type];
  const out = def.recipe ? amountKeys(def.recipe.in) : [];
  if (def.sink) out.push(def.sink.res);
  if (m.type === 'core') out.push('power');
  return out;
}

const inputNeed = (m: Mod, r: Res) => inputTarget(m, r) - m.inv[r] - m.incoming[r];

function workingCrew(sim: Sim, m: Mod): number {
  let n = 0;
  for (const id of m.crew) {
    const t = sim.droneById.get(id)?.task;
    if (t?.kind === 'operate' && t.at === m.id && t.stage === 'working') n++;
  }
  return n;
}

export function storageTotals(sim: Sim): { inv: Inv; cap: number } {
  const inv = zeroInv();
  let cap = 0;
  for (const m of sim.mods.values()) {
    if (!isStorage(m)) continue;
    cap += MODS[m.type].storage!;
    for (const r of RES) inv[r] += m.inv[r];
  }
  return { inv, cap };
}

function takeFromStorage(sim: Sim, r: Res): boolean {
  for (const m of sim.mods.values()) {
    if (isStorage(m) && m.inv[r] - m.outgoing[r] > 0) { m.inv[r]--; return true; }
  }
  return false;
}

// ---------- job finding ----------

function nearest(sim: Sim, x: number, z: number, ok: (m: Mod) => boolean): Mod | null {
  let best: Mod | null = null;
  let bd = Infinity;
  for (const m of sim.mods.values()) {
    if (!ok(m)) continue;
    const d = dist(x, z, m.x, m.z);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

const nearestSource = (sim: Sim, r: Res, x: number, z: number) =>
  nearest(sim, x, z, (m) => available(m, r) > 0);

const nearestNeeder = (sim: Sim, r: Res, from: Mod) =>
  nearest(sim, from.x, from.z, (m) => m.id !== from.id && m.built && inputNeed(m, r) > 0);

const nearestStorageSpace = (sim: Sim, r: Res, from: Mod) =>
  nearest(sim, from.x, from.z, (m) => m.id !== from.id && isStorage(m) && storageAccepts(m, r));

const nearestStorageWith = (sim: Sim, r: Res, to: Mod) =>
  nearest(sim, to.x, to.z, (m) => m.id !== to.id && isStorage(m) && available(m, r) > 0);

function haul(r: Res, from: Mod, to: Mod): Task {
  from.outgoing[r]++;
  to.incoming[r]++;
  return { kind: 'haul', res: r, from: from.id, to: to.id, stage: 'pickup' };
}

function findOperate(sim: Sim, d: Drone): Task | null {
  const m = nearest(sim, d.x, d.z, (m) => m.built && !m.paused && MODS[m.type].crew > m.crew.length);
  if (!m) return null;
  m.crew.push(d.id);
  return { kind: 'operate', at: m.id, stage: 'going' };
}

function findBuild(sim: Sim, d: Drone): Task | null {
  for (const id of sim.order) {
    const m = sim.mods.get(id)!;
    if (m.built) continue;
    const cost = MODS[m.type].cost;
    for (const r of amountKeys(cost)) {
      if (cost[r]! - m.inv[r] - m.incoming[r] <= 0) continue;
      const src = nearestSource(sim, r, d.x, d.z);
      if (src) return haul(r, src, m);
    }
  }
  return null;
}

function findCarry(sim: Sim, d: Drone): Task | null {
  let best: { score: number; r: Res; from: Mod; to: Mod } | null = null;
  const consider = (score: number, r: Res, from: Mod, to: Mod) => {
    if (!best || score > best.score) best = { score, r, from, to };
  };
  for (const m of sim.mods.values()) {
    if (!m.built) continue;
    const def = MODS[m.type];
    // Push producer outputs out.
    if (!def.storage) {
      for (const r of RES) {
        if (m.out[r] - m.outgoing[r] <= 0) continue;
        const needer = nearestNeeder(sim, r, m);
        const to = needer ?? nearestStorageSpace(sim, r, m);
        if (!to) continue;
        const pri = r === 'ewaste' || r === 'power' ? 300 : needer ? 250 : 150;
        consider(pri - dist(d.x, d.z, m.x, m.z) - 0.5 * dist(m.x, m.z, to.x, to.z), r, m, to);
      }
    }
    // Pull inputs from storage.
    for (const r of needs(m)) {
      if (inputNeed(m, r) <= 0) continue;
      const src = nearestStorageWith(sim, r, m);
      if (!src) continue;
      consider(200 - dist(d.x, d.z, src.x, src.z) - 0.5 * dist(src.x, src.z, m.x, m.z), r, src, m);
    }
  }
  if (!best) return null;
  const b = best as { r: Res; from: Mod; to: Mod };
  return haul(b.r, b.from, b.to);
}

function assign(sim: Sim, d: Drone) {
  if (d.pending) { d.role = d.pending; d.pending = null; }
  const task = d.role === 'operate' ? findOperate(sim, d) : d.role === 'build' ? findBuild(sim, d) : findCarry(sim, d);
  if (!task) return;
  const target = task.kind === 'haul' ? task.from : task.at;
  const path = findPath(sim, d.node, target);
  if (path === null) { cancel(sim, d, task); return; }
  d.task = task;
  d.path = path;
}

function cancel(sim: Sim, d: Drone, t: Task) {
  if (t.kind === 'haul') {
    if (t.stage === 'pickup') sim.mods.get(t.from)!.outgoing[t.res]--;
    sim.mods.get(t.to)!.incoming[t.res]--;
  } else {
    const m = sim.mods.get(t.at)!;
    m.crew = m.crew.filter((id) => id !== d.id);
  }
  d.task = null;
  d.path = [];
}

// ---------- step ----------

function move(sim: Sim, d: Drone, dt: number) {
  let budget = DRONE_SPEED * dt;
  while (budget > 0 && d.path.length) {
    const n = sim.mods.get(d.path[0])!;
    const dx = n.x - d.x;
    const dz = n.z - d.z;
    const len = Math.hypot(dx, dz);
    if (len <= budget) {
      d.x = n.x; d.z = n.z; d.node = n.id; d.path.shift(); budget -= len;
    } else {
      d.x += (dx / len) * budget; d.z += (dz / len) * budget; budget = 0;
    }
  }
}

function updateDrone(sim: Sim, d: Drone, dt: number) {
  move(sim, d, dt);
  if (d.path.length) return;
  const t = d.task;
  if (!t) {
    d.think -= dt;
    if (d.think <= 0) { d.think = 0.25; assign(sim, d); }
    return;
  }
  if (t.kind === 'operate') {
    if (t.stage === 'going' && d.node === t.at) t.stage = 'working';
    return;
  }
  if (t.stage === 'pickup' && d.node === t.from) {
    const src = sim.mods.get(t.from)!;
    src.outgoing[t.res]--;
    const pool = MODS[src.type].storage ? src.inv : src.out;
    if (pool[t.res] <= 0) {
      sim.mods.get(t.to)!.incoming[t.res]--;
      d.task = null;
      return;
    }
    pool[t.res]--;
    d.carrying = t.res;
    t.stage = 'deliver';
    d.path = findPath(sim, d.node, t.to) ?? [];
    return;
  }
  if (t.stage === 'deliver' && d.node === t.to) {
    const dst = sim.mods.get(t.to)!;
    dst.incoming[t.res]--;
    dst.inv[t.res]++;
    d.carrying = null;
    d.task = null;
  }
}

function updateGrid(sim: Sim, dt: number) {
  sim.gridTime -= dt * (0.6 + 0.12 * sim.active);
  if (sim.gridTime < CELL_TIME * 0.5 && takeFromStorage(sim, 'power')) sim.gridTime += CELL_TIME;
  if (sim.gridTime < 0) sim.gridTime = 0;
  const was = sim.powered;
  sim.powered = sim.gridTime > 0;
  if (was && !sim.powered && sim.t - sim.lastBlackoutMsg > 30) {
    sim.lastBlackoutMsg = sim.t;
    sim.events.push({ kind: 'warn', msg: 'Blackout: the grid ran out of power cells. Build or staff more Wind pylons.' });
  }
}

function updateMod(sim: Sim, m: Mod, dt: number) {
  const def = MODS[m.type];
  if (!m.built) {
    m.status = 'building';
    const ready = amountKeys(def.cost).every((r) => m.inv[r] >= def.cost[r]!);
    if (!ready) return;
    m.buildProg += dt / def.buildTime;
    if (m.buildProg >= 1) {
      m.built = true;
      m.buildProg = 1;
      m.inv = zeroInv();
      m.status = 'idle';
      sim.order = sim.order.filter((id) => id !== m.id);
      sim.events.push({ kind: 'good', msg: `${def.name} online` });
    }
    return;
  }

  if (m.paused) { m.status = 'paused'; return; }

  if (def.auto) {
    if (m.out[def.auto.res] >= OUT_CAP) { m.status = 'full'; return; }
    m.status = 'ok';
    m.timer += dt;
    if (m.timer >= def.auto.every) { m.timer = 0; m.out[def.auto.res]++; }
    return;
  }

  if (def.sink) {
    const r = def.sink.res;
    if (def.sink.burnEvery) {
      if (m.inv[r] > 0) {
        m.status = 'ok';
        m.timer += dt;
        if (m.timer >= def.sink.burnEvery) { m.timer = 0; m.inv[r]--; }
      } else m.status = 'idle';
    } else {
      m.status = m.inv[r] > 0 || sim.fed > 0 ? 'ok' : 'idle';
      if (m.inv[r] > 0) {
        sim.fed += m.inv[r];
        m.inv[r] = 0;
        if (!sim.won && sim.fed >= sim.goal) {
          sim.won = true;
          sim.wonAt = sim.t;
          sim.events.push({ kind: 'good', msg: 'Training run complete' });
        }
      }
    }
    return;
  }

  if (!def.recipe) { m.status = 'ok'; return; }
  const rc = def.recipe;
  if (workingCrew(sim, m) < def.crew) { m.status = 'nocrew'; return; }
  if (def.power && !sim.powered) { m.status = 'nopower'; return; }
  if (m.working) {
    m.status = 'ok';
    sim.active++;
    m.prog += dt / rc.time;
    if (m.prog >= 1) {
      m.working = false;
      m.prog = 0;
      for (const r of amountKeys(rc.out)) m.out[r] += rc.out[r]!;
      if (rc.drone) {
        addDrone(sim, m, 'carry');
        sim.events.push({ kind: 'good', msg: 'New drone ready (assigned to Carry)' });
      }
    }
    return;
  }
  if (!amountKeys(rc.out).every((r) => m.out[r] + rc.out[r]! <= OUT_CAP)) { m.status = 'clogged'; return; }
  if (!amountKeys(rc.in).every((r) => m.inv[r] >= rc.in[r]!)) { m.status = 'waiting'; return; }
  for (const r of amountKeys(rc.in)) m.inv[r] -= rc.in[r]!;
  m.working = true;
  m.prog = 0;
  m.status = 'ok';
}

export function step(sim: Sim, dt: number) {
  sim.t += dt;
  sim.active = 0;
  for (const m of sim.mods.values()) updateMod(sim, m, dt);
  updateGrid(sim, dt);
  for (const d of sim.drones) updateDrone(sim, d, dt);
}
