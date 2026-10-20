import { CAPTURE_RADIUS, POP_CAP, REINFORCE_RANGE, STRUCTURES, UNITS } from "./constants";
import { distanceTo, population } from "./sim";
import type { Command, GameState, PlayerId, Squad, Vec } from "./types";

// A simple scripted opponent for practice mode. It reads the game state and
// returns ordinary commands, exactly like a human player would issue, so it
// cannot cheat and needs no access to sim internals.

export type Difficulty = "easy" | "normal";

export interface AIMemory {
  player: PlayerId;
  difficulty: Difficulty;
  nextThink: number;
  /** Squads sent home to reinforce, so they are not immediately re-tasked. */
  retreating: number[];
}

export function createAI(player: PlayerId, difficulty: Difficulty = "normal"): AIMemory {
  return { player, difficulty, nextThink: 3, retreating: [] };
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function runAI(state: GameState, mem: AIMemory): Command[] {
  if (state.winner !== null || state.time < mem.nextThink) return [];
  const easy = mem.difficulty === "easy";
  mem.nextThink = state.time + (easy ? 2.5 : 1);

  const me = mem.player;
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const cmds: Command[] = [];
  const mine = state.squads.filter((s) => s.owner === me);
  const foes = state.squads.filter((s) => s.owner === enemy);
  const hq = state.structures.find((s) => s.owner === me && s.kind === "hq");
  const barracks = state.structures.find((s) => s.owner === me && s.kind === "barracks");
  const enemyHq = state.structures.find((s) => s.owner === enemy && s.kind === "hq");
  if (!hq) return [];
  const mp = () => state.players[me].manpower;
  let budget = mp();

  // --- Economy -----------------------------------------------------------
  const barracksAt = easy ? 150 : 50;
  if (!barracks && state.time > barracksAt && budget >= STRUCTURES.barracks.cost) {
    cmds.push({ type: "build", player: me, kind: "barracks" });
    budget -= STRUCTURES.barracks.cost;
  }
  if (population(state, me) < POP_CAP) {
    const mgs = mine.filter((s) => s.type === "machinegun").length;
    const wantMg = barracks && barracks.built >= 1 && mgs * 3 < mine.length;
    const unit = wantMg ? "machinegun" : "riflemen";
    const from = wantMg ? barracks : hq;
    const reserve = easy ? 60 : 0;
    if (from && from.queue.length < 2 && budget - reserve >= UNITS[unit].cost) {
      cmds.push({ type: "recruit", player: me, structureId: from.id, unit });
      budget -= UNITS[unit].cost;
    }
  }

  // --- Reinforce / retreat ----------------------------------------------
  mem.retreating = mem.retreating.filter((id) => mine.some((s) => s.id === id));
  for (const sq of mine) {
    const full = UNITS[sq.type].models;
    const nearBase = distanceTo(sq.pos, hq) <= REINFORCE_RANGE;
    if (sq.models.length < full && nearBase) {
      cmds.push({ type: "reinforce", player: me, ids: [sq.id] });
      mem.retreating = mem.retreating.filter((id) => id !== sq.id);
    } else if (!easy && sq.models.length === 1 && !nearBase && !mem.retreating.includes(sq.id)) {
      mem.retreating.push(sq.id);
      const home = { x: hq.x + hq.w / 2 + (me === 0 ? 4 : -4), y: hq.y + hq.h / 2 };
      cmds.push({ type: "move", player: me, ids: [sq.id], x: home.x, y: home.y });
    }
  }
  const available = mine.filter(
    (s) => !mem.retreating.includes(s.id) && s.order.kind === "idle" && s.firingAt === null,
  );

  // --- Defend the base ----------------------------------------------------
  const raider = foes.find((f) => distanceTo(f.pos, hq) < 12);
  if (raider) {
    const defenders = available.filter((s) => dist(s.pos, raider.pos) < 25);
    if (defenders.length > 0) {
      cmds.push({ type: "attack", player: me, ids: defenders.map((s) => s.id), targetId: raider.id });
      return cmds;
    }
  }

  // --- Objectives -----------------------------------------------------------
  const ownedPoints = state.points.filter((p) => p.owner === me).length;
  const armySize = mine.length;
  if (enemyHq && ownedPoints >= 2 && armySize >= (easy ? 9 : 7)) {
    // Push on the enemy HQ with everything that is not busy.
    const ids = available.map((s) => s.id);
    if (ids.length >= 3) cmds.push({ type: "attack", player: me, ids, targetId: enemyHq.id });
    return cmds;
  }

  const assigned = new Map<number, number>();
  for (const sq of mine) {
    if (sq.order.kind !== "move") continue;
    for (const p of state.points) {
      if (dist(sq.order.dest, p.pos) <= CAPTURE_RADIUS) assigned.set(p.id, (assigned.get(p.id) ?? 0) + 1);
    }
  }
  for (const sq of available) {
    const onPoint = state.points.find((p) => dist(sq.pos, p.pos) <= CAPTURE_RADIUS);
    if (onPoint && onPoint.owner !== me) continue; // keep capturing
    if (onPoint) {
      const guards = mine.filter((s) => dist(s.pos, onPoint.pos) <= CAPTURE_RADIUS).length;
      if (guards <= 1) continue; // hold the point
    }
    const target = choosePoint(state, me, sq, assigned);
    if (!target) continue;
    assigned.set(target.id, (assigned.get(target.id) ?? 0) + 1);
    // Spread squads around the flag a little so they find different cover.
    const ang = (sq.id * 2.399) % (Math.PI * 2);
    cmds.push({
      type: "move",
      player: me,
      ids: [sq.id],
      x: target.pos.x + Math.cos(ang) * 1.5,
      y: target.pos.y + Math.sin(ang) * 1.5,
    });
  }
  return cmds;
}

function choosePoint(state: GameState, me: PlayerId, sq: Squad, assigned: Map<number, number>) {
  let best = null;
  let bestScore = Infinity;
  for (const p of state.points) {
    const ownedByMe = p.owner === me;
    let score = dist(sq.pos, p.pos);
    score += (assigned.get(p.id) ?? 0) * 12;
    if (ownedByMe) score += 30;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
