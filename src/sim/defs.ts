export type Res = 'silicon' | 'coolant' | 'power' | 'wafer' | 'chip' | 'gpu' | 'compute' | 'ewaste';

export const RES: Res[] = ['silicon', 'coolant', 'power', 'wafer', 'chip', 'gpu', 'compute', 'ewaste'];

export const RES_INFO: Record<Res, { name: string; color: number }> = {
  silicon: { name: 'Silicon', color: 0xa9bcd0 },
  coolant: { name: 'Coolant', color: 0x00e5ff },
  power: { name: 'Power cell', color: 0xffe14d },
  wafer: { name: 'Wafer', color: 0xb98cff },
  chip: { name: 'Chip', color: 0xff2bd6 },
  gpu: { name: 'GPU', color: 0x3dffc5 },
  compute: { name: 'Compute', color: 0xffffff },
  ewaste: { name: 'E-waste', color: 0xff7a1a },
};

export type ModType =
  | 'core' | 'relay' | 'quarry' | 'purifier' | 'pylon' | 'fab' | 'scrapyard'
  | 'litho' | 'gpuasm' | 'datacenter' | 'bay' | 'dome' | 'model';

export type Amounts = Partial<Record<Res, number>>;

export interface Recipe {
  in: Amounts;
  out: Amounts;
  time: number;
  /** Produces a drone instead of (or in addition to) items. */
  drone?: boolean;
}

export interface ModDef {
  name: string;
  desc: string;
  cost: Amounts;
  buildTime: number;
  radius: number;
  /** Operators required for the module to run. */
  crew: number;
  /** Needs grid power to run. */
  power: boolean;
  recipe?: Recipe;
  /** Produces on its own, no crew, no power. */
  auto?: { res: Res; every: number };
  /** Total storage capacity (storage modules only). */
  storage?: number;
  /** Consumes a resource on arrival. */
  sink?: { res: Res; buffer: number; burnEvery?: number };
  accent: number;
  buildable: boolean;
}

export const MODS: Record<ModType, ModDef> = {
  core: {
    name: 'Core', desc: 'Colony hub. Stores resources and burns power cells to keep the grid alive.',
    cost: {}, buildTime: 1, radius: 3.6, crew: 0, power: false, storage: 80, accent: 0x00f0ff, buildable: false,
  },
  relay: {
    name: 'Relay', desc: 'Cheap network node. Extends your reach.',
    cost: { silicon: 2 }, buildTime: 2, radius: 1.3, crew: 0, power: false, accent: 0x00f0ff, buildable: true,
  },
  quarry: {
    name: 'Quarry', desc: 'Mines silicon. Needs an operator and power.',
    cost: { silicon: 4 }, buildTime: 4, radius: 2.3, crew: 1, power: true,
    recipe: { in: {}, out: { silicon: 1 }, time: 3 }, accent: 0xa9bcd0, buildable: true,
  },
  purifier: {
    name: 'Purifier', desc: 'Produces coolant. Needs an operator and power.',
    cost: { silicon: 5 }, buildTime: 4, radius: 2.3, crew: 1, power: true,
    recipe: { in: {}, out: { coolant: 1 }, time: 3.5 }, accent: 0x00e5ff, buildable: true,
  },
  pylon: {
    name: 'Wind pylon', desc: 'Generates power cells on its own. No operator, no power needed.',
    cost: { silicon: 5, coolant: 1 }, buildTime: 4, radius: 2, crew: 0, power: false,
    auto: { res: 'power', every: 9 }, accent: 0xffe14d, buildable: true,
  },
  fab: {
    name: 'Fab', desc: 'Turns silicon and coolant into wafers. Throws off e-waste.',
    cost: { silicon: 6, coolant: 2 }, buildTime: 5, radius: 2.6, crew: 1, power: true,
    recipe: { in: { silicon: 2, coolant: 1 }, out: { wafer: 1, ewaste: 1 }, time: 4 }, accent: 0xb98cff, buildable: true,
  },
  scrapyard: {
    name: 'Scrapyard', desc: 'Burns e-waste so producers do not clog.',
    cost: { silicon: 4 }, buildTime: 3, radius: 2.3, crew: 0, power: false,
    sink: { res: 'ewaste', buffer: 8, burnEvery: 1.2 }, accent: 0xff7a1a, buildable: true,
  },
  litho: {
    name: 'Litho lab', desc: 'Etches wafers into chips. Throws off e-waste.',
    cost: { silicon: 5, wafer: 2 }, buildTime: 6, radius: 2.6, crew: 1, power: true,
    recipe: { in: { wafer: 1, coolant: 1 }, out: { chip: 1, ewaste: 1 }, time: 5 }, accent: 0xff2bd6, buildable: true,
  },
  gpuasm: {
    name: 'GPU assembler', desc: 'Assembles chips and power cells into GPUs.',
    cost: { silicon: 6, chip: 2 }, buildTime: 6, radius: 2.6, crew: 1, power: true,
    recipe: { in: { chip: 2, power: 1 }, out: { gpu: 1 }, time: 6 }, accent: 0x3dffc5, buildable: true,
  },
  datacenter: {
    name: 'Datacenter', desc: 'Runs GPUs with coolant to produce compute.',
    cost: { silicon: 8, coolant: 4, chip: 2 }, buildTime: 8, radius: 3, crew: 1, power: true,
    recipe: { in: { gpu: 1, coolant: 2 }, out: { compute: 3 }, time: 8 }, accent: 0xffffff, buildable: true,
  },
  bay: {
    name: 'Drone bay', desc: 'Builds new drones from chips and silicon.',
    cost: { silicon: 6, coolant: 2 }, buildTime: 6, radius: 2.6, crew: 1, power: true,
    recipe: { in: { chip: 1, silicon: 2 }, out: {}, time: 10, drone: true }, accent: 0xff2bd6, buildable: true,
  },
  dome: {
    name: 'Storage dome', desc: 'Extra storage. Open roof, so you can see the stock.',
    cost: { silicon: 6, coolant: 2 }, buildTime: 5, radius: 3.3, crew: 0, power: false,
    storage: 56, accent: 0x00f0ff, buildable: true,
  },
  model: {
    name: 'The Model', desc: 'Feed it compute to complete the training run and win.',
    cost: { silicon: 10, chip: 4, gpu: 1 }, buildTime: 10, radius: 3, crew: 0, power: false,
    sink: { res: 'compute', buffer: 6 }, accent: 0x9b4dff, buildable: true,
  },
};

export const BUILD_ORDER: ModType[] = [
  'relay', 'quarry', 'purifier', 'pylon', 'fab', 'scrapyard', 'litho', 'gpuasm', 'datacenter', 'bay', 'dome', 'model',
];

/** Fixed simulation step in seconds. */
export const STEP = 0.05;
/** Max items waiting in a producer's output buffer before it clogs. */
export const OUT_CAP = 6;
/** Seconds of grid power one power cell provides at base load. */
export const CELL_TIME = 15;
/** Compute the Model needs to win. */
export const GOAL = 30;
/** Max distance from an existing node when placing. */
export const LINK_MAX = 11;
export const DRONE_SPEED = 4.5;
export const WORLD_R = 70;

export const START = {
  inv: { silicon: 40, coolant: 14, power: 5 } as Amounts,
  drones: { build: 3, operate: 3, carry: 4 },
};
