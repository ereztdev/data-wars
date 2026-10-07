// Headless economy check: scripted build order, runs until the Model is fed or time runs out.
import { createSim, step, place, shiftRole, roleCounts, storageTotals, togglePause, Sim } from '../src/sim/sim';
import { MODS, ModType, STEP } from '../src/sim/defs';

const plan: [number, ModType, number, number][] = [
  [0, 'quarry', 8, 0],
  [0, 'pylon', 0, 8],
  [0, 'purifier', -8, 0],
  [0, 'scrapyard', -8, 8],
  [0, 'fab', 8, 8],
  [60, 'quarry', 8, -8],
  [60, 'pylon', 0, -8],
  [90, 'litho', 15, 4],
  [120, 'bay', -8, -8],
  [150, 'gpuasm', -15, 4],
  [210, 'datacenter', 15, -5],
  [270, 'model', -15, -5],
  [300, 'dome', 0, -16],
];

function openCrew(sim: Sim) {
  let n = 0;
  for (const m of sim.mods.values()) if (m.built) n += MODS[m.type].crew - m.crew.length;
  return n;
}

const sim = createSim();
const LIMIT = 3600;
let next = 0;
let lastLog = -1;
while (!sim.won && sim.t < LIMIT) {
  while (next < plan.length && sim.t >= plan[next][0]) {
    const [, type, x, z] = plan[next++];
    if (!place(sim, type, x, z)) console.log(`FAILED to place ${type} at ${x},${z}`);
  }
  // Every 5s: fill open operator slots from carriers, keep builders only while there is construction.
  if (Math.floor(sim.t / 5) !== Math.floor((sim.t - STEP) / 5)) {
    // Simple player policy: 40% carriers, 2 builders while anything is under construction, rest operate.
    const rc = roleCounts(sim);
    const total = sim.drones.length;
    const wantBuild = sim.order.length ? (sim.t < 300 ? 2 : 1) : 0;
    // Pause producers whose output is piling up in storage, resume when it runs low.
    const { inv } = storageTotals(sim);
    for (const m of sim.mods.values()) {
      const rc0 = MODS[m.type].recipe ?? null;
      const auto = MODS[m.type].auto ?? null;
      const outRes = rc0 ? (Object.keys(rc0.out).find((k) => k !== 'ewaste') as keyof typeof inv | undefined) : auto?.res;
      if (!m.built || !outRes) continue;
      if (!m.paused && inv[outRes] >= 22) togglePause(sim, m.id);
      else if (m.paused && inv[outRes] < 10) togglePause(sim, m.id);
    }
    const wantCarry = Math.max(3, Math.ceil(total * 0.4));
    if (rc.build > wantBuild) shiftRole(sim, 'build', -1);
    else if (rc.build < wantBuild) shiftRole(sim, 'build', 1);
    else if (rc.carry < wantCarry) shiftRole(sim, 'carry', 1);
    else if (openCrew(sim) > 0 && rc.carry > wantCarry) shiftRole(sim, 'operate', 1);
  }
  for (const e of sim.events.splice(0)) if (e.kind === 'warn') console.log(`  [${sim.t.toFixed(0)}s] ${e.msg}`);
  step(sim, STEP);
  const bucket = Math.floor(sim.t / 120);
  if (bucket !== lastLog) {
    lastLog = bucket;
    const { inv } = storageTotals(sim);
    const statuses = [...sim.mods.values()].map((m) => `${m.type}:${m.status}`).join(' ');
    console.log(`t=${sim.t.toFixed(0)}s fed=${sim.fed} drones=${sim.drones.length} ${JSON.stringify(roleCounts(sim))} grid=${sim.gridTime.toFixed(1)}`);
    console.log(`  store ${JSON.stringify(inv)}`);
    console.log(`  ${statuses}`);
  }
}
console.log(sim.won ? `WON at ${sim.wonAt.toFixed(0)}s` : `NOT WON after ${LIMIT}s (fed ${sim.fed}/${sim.goal})`);
(globalThis as { process?: { exitCode?: number } }).process!.exitCode = sim.won ? 0 : 1;
