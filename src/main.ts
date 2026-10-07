import './style.css';
import { createSim, step, place, canPlace, shiftRole, togglePause, Sim } from './sim/sim';
import { MODS, ModType, STEP } from './sim/defs';
import { View } from './render/view';
import { Hud } from './ui/hud';

let sim: Sim = createSim();
let view = new View(document.getElementById('app')!, sim);
let speed = 1;
let buildType: ModType | null = null;
let selected: number | null = null;

const hud = new Hud(sim, {
  onBuild: (t) => setBuild(t === buildType ? null : t),
  onRole: (r, d) => { if (!shiftRole(sim, r, d)) hud.toast('No drone available to move', 'warn'); },
  onSpeed: (s) => { speed = s; hud.setSpeed(s); },
  onPause: (id) => togglePause(sim, id),
  onRestart: restart,
});

function restart() {
  view.renderer.domElement.remove();
  sim = createSim();
  view = new View(document.getElementById('app')!, sim);
  bindCanvas();
  hud.setSim(sim);
  selected = null;
  setBuild(null);
}

function setBuild(t: ModType | null) {
  buildType = t;
  view.setGhost(t);
  hud.setBuild(t);
  if (t) selected = null;
}

let down: { x: number; y: number; b: number } | null = null;
function bindCanvas() {
  const c = view.renderer.domElement;
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
  c.addEventListener('pointermove', (e) => {
    if (!buildType) return;
    const p = view.pick(e.clientX, e.clientY);
    view.moveGhost(p, p ? canPlace(sim, buildType, p.x, p.z) : null);
  });
  c.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const b = down.b;
    down = null;
    if (moved > 6 || b !== 0) return;
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (buildType) {
      const check = canPlace(sim, buildType, p.x, p.z);
      if (!check.ok) { hud.toast(check.reason, 'warn'); return; }
      place(sim, buildType, p.x, p.z);
      if (!e.shiftKey) setBuild(null);
      return;
    }
    let best: number | null = null;
    let bd = Infinity;
    for (const m of sim.mods.values()) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < MODS[m.type].radius + 0.6 && d < bd) { bd = d; best = m.id; }
    }
    selected = best;
  });
}
bindCanvas();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setBuild(null); selected = null; }
  if (e.code === 'Space') {
    e.preventDefault();
    speed = speed === 0 ? 1 : 0;
    hud.setSpeed(speed);
  }
});

hud.toast('Build a Quarry and a Wind pylon to get started', 'info');

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt * speed;
  let n = 0;
  while (acc >= STEP && n < 400) { step(sim, STEP); acc -= STEP; n++; }
  view.update(dt, selected);
  hud.update(dt, selected);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Tells the splash screen in index.html that the game booted.
(window as unknown as { __dataWarsReady?: boolean }).__dataWarsReady = true;
window.dispatchEvent(new Event('datawars-ready'));
