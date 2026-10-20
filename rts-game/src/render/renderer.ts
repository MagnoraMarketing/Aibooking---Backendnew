import { CAPTURE_RADIUS, UNITS } from "../game/constants";
import { MAP } from "../game/map";
import { spawnPoint } from "../game/sim";
import type { EntityId, GameState, PlayerId, Squad, Structure, Vec } from "../game/types";
import { renderTerrain } from "./terrain";
import { NEUTRAL, TEAM, TILE } from "./theme";

export interface Camera {
  /** World tile coordinate at the top-left of the screen. */
  x: number;
  y: number;
  /** Pixels per tile. */
  scale: number;
}

export interface RenderInput {
  state: GameState;
  /** Squad positions at the previous sim step, for smooth interpolation. */
  prevPos: ReadonlyMap<EntityId, Vec>;
  alpha: number;
  localPlayer: PlayerId;
  selected: ReadonlySet<EntityId>;
  hoverId: EntityId | null;
  /** Selection rectangle in screen pixels. */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Wall-clock seconds, for purely cosmetic animation. */
  now: number;
  /** Recent move/attack click markers. */
  markers: { pos: Vec; kind: "move" | "attack" | "rally"; at: number }[];
}

// Model offsets within a squad formation, in tiles, before rotation.
const FORMATION: Vec[] = [
  { x: 0.25, y: 0 },
  { x: -0.05, y: -0.32 },
  { x: -0.05, y: 0.32 },
  { x: -0.35, y: 0 },
];

export function interpolatedPos(sq: Squad, input: Pick<RenderInput, "prevPos" | "alpha">): Vec {
  const prev = input.prevPos.get(sq.id);
  if (!prev) return sq.pos;
  // Large jumps (spawns, snapshot resyncs) snap instead of sliding.
  if (Math.abs(prev.x - sq.pos.x) + Math.abs(prev.y - sq.pos.y) > 2) return sq.pos;
  const a = Math.max(0, Math.min(1, input.alpha));
  return { x: prev.x + (sq.pos.x - prev.x) * a, y: prev.y + (sq.pos.y - prev.y) * a };
}

export class Renderer {
  private terrain: HTMLCanvasElement | null = null;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, cam: Camera, input: RenderInput) {
    if (!this.terrain) this.terrain = renderTerrain(MAP, TILE);
    const { state } = input;
    ctx.save();
    ctx.fillStyle = "#1d2416";
    ctx.fillRect(0, 0, width, height);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain, -cam.x * cam.scale, -cam.y * cam.scale, MAP.width * cam.scale, MAP.height * cam.scale);

    ctx.translate(-cam.x * cam.scale, -cam.y * cam.scale);
    ctx.scale(cam.scale, cam.scale);
    ctx.lineJoin = "round";

    for (const p of state.points) this.drawPoint(ctx, p.pos, p.owner, p.progress, input.now);
    for (const s of state.structures) this.drawStructure(ctx, s, input);
    this.drawOrders(ctx, input);
    // Draw squads bottom-up so lower ones overlap the ones above.
    const squads = [...state.squads].sort((a, b) => a.pos.y - b.pos.y);
    for (const sq of squads) this.drawSquad(ctx, sq, input);
    this.drawFx(ctx, state);
    for (const sq of squads) this.drawSquadOverlay(ctx, sq, input);
    for (const s of state.structures) this.drawStructureBar(ctx, s, input);
    this.drawMarkers(ctx, input);
    ctx.restore();

    if (input.dragBox) {
      const { x0, y0, x1, y1 } = input.dragBox;
      ctx.save();
      ctx.strokeStyle = "rgba(240,240,200,0.9)";
      ctx.fillStyle = "rgba(240,240,200,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }
  }

  private drawPoint(ctx: CanvasRenderingContext2D, pos: Vec, owner: PlayerId | null, progress: number, now: number) {
    const color = owner === null ? NEUTRAL : TEAM[owner].main;
    // Capture radius.
    ctx.fillStyle = owner === null ? "rgba(230,225,200,0.08)" : owner === 0 ? "rgba(79,134,217,0.12)" : "rgba(217,88,63,0.12)";
    ctx.strokeStyle = owner === null ? "rgba(230,225,200,0.45)" : color;
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.3, 0.2]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, CAPTURE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Progress ring: blue fills clockwise, red counter-clockwise.
    if (Math.abs(progress) > 0.5 && Math.abs(progress) < 99.5) {
      const towards: PlayerId = progress > 0 ? 0 : 1;
      ctx.strokeStyle = TEAM[towards].main;
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      const span = (Math.abs(progress) / 100) * Math.PI * 2;
      ctx.arc(pos.x, pos.y, 1.1, -Math.PI / 2, -Math.PI / 2 + (towards === 0 ? span : -span), towards === 1);
      ctx.stroke();
    }

    // Base plate and flag.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.arc(pos.x + 0.06, pos.y + 0.08, 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6e6a5c";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9c9784";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 0.58, 0, Math.PI * 2);
    ctx.fill();
    const wave = Math.sin(now * 3 + pos.y) * 0.08;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(pos.x - 0.05, pos.y - 0.55);
    ctx.lineTo(pos.x + 0.7, pos.y - 0.4 + wave);
    ctx.lineTo(pos.x - 0.05, pos.y - 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#2a2a24";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(pos.x - 0.05, pos.y + 0.3);
    ctx.lineTo(pos.x - 0.05, pos.y - 0.6);
    ctx.stroke();
  }

  private drawStructure(ctx: CanvasRenderingContext2D, s: Structure, input: RenderInput) {
    const team = TEAM[s.owner];
    const selected = input.selected.has(s.id);
    const hovered = input.hoverId === s.id;
    ctx.save();
    ctx.globalAlpha = s.built < 1 ? 0.55 + 0.45 * s.built : 1;
    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(s.x + 0.2, s.y + 0.2, s.w, s.h);
    if (s.kind === "hq") {
      // Sandbagged command bunker.
      ctx.fillStyle = "#8a7f5e";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "#b0a47c";
      for (let i = 0; i < s.w * 3; i++) {
        for (const yy of [s.y + 0.05, s.y + s.h - 0.3]) {
          ctx.beginPath();
          ctx.ellipse(s.x + 0.17 + i * 0.33, yy + 0.12, 0.15, 0.11, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#4e5640";
      ctx.fillRect(s.x + 0.4, s.y + 0.45, s.w - 0.8, s.h - 0.9);
      ctx.fillStyle = "#5f6a4c";
      ctx.fillRect(s.x + 0.55, s.y + 0.6, s.w - 1.1, s.h - 1.2);
      ctx.fillStyle = team.main;
      ctx.fillRect(s.x + 0.55, s.y + s.h / 2 - 0.12, s.w - 1.1, 0.24);
      // Star emblem.
      this.star(ctx, s.x + s.w / 2, s.y + s.h / 2, 0.42, team.light);
    } else {
      // Barracks: long hut with a corrugated roof.
      ctx.fillStyle = "#5b5244";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "#7a7464";
      ctx.fillRect(s.x + 0.1, s.y + 0.1, s.w - 0.2, s.h - 0.2);
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 0.05;
      for (let i = 0.35; i < s.w - 0.1; i += 0.3) {
        ctx.beginPath();
        ctx.moveTo(s.x + i, s.y + 0.15);
        ctx.lineTo(s.x + i, s.y + s.h - 0.15);
        ctx.stroke();
      }
      ctx.fillStyle = team.main;
      ctx.fillRect(s.x + 0.1, s.y + 0.1, s.w - 0.2, 0.28);
      ctx.fillRect(s.x + 0.1, s.y + s.h - 0.38, s.w - 0.2, 0.28);
      if (s.built < 1) {
        // Scaffolding while under construction.
        ctx.strokeStyle = "#d8c690";
        ctx.lineWidth = 0.07;
        ctx.strokeRect(s.x + 0.05, s.y + 0.05, s.w - 0.1, s.h - 0.1);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + s.w, s.y + s.h);
        ctx.moveTo(s.x + s.w, s.y);
        ctx.lineTo(s.x, s.y + s.h);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (selected || hovered) {
      ctx.strokeStyle = selected ? "#f3f0c8" : "rgba(243,240,200,0.55)";
      ctx.lineWidth = 0.08;
      ctx.setLineDash(selected ? [] : [0.25, 0.15]);
      ctx.strokeRect(s.x - 0.15, s.y - 0.15, s.w + 0.3, s.h + 0.3);
      ctx.setLineDash([]);
    }
    if (selected && s.owner === input.localPlayer) {
      const from = spawnPoint(s);
      const to = s.rally;
      if (to) {
        ctx.strokeStyle = "rgba(243,240,200,0.6)";
        ctx.lineWidth = 0.06;
        ctx.setLineDash([0.2, 0.2]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        this.flag(ctx, to, team.main);
      }
    }
  }

  private drawStructureBar(ctx: CanvasRenderingContext2D, s: Structure, input: RenderInput) {
    const frac = s.hp / s.maxHp;
    if (frac >= 0.999 && !input.selected.has(s.id) && input.hoverId !== s.id && s.built >= 1) return;
    const w = s.w;
    this.bar(ctx, s.x, s.y - 0.45, w, 0.18, frac, TEAM[s.owner].main);
    if (s.built < 1) this.bar(ctx, s.x, s.y - 0.22, w, 0.1, s.built, "#e3d28d");
    if (s.queue[0] && s.owner === input.localPlayer) {
      const q = s.queue[0];
      this.bar(ctx, s.x, s.y + s.h + 0.12, w, 0.12, 1 - q.remaining / q.total, "#e3d28d");
    }
  }

  private drawOrders(ctx: CanvasRenderingContext2D, input: RenderInput) {
    // Show the paths of the local player's selected squads.
    ctx.lineWidth = 0.06;
    for (const sq of input.state.squads) {
      if (sq.owner !== input.localPlayer || !input.selected.has(sq.id)) continue;
      const pos = interpolatedPos(sq, input);
      if (sq.order.kind === "move") {
        ctx.strokeStyle = "rgba(180,240,160,0.55)";
        ctx.setLineDash([0.2, 0.18]);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        if (sq.order.path.length > 0) for (const p of sq.order.path) ctx.lineTo(p.x, p.y);
        else ctx.lineTo(sq.order.dest.x, sq.order.dest.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (sq.order.kind === "attack") {
        const id = sq.order.targetId;
        const target = input.state.squads.find((x) => x.id === id) ?? input.state.structures.find((x) => x.id === id);
        if (!target) continue;
        const tp = "kind" in target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : interpolatedPos(target, input);
        ctx.strokeStyle = "rgba(255,120,100,0.6)";
        ctx.setLineDash([0.2, 0.18]);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawSquad(ctx: CanvasRenderingContext2D, sq: Squad, input: RenderInput) {
    const team = TEAM[sq.owner];
    const pos = interpolatedPos(sq, input);
    const selected = input.selected.has(sq.id);
    const hovered = input.hoverId === sq.id;

    if (selected || hovered) {
      ctx.strokeStyle = selected ? (sq.owner === input.localPlayer ? "#c8f5a0" : "#ffb0a0") : "rgba(240,240,200,0.6)";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + 0.1, 0.85, 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const cos = Math.cos(sq.facing);
    const sin = Math.sin(sq.facing);
    const isMg = sq.type === "machinegun";
    sq.models.forEach((m, i) => {
      const off = FORMATION[i] ?? { x: 0, y: 0 };
      const mx = pos.x + off.x * cos - off.y * sin;
      const my = pos.y + off.x * sin + off.y * cos;
      const r = 0.17;
      // Shadow.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(mx + 0.05, my + 0.07, r, 0, Math.PI * 2);
      ctx.fill();
      // Weapon.
      const gunLen = isMg && i === 0 ? 0.48 : 0.34;
      ctx.strokeStyle = "#1c1c18";
      ctx.lineWidth = isMg && i === 0 ? 0.1 : 0.06;
      ctx.beginPath();
      ctx.moveTo(mx + cos * 0.05 - sin * 0.08, my + sin * 0.05 + cos * 0.08);
      ctx.lineTo(mx + cos * gunLen - sin * 0.08, my + sin * gunLen + cos * 0.08);
      ctx.stroke();
      // Body (helmet from above).
      ctx.fillStyle = team.dark;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = team.main;
      ctx.beginPath();
      ctx.arc(mx - 0.02, my - 0.02, r * 0.72, 0, Math.PI * 2);
      ctx.fill();
      // Wounded models fade.
      const max = UNITS[sq.type].modelHp;
      if (m.hp < max * 0.5) {
        ctx.fillStyle = "rgba(120,20,20,0.5)";
        ctx.beginPath();
        ctx.arc(mx, my, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  private drawSquadOverlay(ctx: CanvasRenderingContext2D, sq: Squad, input: RenderInput) {
    const pos = interpolatedPos(sq, input);
    const stats = UNITS[sq.type];
    const hpNow = sq.models.reduce((n, m) => n + m.hp, 0);
    const frac = hpNow / (stats.models * stats.modelHp);
    const show = input.selected.has(sq.id) || input.hoverId === sq.id || frac < 0.999 || sq.owner === input.localPlayer;
    if (show) this.bar(ctx, pos.x - 0.6, pos.y - 0.85, 1.2, 0.14, frac, TEAM[sq.owner].main);
    // Model pips beneath the bar.
    if (input.selected.has(sq.id)) {
      for (let i = 0; i < stats.models; i++) {
        ctx.fillStyle = i < sq.models.length ? "#f0ecd0" : "rgba(0,0,0,0.4)";
        ctx.fillRect(pos.x - 0.6 + i * 0.3, pos.y - 0.66, 0.22, 0.08);
      }
    }
    // Cover shield for the local player's squads.
    if (sq.owner === input.localPlayer && sq.cover !== "none") {
      this.shield(ctx, pos.x + 0.75, pos.y - 0.78, sq.cover === "heavy" ? "#7fd36b" : "#e6cf5a");
    }
    if (sq.type === "machinegun" && sq.stationaryFor < stats.setupTime && sq.firingAt === null && sq.order.kind === "idle") {
      // MG setting up.
      ctx.strokeStyle = "#e3d28d";
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 0.55, -Math.PI / 2, -Math.PI / 2 + (sq.stationaryFor / stats.setupTime) * Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawFx(ctx: CanvasRenderingContext2D, state: GameState) {
    for (const f of state.fx) {
      const life = 1 - f.age / 0.25;
      if (life <= 0) continue;
      ctx.strokeStyle = f.owner === 0 ? `rgba(255,240,170,${0.85 * life})` : `rgba(255,210,150,${0.85 * life})`;
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      // A short tracer streak travelling from shooter to target.
      const t0 = Math.min(1, f.age / 0.12);
      const t1 = Math.max(0, t0 - 0.35);
      ctx.moveTo(f.from.x + (f.to.x - f.from.x) * t1, f.from.y + (f.to.y - f.from.y) * t1);
      ctx.lineTo(f.from.x + (f.to.x - f.from.x) * t0, f.from.y + (f.to.y - f.from.y) * t0);
      ctx.stroke();
      if (f.age < 0.06) {
        // Muzzle flash.
        ctx.fillStyle = "rgba(255,230,140,0.9)";
        ctx.beginPath();
        ctx.arc(f.from.x, f.from.y, 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      if (f.hit && f.age > 0.1 && f.age < 0.2) {
        ctx.fillStyle = "rgba(200,40,30,0.6)";
        ctx.beginPath();
        ctx.arc(f.to.x, f.to.y, 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, input: RenderInput) {
    for (const m of input.markers) {
      const t = (input.now - m.at) / 0.6;
      if (t < 0 || t > 1) continue;
      ctx.strokeStyle = m.kind === "attack" ? `rgba(255,110,90,${1 - t})` : `rgba(180,245,150,${1 - t})`;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(m.pos.x, m.pos.y, 0.25 + t * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string) {
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(x - 0.03, y - 0.03, w + 0.06, h + 0.06);
    ctx.fillStyle = frac > 0.35 ? color : "#e04a3a";
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  private shield(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.moveTo(x - 0.17, y - 0.17);
    ctx.lineTo(x + 0.17, y - 0.17);
    ctx.lineTo(x + 0.17, y + 0.02);
    ctx.lineTo(x, y + 0.2);
    ctx.lineTo(x - 0.17, y + 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 0.12, y - 0.12);
    ctx.lineTo(x + 0.12, y - 0.12);
    ctx.lineTo(x + 0.12, y);
    ctx.lineTo(x, y + 0.13);
    ctx.lineTo(x - 0.12, y);
    ctx.closePath();
    ctx.fill();
  }

  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.42;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  private flag(ctx: CanvasRenderingContext2D, p: Vec, color: string) {
    ctx.strokeStyle = "#2a2a24";
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 0.6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(p.x, p.y - 0.6, 0.35, 0.22);
  }
}
