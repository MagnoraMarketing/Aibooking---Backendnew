import type { GameMap } from "../game/types";
import { Tile } from "../game/types";
import { TERRAIN, TILE } from "./theme";

/** Deterministic per-tile hash in [0, 1). */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Group building tiles into rectangles (each building is authored as one). */
function buildingRects(map: GameMap): Rect[] {
  const seen = new Uint8Array(map.width * map.height);
  const out: Rect[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (seen[i] || map.tiles[i] !== Tile.Building) continue;
      let w = 0;
      while (x + w < map.width && map.tiles[i + w] === Tile.Building && !seen[i + w]) w++;
      let h = 0;
      outer: while (y + h < map.height) {
        for (let k = 0; k < w; k++) if (map.tiles[(y + h) * map.width + x + k] !== Tile.Building) break outer;
        h++;
      }
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) seen[yy * map.width + xx] = 1;
      out.push({ x, y, w, h });
    }
  }
  return out;
}

/**
 * Paint the static battlefield once at `scale` pixels per tile. All art is
 * procedural so there are no third-party assets to license.
 */
export function renderTerrain(map: GameMap, scale = TILE): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = map.width * scale;
  canvas.height = map.height * scale;
  const ctx = canvas.getContext("2d")!;
  const t = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? Tile.Grass : map.tiles[y * map.width + x]!;

  // Ground.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = t(x, y);
      const g = TERRAIN.grass;
      ctx.fillStyle = tile === Tile.Forest ? TERRAIN.forestFloor : g[Math.floor(hash(x, y) * g.length)]!;
      ctx.fillRect(x * scale, y * scale, scale, scale);
      // Grass tufts.
      for (let k = 0; k < 5; k++) {
        const px = (x + hash(x, y, k + 1)) * scale;
        const py = (y + hash(x, y, k + 11)) * scale;
        ctx.fillStyle = hash(x, y, k + 21) > 0.5 ? "rgba(255,255,220,0.06)" : "rgba(0,0,0,0.07)";
        ctx.fillRect(px, py, scale * 0.08, scale * 0.16);
      }
    }
  }

  // Roads with soft edges.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (t(x, y) !== Tile.Road) continue;
      ctx.fillStyle = TERRAIN.roadEdge;
      ctx.fillRect(x * scale - 2, y * scale - 2, scale + 4, scale + 4);
    }
  }
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (t(x, y) !== Tile.Road) continue;
      ctx.fillStyle = TERRAIN.road;
      ctx.fillRect(x * scale, y * scale, scale, scale);
      // Wheel ruts and gravel.
      ctx.fillStyle = "rgba(60,45,25,0.12)";
      for (let k = 0; k < 4; k++) {
        ctx.fillRect((x + hash(x, y, k + 40)) * scale, (y + hash(x, y, k + 50)) * scale, 2, 2);
      }
    }
  }

  // Shell craters for flavour (purely cosmetic).
  for (let i = 0; i < 26; i++) {
    const cx = hash(i, 7, 99) * map.width;
    const cy = hash(i, 9, 98) * map.height;
    if (t(Math.floor(cx), Math.floor(cy)) !== Tile.Grass) continue;
    for (const mx of [cx, map.width - cx]) {
      const r = (0.35 + hash(i, 3) * 0.4) * scale;
      ctx.fillStyle = "rgba(60,45,30,0.35)";
      ctx.beginPath();
      ctx.arc(mx * scale, cy * scale, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(30,20,10,0.35)";
      ctx.beginPath();
      ctx.arc(mx * scale + 1, cy * scale + 1, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Walls: stone segments that join up with neighbouring wall tiles.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (t(x, y) !== Tile.Wall) continue;
      const cx = (x + 0.5) * scale;
      const cy = (y + 0.5) * scale;
      const th = scale * 0.42;
      const segs: [number, number, number, number][] = [[cx - th / 2, cy - th / 2, th, th]];
      if (t(x + 1, y) === Tile.Wall) segs.push([cx, cy - th / 2, scale / 2 + 1, th]);
      if (t(x - 1, y) === Tile.Wall) segs.push([x * scale - 1, cy - th / 2, scale / 2 + 1, th]);
      if (t(x, y + 1) === Tile.Wall) segs.push([cx - th / 2, cy, th, scale / 2 + 1]);
      if (t(x, y - 1) === Tile.Wall) segs.push([cx - th / 2, y * scale - 1, th, scale / 2 + 1]);
      ctx.fillStyle = TERRAIN.shadow;
      for (const [sx, sy, sw, sh] of segs) ctx.fillRect(sx + 3, sy + 3, sw, sh);
      ctx.fillStyle = TERRAIN.wallDark;
      for (const [sx, sy, sw, sh] of segs) ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = TERRAIN.wall;
      for (const [sx, sy, sw, sh] of segs) ctx.fillRect(sx + 1, sy + 1, sw - 2, sh - 3);
      // Stone joints.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(x * scale + hash(x, y, 60 + k) * scale, cy - th / 2 + 2, 1, th - 4);
      }
    }
  }

  // Forest canopy, drawn after walls so trees overhang slightly.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (t(x, y) !== Tile.Forest) continue;
      for (let k = 0; k < 2; k++) {
        const px = (x + 0.2 + hash(x, y, 70 + k) * 0.6) * scale;
        const py = (y + 0.2 + hash(x, y, 80 + k) * 0.6) * scale;
        const r = scale * (0.34 + hash(x, y, 90 + k) * 0.18);
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.arc(px + 3, py + 4, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = TERRAIN.tree[Math.floor(hash(x, y, 95 + k) * TERRAIN.tree.length)]!;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(170,210,120,0.12)";
        ctx.beginPath();
        ctx.arc(px - r * 0.3, py - r * 0.3, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Buildings: pitched roofs seen from above, with a drop shadow.
  buildingRects(map).forEach((b, i) => {
    const x = b.x * scale;
    const y = b.y * scale;
    const w = b.w * scale;
    const h = b.h * scale;
    ctx.fillStyle = TERRAIN.shadow;
    ctx.fillRect(x + 6, y + 6, w, h);
    ctx.fillStyle = "#4a3a30";
    ctx.fillRect(x, y, w, h);
    const roof = TERRAIN.roofs[Math.floor(hash(b.x, b.y, i) * TERRAIN.roofs.length)]!;
    ctx.fillStyle = roof;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    // Ridge along the long axis, with one darker roof slope.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    if (w >= h) ctx.fillRect(x + 2, y + h / 2, w - 4, h / 2 - 2);
    else ctx.fillRect(x + w / 2, y + 2, w / 2 - 2, h - 4);
    ctx.strokeStyle = "rgba(255,240,220,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (w >= h) {
      ctx.moveTo(x + 4, y + h / 2);
      ctx.lineTo(x + w - 4, y + h / 2);
    } else {
      ctx.moveTo(x + w / 2, y + 4);
      ctx.lineTo(x + w / 2, y + h - 4);
    }
    ctx.stroke();
    // Roof tiles.
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    for (let k = 6; k < (w >= h ? h : w) - 2; k += 6) {
      ctx.beginPath();
      if (w >= h) {
        ctx.moveTo(x + 3, y + k);
        ctx.lineTo(x + w - 3, y + k);
      } else {
        ctx.moveTo(x + k, y + 3);
        ctx.lineTo(x + k, y + h - 3);
      }
      ctx.stroke();
    }
  });

  return canvas;
}
