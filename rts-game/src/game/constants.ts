import type { StructureKind, UnitType } from "./types";

export const TICK_RATE = 20; // simulation steps per second
export const DT = 1 / TICK_RATE;

export interface UnitStats {
  name: string;
  models: number;
  modelHp: number;
  speed: number; // tiles per second
  range: number; // tiles
  damage: number; // per hit, per model
  cooldown: number; // seconds between volleys
  accuracy: number; // 0..1 hit chance per model per volley
  /** Accuracy multiplier while moving; 0 means it cannot fire on the move. */
  movingAccuracy: number;
  /** Seconds the squad must stand still before it may fire. */
  setupTime: number;
  cost: number;
  buildTime: number; // seconds
  reinforceCost: number; // per model
  requires: StructureKind;
}

export const UNITS: Record<UnitType, UnitStats> = {
  riflemen: {
    name: "Rifle Squad",
    models: 4,
    modelHp: 80,
    speed: 2.6,
    range: 7,
    damage: 12,
    cooldown: 1.6,
    accuracy: 0.55,
    movingAccuracy: 0.5,
    setupTime: 0,
    cost: 120,
    buildTime: 12,
    reinforceCost: 25,
    requires: "hq",
  },
  machinegun: {
    name: "MG Team",
    models: 3,
    modelHp: 80,
    speed: 2.0,
    range: 9,
    damage: 7,
    cooldown: 0.4,
    accuracy: 0.45,
    movingAccuracy: 0,
    setupTime: 1.5,
    cost: 180,
    buildTime: 16,
    reinforceCost: 35,
    requires: "barracks",
  },
};

export interface StructureStats {
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: number;
  buildTime: number;
  /** Defensive gun; HQs fight back weakly so early rushes are not free. */
  gun: { range: number; damage: number; cooldown: number; accuracy: number } | null;
}

export const STRUCTURES: Record<StructureKind, StructureStats> = {
  hq: {
    name: "Headquarters",
    w: 4,
    h: 3,
    hp: 4000,
    cost: 0,
    buildTime: 0,
    gun: { range: 8, damage: 12, cooldown: 0.7, accuracy: 0.6 },
  },
  barracks: {
    name: "Barracks",
    w: 3,
    h: 3,
    hp: 1400,
    cost: 200,
    buildTime: 20,
    gun: null,
  },
};

export const START_MANPOWER = 300;
export const BASE_INCOME = 2.5; // manpower per second
export const POINT_INCOME = 1.5; // extra manpower per second per owned point
export const START_TICKETS = 800;
/** Tickets drained per second per point of capture-point advantage. */
export const TICKET_DRAIN = 1;
export const POP_CAP = 10;
export const MAX_QUEUE = 5;

export const CAPTURE_RADIUS = 3;
/** Capture progress per second per squad (max 3 squads count). */
export const CAPTURE_RATE = 10;
export const CAPTURE_DECAY = 5;

export const COVER_MULT = { none: 1, light: 0.75, heavy: 0.5 } as const;
/** Damage multiplier for small-arms fire against structures. */
export const STRUCTURE_DAMAGE_MULT = 0.6;
/** Reinforcing requires the squad within this many tiles of a friendly HQ/barracks. */
export const REINFORCE_RANGE = 6;
