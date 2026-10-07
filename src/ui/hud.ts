import { BUILD_ORDER, CELL_TIME, MODS, ModType, RES, Res, RES_INFO, Amounts } from '../sim/defs';
import { Role, ROLES, Sim, Status, roleCounts, storageTotals, amountKeys, invTotal, perResCap } from '../sim/sim';
import { ROLE_COLOR } from '../render/drones';

export interface HudHandlers {
  onBuild(t: ModType): void;
  onRole(r: Role, d: number): void;
  onSpeed(s: number): void;
  onPause(id: number): void;
  onRestart(): void;
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const $ = (id: string) => document.getElementById(id)!;

const STATUS_TEXT: Record<Status, [string, string]> = {
  ok: ['Running', 'var(--tl)'],
  idle: ['Idle', 'var(--mut)'],
  building: ['Under construction', 'var(--cy)'],
  waiting: ['Waiting for inputs', 'var(--ye)'],
  nocrew: ['Needs an operator', 'var(--ye)'],
  nopower: ['No power', 'var(--rd)'],
  clogged: ['Clogged: output not collected', 'var(--rd)'],
  full: ['Output full', 'var(--ye)'],
  paused: ['Paused', 'var(--pu)'],
};

const ROLE_INFO: Record<Role, string> = {
  build: 'Build: carry materials to construction',
  operate: 'Operate: staff producers',
  carry: 'Carry: move goods, haul e-waste',
};

const OBJECTIVES: [ModType, string][] = [
  ['quarry', 'Build a Quarry (silicon)'],
  ['pylon', 'Build a Wind pylon (power)'],
  ['purifier', 'Build a Purifier (coolant)'],
  ['fab', 'Build a Fab (wafers)'],
  ['scrapyard', 'Build a Scrapyard (e-waste)'],
  ['litho', 'Build a Litho lab (chips)'],
  ['bay', 'Build a Drone bay (more drones)'],
  ['gpuasm', 'Build a GPU assembler'],
  ['datacenter', 'Build a Datacenter (compute)'],
  ['model', 'Build The Model'],
];

const fmtAmounts = (a: Amounts) =>
  amountKeys(a).map((r) => `${a[r]} ${RES_INFO[r].name}`).join(' + ') || 'nothing';

export class Hud {
  private chips = new Map<Res, HTMLElement>();
  private capEl!: HTMLElement;
  private buildBtns = new Map<ModType, HTMLButtonElement>();
  private roleEls = new Map<Role, HTMLElement>();
  private speedBtns: HTMLButtonElement[] = [];
  private timer = 0;
  private infoId: number | null = -1;

  constructor(private sim: Sim, private h: HudHandlers) {
    this.buildResources();
    this.buildBuildMenu();
    this.buildDrones();
    this.buildSpeed();
  }

  setSim(sim: Sim) { this.sim = sim; this.infoId = -1; }

  private buildResources() {
    const el = $('res');
    for (const r of RES) {
      const c = document.createElement('div');
      c.className = 'chip';
      c.title = RES_INFO[r].name;
      c.innerHTML = `<i style="background:${hex(RES_INFO[r].color)};color:${hex(RES_INFO[r].color)}"></i><span class="n">0</span><span class="l">${RES_INFO[r].name}</span>`;
      el.appendChild(c);
      this.chips.set(r, c.querySelector('.n')!);
    }
    this.capEl = document.createElement('span');
    this.capEl.className = 'cap';
    el.appendChild(this.capEl);
  }

  private buildBuildMenu() {
    const el = $('build');
    for (const t of BUILD_ORDER) {
      const def = MODS[t];
      const b = document.createElement('button');
      b.title = def.desc;
      const cost = amountKeys(def.cost)
        .map((r) => `<span><i style="background:${hex(RES_INFO[r].color)}"></i>${def.cost[r]}</span>`).join('');
      b.innerHTML = `<span class="nm">${def.name}</span><span class="cost">${cost}</span>`;
      b.onclick = () => this.h.onBuild(t);
      el.appendChild(b);
      this.buildBtns.set(t, b);
    }
  }

  private buildDrones() {
    const el = $('drones');
    el.innerHTML = `<h3>Drones <span id="dtotal"></span></h3>`;
    for (const r of ROLES) {
      const row = document.createElement('div');
      row.className = 'role';
      row.title = ROLE_INFO[r];
      const c = hex(ROLE_COLOR[r]);
      row.innerHTML = `<i style="background:${c};color:${c}"></i><span>${r[0].toUpperCase() + r.slice(1)}</span><b>0</b><button aria-label="Fewer">−</button><button aria-label="More">+</button>`;
      const [minus, plus] = row.querySelectorAll('button');
      minus.onclick = () => this.h.onRole(r, -1);
      plus.onclick = () => this.h.onRole(r, 1);
      el.appendChild(row);
      this.roleEls.set(r, row.querySelector('b')!);
    }
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.id = 'dsub';
    el.appendChild(sub);
  }

  private buildSpeed() {
    const el = $('speed');
    ['Pause', '1x', '2x', '4x'].forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      const s = [0, 1, 2, 4][i];
      b.onclick = () => this.h.onSpeed(s);
      el.appendChild(b);
      this.speedBtns.push(b);
    });
    this.setSpeed(1);
  }

  setSpeed(s: number) {
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', [0, 1, 2, 4][i] === s));
  }

  setBuild(t: ModType | null) {
    for (const [k, b] of this.buildBtns) b.classList.toggle('on', k === t);
  }

  toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    const box = $('toasts');
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => t.remove(), 4200);
  }

  update(dt: number, selected: number | null) {
    for (const e of this.sim.events.splice(0)) this.toast(e.msg, e.kind);
    this.timer -= dt;
    if (this.timer > 0 && selected === this.infoId) return;
    this.timer = 0.2;

    const { inv, cap } = storageTotals(this.sim);
    for (const r of RES) this.chips.get(r)!.textContent = String(inv[r]);
    this.capEl.textContent = `${invTotal(inv)}/${cap} stored`;

    const pw = $('power');
    const frac = Math.min(1, this.sim.gridTime / (CELL_TIME * 1.5));
    pw.classList.toggle('out', !this.sim.powered);
    pw.innerHTML = `<span class="lbl">${this.sim.powered ? 'GRID' : 'BLACKOUT'}</span><div class="bar"><div style="width:${(frac * 100).toFixed(0)}%"></div></div>`;

    for (const [t, b] of this.buildBtns) {
      const cost = MODS[t].cost;
      b.classList.toggle('short', amountKeys(cost).some((r) => inv[r] < cost[r]!));
    }

    const rc = roleCounts(this.sim);
    for (const r of ROLES) this.roleEls.get(r)!.textContent = String(rc[r]);
    $('dtotal').textContent = `(${this.sim.drones.length})`;
    let open = 0;
    for (const m of this.sim.mods.values()) if (m.built && !m.paused) open += MODS[m.type].crew - m.crew.length;
    const idle = this.sim.drones.filter((d) => !d.task).length;
    $('dsub').innerHTML = `${open > 0 ? `<span style="color:var(--ye)">${open} producer${open > 1 ? 's' : ''} need operators</span><br>` : ''}${idle} idle · Pause a module to free its operator`;

    this.renderObjective();
    this.renderInfo(selected);
    this.renderBanner();
  }

  private renderObjective() {
    const has = (t: ModType) => [...this.sim.mods.values()].some((m) => m.type === t && m.built);
    const items = OBJECTIVES.map(([t, label]) => `<li class="${has(t) ? 'done' : ''}">${label}</li>`).join('');
    const pct = Math.min(100, (this.sim.fed / this.sim.goal) * 100);
    $('objective').innerHTML = `<h3>Training run</h3><ul>${items}</ul>
      <div class="sub">Feed The Model ${this.sim.fed}/${this.sim.goal} compute</div>
      <div class="prog"><div style="width:${pct.toFixed(0)}%"></div></div>`;
  }

  private renderInfo(selected: number | null) {
    this.infoId = selected;
    const el = $('info');
    const m = selected !== null ? this.sim.mods.get(selected) : undefined;
    if (!m) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const def = MODS[m.type];
    const [st, col] = STATUS_TEXT[m.status];
    let body = `<h3>${def.name}</h3><div class="st" style="color:${col}">${st}${m.built ? '' : ` · ${Math.round(m.buildProg * 100)}%`}</div><div class="sub">${def.desc}</div>`;
    if (!m.built) {
      body += `<div class="recipe">Materials: ${amountKeys(def.cost).map((r) => `${RES_INFO[r].name} ${m.inv[r]}/${def.cost[r]}`).join(' · ')}</div>`;
    } else {
      if (def.recipe) {
        const out = def.recipe.drone ? '1 Drone' : fmtAmounts(def.recipe.out);
        const inp = amountKeys(def.recipe.in).length ? `${fmtAmounts(def.recipe.in)} → ` : 'Produces ';
        body += `<div class="recipe">${inp}${out} · ${def.recipe.time}s</div>`;
      }
      if (def.auto) body += `<div class="recipe">1 ${RES_INFO[def.auto.res].name} every ${def.auto.every}s</div>`;
      if (def.storage) body += `<div class="recipe">Capacity ${invTotal(m.inv)}/${def.storage} · max ${perResCap(m)} per resource</div>`;
      if (def.crew) body += `<div class="row"><span>Operators</span><b>${m.crew.length}/${def.crew}</b></div>`;
      for (const r of RES) {
        const a = m.inv[r], b = m.out[r];
        if (a || b) body += `<div class="row"><span>${RES_INFO[r].name}</span><b>${def.recipe ? `${a} in · ${b} out` : a}</b></div>`;
      }
      if (m.type !== 'core' && (def.crew || def.auto)) body += `<button id="pausebtn">${m.paused ? 'Resume' : 'Pause'}</button>`;
    }
    el.innerHTML = body;
    const pb = document.getElementById('pausebtn');
    if (pb) pb.onclick = () => this.h.onPause(m.id);
  }

  private renderBanner() {
    const el = $('banner');
    if (!this.sim.won) { el.classList.add('hidden'); return; }
    if (!el.classList.contains('hidden')) return;
    el.classList.remove('hidden');
    const mins = Math.floor(this.sim.wonAt / 60), secs = Math.floor(this.sim.wonAt % 60);
    el.innerHTML = `<h2>TRAINING COMPLETE</h2><p>The Model is online. Time ${mins}:${String(secs).padStart(2, '0')} · ${this.sim.drones.length} drones</p><button id="again">Play again</button>`;
    document.getElementById('again')!.onclick = () => this.h.onRestart();
  }
}
