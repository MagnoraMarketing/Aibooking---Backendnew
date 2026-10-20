import {
  BASE_INCOME,
  CAPTURE_DECAY,
  CAPTURE_RADIUS,
  CAPTURE_RATE,
  COVER_MULT,
  DT,
  MAX_QUEUE,
  POINT_INCOME,
  POP_CAP,
  REINFORCE_RANGE,
  START_MANPOWER,
  START_TICKETS,
  STRUCTURES,
  STRUCTURE_DAMAGE_MULT,
  TICKET_DRAIN,
  UNITS,
} from "./constants";
import { MAP, tileAt } from "./map";
import { findPath, isBlocked, nearestWalkable, navGrid, type NavGrid } from "./pathfinding";
import { random } from "./rng";
import {
  Tile,
  type Command,
  type CoverLevel,
  type EntityId,
  type GameState,
  type PlayerId,
  type Squad,
  type Structure,
  type StructureKind,
  type UnitType,
  type Vec,
} from "./types";

// ---------------------------------------------------------------------------
// Setup

export function createGame(seed = 1): GameState {
  const state: GameState = {
    tick: 0,
    time: 0,
    rng: seed | 0,
    nextId: 1,
    players: [
      { manpower: START_MANPOWER, tickets: START_TICKETS },
      { manpower: START_MANPOWER, tickets: START_TICKETS },
    ],
    squads: [],
    structures: [],
    points: MAP.points.map((pos, id) => ({ id, pos: { ...pos }, progress: 0, owner: null })),
    fx: [],
    winner: null,
    winReason: null,
  };
  for (const owner of [0, 1] as const) {
    const hq = placeStructure(state, owner, "hq", true);
    for (let i = 0; i < 2; i++) {
      const sp = spawnPoint(hq);
      spawnSquad(state, owner, "riflemen", { x: sp.x + (owner === 0 ? 1 : -1) * (1 + i * 1.6), y: sp.y - 1 + i * 2 });
    }
  }
  return state;
}

function placeStructure(state: GameState, owner: PlayerId, kind: StructureKind, complete: boolean): Structure {
  const stats = STRUCTURES[kind];
  const at = kind === "hq" ? MAP.bases[owner].hq : MAP.bases[owner].barracks;
  const s: Structure = {
    id: state.nextId++,
    kind,
    owner,
    x: at.x,
    y: at.y,
    w: stats.w,
    h: stats.h,
    hp: complete ? stats.hp : 1,
    maxHp: stats.hp,
    built: complete ? 1 : 0,
    queue: [],
    rally: null,
    cooldown: 0,
  };
  state.structures.push(s);
  return s;
}

function spawnSquad(state: GameState, owner: PlayerId, type: UnitType, at: Vec): Squad {
  const stats = UNITS[type];
  const grid = grid_(state);
  const pos = nearestWalkable(grid, at.x, at.y);
  const squad: Squad = {
    id: state.nextId++,
    type,
    owner,
    pos: { x: pos.x, y: pos.y },
    facing: owner === 0 ? 0 : Math.PI,
    models: Array.from({ length: stats.models }, () => ({ hp: stats.modelHp })),
    order: { kind: "idle" },
    cooldown: 0,
    stationaryFor: 0,
    firingAt: null,
    cover: "none",
  };
  state.squads.push(squad);
  return squad;
}

/** Where units emerge: the side of the structure facing the enemy. */
export function spawnPoint(s: Structure): Vec {
  return { x: s.owner === 0 ? s.x + s.w + 0.8 : s.x - 0.8, y: s.y + s.h / 2 };
}

// ---------------------------------------------------------------------------
// Queries

const grid_ = (state: GameState): NavGrid => navGrid(MAP, state.structures);

export function findEntity(state: GameState, id: EntityId): Squad | Structure | undefined {
  return state.squads.find((s) => s.id === id) ?? state.structures.find((s) => s.id === id);
}

export function isStructure(e: Squad | Structure): e is Structure {
  return "kind" in e;
}

export function entityPos(e: Squad | Structure): Vec {
  return isStructure(e) ? { x: e.x + e.w / 2, y: e.y + e.h / 2 } : e.pos;
}

/** Distance from p to the nearest point of an entity (rect edge for structures). */
export function distanceTo(p: Vec, e: Squad | Structure): number {
  if (!isStructure(e)) return Math.hypot(e.pos.x - p.x, e.pos.y - p.y);
  const dx = Math.max(e.x - p.x, 0, p.x - (e.x + e.w));
  const dy = Math.max(e.y - p.y, 0, p.y - (e.y + e.h));
  return Math.hypot(dx, dy);
}

function closestPointOn(s: Structure, p: Vec): Vec {
  return {
    x: Math.min(Math.max(p.x, s.x), s.x + s.w),
    y: Math.min(Math.max(p.y, s.y), s.y + s.h),
  };
}

export function population(state: GameState, owner: PlayerId): number {
  const queued = state.structures
    .filter((s) => s.owner === owner)
    .reduce((n, s) => n + s.queue.length, 0);
  return state.squads.filter((s) => s.owner === owner).length + queued;
}

export function income(state: GameState, owner: PlayerId): number {
  return BASE_INCOME + POINT_INCOME * state.points.filter((p) => p.owner === owner).length;
}

export function canProduce(kind: StructureKind, unit: UnitType): boolean {
  return kind === "barracks" || UNITS[unit].requires === kind;
}

/**
 * Cover a unit at `pos` gets against fire coming from `from`: heavy when a
 * wall, building or structure sits just in front of it toward the shooter,
 * light when standing in a forest, otherwise none.
 */
export function coverAt(state: GameState, pos: Vec, from: Vec): CoverLevel {
  const grid = grid_(state);
  const d = Math.hypot(from.x - pos.x, from.y - pos.y);
  if (d > 0.01) {
    const ux = (from.x - pos.x) / d;
    const uy = (from.y - pos.y) / d;
    for (const r of [0.6, 1.0, 1.4]) {
      if (isBlocked(grid, pos.x + ux * r, pos.y + uy * r)) return "heavy";
    }
  }
  return tileAt(MAP, pos.x, pos.y) === Tile.Forest ? "light" : "none";
}

/** Best cover available at a position from any direction (for UI hints). */
export function coverPotential(state: GameState, pos: Vec): CoverLevel {
  const grid = grid_(state);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    if (isBlocked(grid, pos.x + Math.cos(ang) * 0.8, pos.y + Math.sin(ang) * 0.8)) return "heavy";
  }
  return tileAt(MAP, pos.x, pos.y) === Tile.Forest ? "light" : "none";
}

// ---------------------------------------------------------------------------
// Commands

export function applyCommand(state: GameState, cmd: Command): boolean {
  if (state.winner !== null) return false;
  const me = cmd.player;
  const ownSquads = (ids: EntityId[]) =>
    state.squads.filter((s) => s.owner === me && ids.includes(s.id));
  const ownStructure = (id: EntityId) =>
    state.structures.find((s) => s.id === id && s.owner === me);

  switch (cmd.type) {
    case "move": {
      const squads = ownSquads(cmd.ids);
      if (squads.length === 0) return false;
      const grid = grid_(state);
      const dests = formation({ x: cmd.x, y: cmd.y }, squads, grid);
      squads.forEach((sq, i) => {
        const dest = dests[i]!;
        sq.order = { kind: "move", dest, path: findPath(grid, sq.pos, dest) };
      });
      return true;
    }
    case "attack": {
      const target = findEntity(state, cmd.targetId);
      if (!target || target.owner === me) return false;
      const squads = ownSquads(cmd.ids);
      for (const sq of squads) sq.order = { kind: "attack", targetId: target.id, path: [], repathIn: 0 };
      return squads.length > 0;
    }
    case "stop": {
      for (const sq of ownSquads(cmd.ids)) sq.order = { kind: "idle" };
      return true;
    }
    case "recruit": {
      const s = ownStructure(cmd.structureId);
      const stats = UNITS[cmd.unit];
      if (!s || s.built < 1 || !canProduce(s.kind, cmd.unit)) return false;
      if (s.queue.length >= MAX_QUEUE) return false;
      if (population(state, me) >= POP_CAP) return false;
      if (state.players[me].manpower < stats.cost) return false;
      state.players[me].manpower -= stats.cost;
      s.queue.push({ unit: cmd.unit, remaining: stats.buildTime, total: stats.buildTime });
      return true;
    }
    case "cancel": {
      const s = ownStructure(cmd.structureId);
      const item = s?.queue[cmd.index];
      if (!s || !item) return false;
      s.queue.splice(cmd.index, 1);
      state.players[me].manpower += UNITS[item.unit].cost;
      return true;
    }
    case "rally": {
      const s = ownStructure(cmd.structureId);
      if (!s) return false;
      s.rally = nearestWalkable(grid_(state), cmd.x, cmd.y);
      return true;
    }
    case "build": {
      const stats = STRUCTURES[cmd.kind];
      if (state.structures.some((s) => s.owner === me && s.kind === cmd.kind)) return false;
      if (state.players[me].manpower < stats.cost) return false;
      state.players[me].manpower -= stats.cost;
      placeStructure(state, me, cmd.kind, false);
      // Nudge anyone standing on the pad out of the way.
      const grid = grid_(state);
      for (const sq of state.squads) {
        if (isBlocked(grid, sq.pos.x, sq.pos.y)) {
          sq.pos = nearestWalkable(grid, sq.pos.x, sq.pos.y);
          if (sq.order.kind === "move") sq.order.path = findPath(grid, sq.pos, sq.order.dest);
        }
      }
      return true;
    }
    case "reinforce": {
      let any = false;
      for (const sq of ownSquads(cmd.ids)) {
        const stats = UNITS[sq.type];
        const nearBase = state.structures.some(
          (s) => s.owner === me && s.built >= 1 && distanceTo(sq.pos, s) <= REINFORCE_RANGE,
        );
        if (!nearBase) continue;
        while (sq.models.length < stats.models && state.players[me].manpower >= stats.reinforceCost) {
          state.players[me].manpower -= stats.reinforceCost;
          sq.models.push({ hp: stats.modelHp });
          any = true;
        }
      }
      return any;
    }
    case "forfeit": {
      state.winner = me === 0 ? 1 : 0;
      state.winReason = "forfeit";
      return true;
    }
  }
}

/** Spread move destinations in a loose grid so squads do not stack up. */
function formation(center: Vec, squads: Squad[], grid: NavGrid): Vec[] {
  const n = squads.length;
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = 1.8;
  // Orient the formation perpendicular to the average approach direction.
  const avg = squads.reduce((a, s) => ({ x: a.x + s.pos.x / n, y: a.y + s.pos.y / n }), { x: 0, y: 0 });
  const ang = Math.atan2(center.y - avg.y, center.x - avg.x);
  const fx = Math.cos(ang);
  const fy = Math.sin(ang);
  const slots: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const c = (i % cols) - (cols - 1) / 2;
    const r = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
    // c runs across the front (perpendicular), r runs front-to-back.
    slots.push({ x: center.x + (-fy * c - fx * r) * spacing, y: center.y + (fx * c - fy * r) * spacing });
  }
  // Greedy assignment: each slot goes to the nearest remaining squad.
  const out: Vec[] = new Array(n);
  const free = squads.map((_, i) => i);
  for (const slot of slots) {
    let bi = 0;
    let bd = Infinity;
    free.forEach((si, k) => {
      const p = squads[si]!.pos;
      const d = (p.x - slot.x) ** 2 + (p.y - slot.y) ** 2;
      if (d < bd) {
        bd = d;
        bi = k;
      }
    });
    const si = free.splice(bi, 1)[0]!;
    out[si] = nearestWalkable(grid, slot.x, slot.y);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simulation step

export function step(state: GameState): void {
  if (state.winner !== null) return;
  state.tick++;
  state.time += DT;

  stepEconomy(state);
  stepStructures(state);
  stepMovement(state);
  stepCombat(state);
  cleanupDead(state);
  stepCapture(state);
  stepTickets(state);

  for (const f of state.fx) f.age += DT;
  state.fx = state.fx.filter((f) => f.age < 0.25);
}

function stepEconomy(state: GameState) {
  for (const owner of [0, 1] as const) {
    state.players[owner].manpower += income(state, owner) * DT;
  }
}

function stepStructures(state: GameState) {
  for (const s of state.structures) {
    if (s.built < 1) {
      const stats = STRUCTURES[s.kind];
      const inc = DT / stats.buildTime;
      s.built = Math.min(1, s.built + inc);
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * inc);
      continue;
    }
    const head = s.queue[0];
    if (!head) continue;
    head.remaining = Math.max(0, head.remaining - DT);
    if (head.remaining > 0) continue;
    // Production is gated by population, counting this item as already queued.
    const fielded = state.squads.filter((q) => q.owner === s.owner).length;
    if (fielded >= POP_CAP) continue;
    s.queue.shift();
    const sq = spawnSquad(state, s.owner, head.unit, spawnPoint(s));
    if (s.rally) {
      sq.order = { kind: "move", dest: s.rally, path: findPath(grid_(state), sq.pos, s.rally) };
    }
  }
}

function moveAlong(sq: Squad, path: Vec[], dist: number): boolean {
  let moved = false;
  while (dist > 0 && path.length > 0) {
    const wp = path[0]!;
    const dx = wp.x - sq.pos.x;
    const dy = wp.y - sq.pos.y;
    const d = Math.hypot(dx, dy);
    if (d <= dist) {
      sq.pos = { x: wp.x, y: wp.y };
      path.shift();
      dist -= d;
    } else {
      sq.pos = { x: sq.pos.x + (dx / d) * dist, y: sq.pos.y + (dy / d) * dist };
      dist = 0;
    }
    if (d > 0.001) sq.facing = Math.atan2(dy, dx);
    moved = true;
  }
  return moved;
}

function stepMovement(state: GameState) {
  const grid = grid_(state);
  for (const sq of state.squads) {
    const stats = UNITS[sq.type];
    let moved = false;
    const order = sq.order;
    if (order.kind === "move") {
      moved = moveAlong(sq, order.path, stats.speed * DT);
      if (order.path.length === 0) sq.order = { kind: "idle" };
    } else if (order.kind === "attack") {
      const target = findEntity(state, order.targetId);
      if (!target) {
        sq.order = { kind: "idle" };
      } else {
        const tp = entityPos(target);
        if (distanceTo(sq.pos, target) <= stats.range * 0.9) {
          order.path = [];
          sq.facing = Math.atan2(tp.y - sq.pos.y, tp.x - sq.pos.x);
        } else {
          order.repathIn -= DT;
          if (order.path.length === 0 || order.repathIn <= 0) {
            const goal = isStructure(target) ? closestPointOn(target, sq.pos) : tp;
            order.path = findPath(grid, sq.pos, goal);
            order.repathIn = 1;
          }
          moved = moveAlong(sq, order.path, stats.speed * DT);
        }
      }
    }
    sq.stationaryFor = moved ? 0 : sq.stationaryFor + DT;
  }

  // Soft separation so squads do not stack on the same spot.
  const minSep = 1.1;
  for (let i = 0; i < state.squads.length; i++) {
    for (let j = i + 1; j < state.squads.length; j++) {
      const a = state.squads[i]!;
      const b = state.squads[j]!;
      let dx = b.pos.x - a.pos.x;
      let dy = b.pos.y - a.pos.y;
      let d = Math.hypot(dx, dy);
      if (d >= minSep) continue;
      if (d < 0.001) {
        // Deterministic tie-break for perfectly overlapping squads.
        dx = Math.cos(a.id);
        dy = Math.sin(a.id);
        d = 1;
      }
      const push = ((minSep - d) / 2) * 0.25;
      const ux = (dx / d) * push;
      const uy = (dy / d) * push;
      const na = { x: a.pos.x - ux, y: a.pos.y - uy };
      const nb = { x: b.pos.x + ux, y: b.pos.y + uy };
      if (!isBlocked(grid, na.x, na.y)) a.pos = na;
      if (!isBlocked(grid, nb.x, nb.y)) b.pos = nb;
    }
  }
}

type Target = Squad | Structure;

function pickTarget(state: GameState, owner: PlayerId, from: Vec, range: number, preferred?: Target): Target | null {
  if (preferred && distanceTo(from, preferred) <= range) return preferred;
  let best: Target | null = null;
  let bestD = Infinity;
  for (const e of state.squads) {
    if (e.owner === owner) continue;
    const d = distanceTo(from, e);
    if (d <= range && d < bestD) {
      best = e;
      bestD = d;
    }
  }
  if (best) return best;
  for (const e of state.structures) {
    if (e.owner === owner) continue;
    const d = distanceTo(from, e);
    if (d <= range && d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

function damageTarget(state: GameState, target: Target, from: Vec, amount: number): void {
  if (isStructure(target)) {
    target.hp -= amount * STRUCTURE_DAMAGE_MULT;
    return;
  }
  const cover = coverAt(state, target.pos, from);
  const idx = Math.floor(random(state) * target.models.length);
  const model = target.models[idx];
  if (!model) return;
  model.hp -= amount * COVER_MULT[cover];
  if (model.hp <= 0) target.models.splice(idx, 1);
}

function fire(
  state: GameState,
  owner: PlayerId,
  from: Vec,
  target: Target,
  shots: number,
  accuracy: number,
  damage: number,
): void {
  let anyHit = false;
  for (let i = 0; i < shots; i++) {
    if (random(state) < accuracy) {
      damageTarget(state, target, from, damage);
      anyHit = true;
    }
  }
  const tp = isStructure(target) ? closestPointOn(target, from) : target.pos;
  state.fx.push({ from: { ...from }, to: { ...tp }, owner, age: 0, hit: anyHit });
}

function updateCover(state: GameState) {
  for (const sq of state.squads) {
    let nearest: Vec | null = null;
    let bestD = 12;
    for (const e of state.squads) {
      if (e.owner === sq.owner) continue;
      const d = Math.hypot(e.pos.x - sq.pos.x, e.pos.y - sq.pos.y);
      if (d < bestD) {
        bestD = d;
        nearest = e.pos;
      }
    }
    sq.cover = nearest ? coverAt(state, sq.pos, nearest) : coverPotential(state, sq.pos);
  }
}

function stepCombat(state: GameState) {
  updateCover(state);
  for (const sq of state.squads) {
    const stats = UNITS[sq.type];
    sq.cooldown = Math.max(0, sq.cooldown - DT);
    sq.firingAt = null;
    if (sq.models.length === 0) continue;
    const preferred = sq.order.kind === "attack" ? findEntity(state, sq.order.targetId) : undefined;
    const target = pickTarget(state, sq.owner, sq.pos, stats.range, preferred);
    if (!target) continue;
    const moving = sq.stationaryFor === 0;
    if (moving && stats.movingAccuracy === 0) continue;
    if (sq.stationaryFor < stats.setupTime) continue;
    sq.firingAt = target.id;
    if (!moving) {
      const tp = entityPos(target);
      sq.facing = Math.atan2(tp.y - sq.pos.y, tp.x - sq.pos.x);
    }
    if (sq.cooldown > 0) continue;
    const acc = stats.accuracy * (moving ? stats.movingAccuracy : 1);
    fire(state, sq.owner, sq.pos, target, sq.models.length, acc, stats.damage);
    sq.cooldown = stats.cooldown * (0.85 + 0.3 * random(state));
  }

  for (const s of state.structures) {
    const gun = STRUCTURES[s.kind].gun;
    if (!gun || s.built < 1) continue;
    s.cooldown = Math.max(0, s.cooldown - DT);
    if (s.cooldown > 0) continue;
    // Structures only shoot at infantry.
    let target: Squad | null = null;
    let bestD = Infinity;
    for (const e of state.squads) {
      if (e.owner === s.owner) continue;
      const d = distanceTo(e.pos, s);
      if (d <= gun.range && d < bestD) {
        target = e;
        bestD = d;
      }
    }
    if (!target) continue;
    fire(state, s.owner, closestPointOn(s, target.pos), target, 1, gun.accuracy, gun.damage);
    s.cooldown = gun.cooldown;
  }
}

function cleanupDead(state: GameState) {
  state.squads = state.squads.filter((s) => s.models.length > 0);
  const destroyed = state.structures.filter((s) => s.hp <= 0);
  if (destroyed.length === 0) return;
  state.structures = state.structures.filter((s) => s.hp > 0);
  for (const s of destroyed) {
    if (s.kind === "hq" && state.winner === null) {
      state.winner = s.owner === 0 ? 1 : 0;
      state.winReason = "hq";
    }
  }
}

function stepCapture(state: GameState) {
  for (const p of state.points) {
    const count = [0, 0];
    for (const sq of state.squads) {
      if (Math.hypot(sq.pos.x - p.pos.x, sq.pos.y - p.pos.y) <= CAPTURE_RADIUS) count[sq.owner]!++;
    }
    const [c0, c1] = count as [number, number];
    if (c0 > 0 && c1 > 0) continue; // contested: frozen
    if (c0 > 0 || c1 > 0) {
      const sign = c0 > 0 ? 1 : -1;
      p.progress += sign * CAPTURE_RATE * Math.min(3, c0 + c1) * DT;
    } else {
      // Unattended points drift back to their owner's (or neutral) state.
      const rest = p.owner === 0 ? 100 : p.owner === 1 ? -100 : 0;
      const diff = rest - p.progress;
      p.progress += Math.sign(diff) * Math.min(Math.abs(diff), CAPTURE_DECAY * DT);
    }
    p.progress = Math.max(-100, Math.min(100, p.progress));
    if (p.progress >= 100) p.owner = 0;
    else if (p.progress <= -100) p.owner = 1;
    else if (p.owner === 0 && p.progress <= 0) p.owner = null;
    else if (p.owner === 1 && p.progress >= 0) p.owner = null;
  }
}

function stepTickets(state: GameState) {
  const owned0 = state.points.filter((p) => p.owner === 0).length;
  const owned1 = state.points.filter((p) => p.owner === 1).length;
  const diff = owned0 - owned1;
  if (diff > 0) state.players[1].tickets -= diff * TICKET_DRAIN * DT;
  if (diff < 0) state.players[0].tickets -= -diff * TICKET_DRAIN * DT;
  for (const owner of [0, 1] as const) {
    if (state.players[owner].tickets <= 0 && state.winner === null) {
      state.players[owner].tickets = 0;
      state.winner = owner === 0 ? 1 : 0;
      state.winReason = "tickets";
    }
  }
}
