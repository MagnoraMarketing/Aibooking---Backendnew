// Core game-state types. Everything in src/game is pure, deterministic
// TypeScript with no DOM, rendering or networking dependencies: the same
// code runs the single-player sim, the multiplayer host and the tests.
//
// World coordinates are in tiles (floats). The renderer converts to pixels.

export type PlayerId = 0 | 1;
export type EntityId = number;

export interface Vec {
  x: number;
  y: number;
}

export enum Tile {
  Grass = 0,
  Road = 1,
  Building = 2,
  Wall = 3,
  Forest = 4,
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[]; // row-major, index = y * width + x
  /** Capture point centres. */
  points: Vec[];
  /** Per-player base layout. */
  bases: [BaseLayout, BaseLayout];
}

export interface BaseLayout {
  hq: Vec; // top-left tile of the HQ footprint
  barracks: Vec; // top-left tile of the barracks pad
}

export type UnitType = "riflemen" | "machinegun";
export type StructureKind = "hq" | "barracks";

export interface Model {
  hp: number;
}

export type Order =
  | { kind: "idle" }
  | { kind: "move"; dest: Vec; path: Vec[] }
  | { kind: "attack"; targetId: EntityId; path: Vec[]; repathIn: number };

export interface Squad {
  id: EntityId;
  type: UnitType;
  owner: PlayerId;
  pos: Vec;
  facing: number; // radians
  models: Model[]; // alive models only
  order: Order;
  cooldown: number; // seconds until the squad may fire again
  stationaryFor: number; // seconds since the squad last moved
  /** Id of whatever the squad is currently shooting at, for rendering. */
  firingAt: EntityId | null;
  /** Cover the squad currently benefits from against its last attacker. */
  cover: CoverLevel;
}

export interface QueueItem {
  unit: UnitType;
  remaining: number; // seconds
  total: number;
}

export interface Structure {
  id: EntityId;
  kind: StructureKind;
  owner: PlayerId;
  x: number; // top-left tile
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** 0..1 while under construction, 1 when complete. */
  built: number;
  queue: QueueItem[];
  rally: Vec | null;
  cooldown: number;
}

export interface CapturePoint {
  id: number;
  pos: Vec;
  /** -100 = fully owned by player 1, +100 = fully owned by player 0. */
  progress: number;
  owner: PlayerId | null;
}

export interface PlayerState {
  manpower: number;
  /** Victory tickets. Reaching zero loses the game. */
  tickets: number;
}

export type CoverLevel = "none" | "light" | "heavy";

export interface ShotFx {
  from: Vec;
  to: Vec;
  owner: PlayerId;
  age: number;
  hit: boolean;
}

export interface GameState {
  tick: number;
  time: number; // seconds of simulated time
  rng: number; // seeded PRNG state
  nextId: EntityId;
  players: [PlayerState, PlayerState];
  squads: Squad[];
  structures: Structure[];
  points: CapturePoint[];
  fx: ShotFx[];
  winner: PlayerId | null;
  winReason: "tickets" | "hq" | "forfeit" | null;
}

export type Command =
  | { type: "move"; player: PlayerId; ids: EntityId[]; x: number; y: number }
  | { type: "attack"; player: PlayerId; ids: EntityId[]; targetId: EntityId }
  | { type: "stop"; player: PlayerId; ids: EntityId[] }
  | { type: "recruit"; player: PlayerId; structureId: EntityId; unit: UnitType }
  | { type: "cancel"; player: PlayerId; structureId: EntityId; index: number }
  | { type: "rally"; player: PlayerId; structureId: EntityId; x: number; y: number }
  | { type: "build"; player: PlayerId; kind: "barracks" }
  | { type: "reinforce"; player: PlayerId; ids: EntityId[] }
  | { type: "forfeit"; player: PlayerId };
