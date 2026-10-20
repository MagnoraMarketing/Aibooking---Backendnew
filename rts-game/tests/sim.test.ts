import { describe, expect, it } from "vitest";
import { createAI, runAI } from "../src/game/ai";
import { STRUCTURES, TICK_RATE, UNITS } from "../src/game/constants";
import { MAP } from "../src/game/map";
import { findPath, navGrid } from "../src/game/pathfinding";
import { applyCommand, coverAt, createGame, spawnPoint, step } from "../src/game/sim";
import type { GameState, Squad } from "../src/game/types";

const run = (state: GameState, seconds: number) => {
  for (let i = 0; i < seconds * TICK_RATE; i++) step(state);
};
const squadsOf = (s: GameState, owner: 0 | 1) => s.squads.filter((q) => q.owner === owner);
const hqOf = (s: GameState, owner: 0 | 1) => s.structures.find((x) => x.owner === owner && x.kind === "hq")!;

/** A game with no starting squads, for isolated scenarios. */
function emptyGame(): GameState {
  const s = createGame(42);
  s.squads = [];
  return s;
}
function addSquad(s: GameState, owner: 0 | 1, x: number, y: number, type: Squad["type"] = "riflemen"): Squad {
  const sq: Squad = {
    id: s.nextId++,
    type,
    owner,
    pos: { x, y },
    facing: 0,
    models: Array.from({ length: UNITS[type].models }, () => ({ hp: UNITS[type].modelHp })),
    order: { kind: "idle" },
    cooldown: 0,
    stationaryFor: 10,
    firingAt: null,
    cover: "none",
  };
  s.squads.push(sq);
  return sq;
}

describe("map", () => {
  it("is mirrored left-to-right", () => {
    for (let y = 0; y < MAP.height; y++) {
      for (let x = 0; x < MAP.width; x++) {
        expect(MAP.tiles[y * MAP.width + x]).toBe(MAP.tiles[y * MAP.width + (MAP.width - 1 - x)]);
      }
    }
  });

  it("connects both bases to every capture point", () => {
    const s = createGame();
    const grid = navGrid(MAP, s.structures);
    for (const owner of [0, 1] as const) {
      const from = spawnPoint(hqOf(s, owner));
      for (const p of MAP.points) expect(findPath(grid, from, p).length).toBeGreaterThan(0);
      expect(findPath(grid, from, spawnPoint(hqOf(s, owner === 0 ? 1 : 0))).length).toBeGreaterThan(0);
    }
  });
});

describe("orders and movement", () => {
  it("moves a selected squad to the clicked location", () => {
    const s = createGame();
    const sq = squadsOf(s, 0)[0]!;
    applyCommand(s, { type: "move", player: 0, ids: [sq.id], x: 20, y: 20 });
    run(s, 10);
    expect(Math.hypot(sq.pos.x - 20, sq.pos.y - 20)).toBeLessThan(1.5);
    expect(sq.order.kind).toBe("idle");
  });

  it("ignores commands for the other player's units", () => {
    const s = createGame();
    const enemy = squadsOf(s, 1)[0]!;
    expect(applyCommand(s, { type: "move", player: 0, ids: [enemy.id], x: 20, y: 20 })).toBe(false);
    expect(enemy.order.kind).toBe("idle");
  });
});

describe("combat and cover", () => {
  it("squads in range fight automatically until one is wiped out", () => {
    const s = emptyGame();
    const a = addSquad(s, 0, 20, 3);
    addSquad(s, 1, 25, 3);
    a.models.splice(0, 2); // player 0 is outnumbered
    run(s, 60);
    expect(squadsOf(s, 0)).toHaveLength(0);
    expect(squadsOf(s, 1)).toHaveLength(1);
  });

  it("walls between the target and the shooter give heavy cover", () => {
    const s = emptyGame();
    // Wall tiles at y=12, x=15..22. Target just south of it, shooter north.
    expect(coverAt(s, { x: 18.5, y: 13.5 }, { x: 18.5, y: 6 })).toBe("heavy");
    expect(coverAt(s, { x: 18.5, y: 13.5 }, { x: 18.5, y: 20 })).toBe("none");
    expect(coverAt(s, { x: 16.5, y: 15.5 }, { x: 30, y: 30 })).toBe("light"); // forest
  });

  it("cover reduces damage taken", () => {
    const damageTaken = (targetY: number) => {
      const s = emptyGame();
      const target = addSquad(s, 1, 18.5, targetY);
      target.models = Array.from({ length: 50 }, () => ({ hp: 1e6 }));
      target.cooldown = 1e9; // a punching bag: it never shoots back
      addSquad(s, 0, 18.5, 7.5);
      run(s, 30);
      return target.models.reduce((n, m) => n + (1e6 - m.hp), 0);
    };
    const open = damageTaken(11.4); // in the open, north of the wall
    const covered = damageTaken(13.5); // behind the wall
    expect(covered).toBeLessThan(open * 0.7);
  });

  it("an attack order closes to range and destroys a structure", () => {
    const s = emptyGame();
    const hq = hqOf(s, 1);
    hq.hp = 200;
    const sq = addSquad(s, 0, 40, 20);
    applyCommand(s, { type: "attack", player: 0, ids: [sq.id], targetId: hq.id });
    run(s, 60);
    expect(s.winner).toBe(0);
    expect(s.winReason).toBe("hq");
  });
});

describe("capture points and victory", () => {
  it("a squad standing on a point captures it", () => {
    const s = emptyGame();
    addSquad(s, 0, 30, 8);
    run(s, 12);
    expect(s.points[0]!.owner).toBe(0);
  });

  it("contested points do not change hands", () => {
    const s = emptyGame();
    const p = s.points[0]!;
    // Out of each other's weapon range is impossible inside the radius, so
    // make them invulnerable instead.
    for (const sq of [addSquad(s, 0, 28.5, 8), addSquad(s, 1, 31.5, 8)]) sq.models = [{ hp: 1e9 }];
    run(s, 5);
    expect(p.progress).toBe(0);
    expect(p.owner).toBeNull();
  });

  it("holding more points drains the enemy's tickets to defeat", () => {
    const s = emptyGame();
    for (const p of s.points) {
      p.owner = 0;
      p.progress = 100;
    }
    s.players[1].tickets = 10;
    run(s, 5);
    expect(s.winner).toBe(0);
    expect(s.winReason).toBe("tickets");
  });
});

describe("economy and production", () => {
  it("recruits a squad at the HQ for manpower", () => {
    const s = createGame();
    const hq = hqOf(s, 0);
    const before = s.players[0].manpower;
    expect(applyCommand(s, { type: "recruit", player: 0, structureId: hq.id, unit: "riflemen" })).toBe(true);
    expect(s.players[0].manpower).toBe(before - UNITS.riflemen.cost);
    run(s, UNITS.riflemen.buildTime + 0.5);
    expect(squadsOf(s, 0)).toHaveLength(3);
  });

  it("needs a barracks for machine gun teams", () => {
    const s = createGame();
    s.players[0].manpower = 1000;
    const hq = hqOf(s, 0);
    expect(applyCommand(s, { type: "recruit", player: 0, structureId: hq.id, unit: "machinegun" })).toBe(false);
    expect(applyCommand(s, { type: "build", player: 0, kind: "barracks" })).toBe(true);
    const barracks = s.structures.find((x) => x.kind === "barracks")!;
    expect(applyCommand(s, { type: "recruit", player: 0, structureId: barracks.id, unit: "machinegun" })).toBe(false);
    run(s, STRUCTURES.barracks.buildTime + 0.5);
    expect(barracks.built).toBe(1);
    expect(applyCommand(s, { type: "recruit", player: 0, structureId: barracks.id, unit: "machinegun" })).toBe(true);
  });

  it("refunds cancelled production", () => {
    const s = createGame();
    const hq = hqOf(s, 0);
    applyCommand(s, { type: "recruit", player: 0, structureId: hq.id, unit: "riflemen" });
    const mid = s.players[0].manpower;
    applyCommand(s, { type: "cancel", player: 0, structureId: hq.id, index: 0 });
    expect(s.players[0].manpower).toBe(mid + UNITS.riflemen.cost);
  });

  it("reinforces depleted squads near base", () => {
    const s = createGame();
    const sq = squadsOf(s, 0)[0]!;
    sq.models.length = 1;
    expect(applyCommand(s, { type: "reinforce", player: 0, ids: [sq.id] })).toBe(true);
    expect(sq.models).toHaveLength(UNITS.riflemen.models);
  });
});

describe("AI", () => {
  it("plays a full match against itself without errors", () => {
    const s = createGame(7);
    const ais = [createAI(0), createAI(1)];
    for (let t = 0; t < 20 * 60 * TICK_RATE && s.winner === null; t++) {
      for (const ai of ais) for (const c of runAI(s, ai)) applyCommand(s, c);
      step(s);
    }
    // Both sides should have contested the map: points changed hands and
    // reinforcements were recruited.
    expect(s.points.some((p) => p.owner !== null) || s.winner !== null).toBe(true);
    expect(s.nextId).toBeGreaterThan(10);
  });
});
