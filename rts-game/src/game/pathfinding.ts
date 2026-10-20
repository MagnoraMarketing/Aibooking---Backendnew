import { isSolidTile } from "./map";
import type { GameMap, Structure, Vec } from "./types";

/**
 * Walkability grid: 1 = blocked. Structures block their footprint. Grids are
 * cached by a signature of the structures so the A* search does not rebuild
 * it every call.
 */
export interface NavGrid {
  width: number;
  height: number;
  blocked: Uint8Array;
}

let cachedKey = "";
let cachedMap: GameMap | null = null;
let cachedGrid: NavGrid | null = null;

export function navGrid(map: GameMap, structures: readonly Structure[]): NavGrid {
  const key = structures.map((s) => `${s.x},${s.y},${s.w},${s.h}`).join("|");
  if (cachedGrid && cachedMap === map && cachedKey === key) return cachedGrid;
  const blocked = new Uint8Array(map.width * map.height);
  for (let i = 0; i < blocked.length; i++) blocked[i] = isSolidTile(map.tiles[i]!) ? 1 : 0;
  for (const s of structures) {
    for (let y = s.y; y < s.y + s.h; y++) {
      for (let x = s.x; x < s.x + s.w; x++) blocked[y * map.width + x] = 1;
    }
  }
  cachedKey = key;
  cachedMap = map;
  cachedGrid = { width: map.width, height: map.height, blocked };
  return cachedGrid;
}

export function isBlocked(grid: NavGrid, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return true;
  return grid.blocked[ty * grid.width + tx] === 1;
}

/** Nearest walkable tile centre to (x, y), searching outward in rings. */
export function nearestWalkable(grid: NavGrid, x: number, y: number): Vec {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!isBlocked(grid, tx, ty)) return { x, y };
  for (let r = 1; r < Math.max(grid.width, grid.height); r++) {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (isBlocked(grid, nx, ny)) continue;
        const c = { x: nx + 0.5, y: ny + 0.5 };
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best) return best;
  }
  return { x, y };
}

/** True when a straight walk from a to b crosses no blocked tile. */
export function walkable(grid: NavGrid, a: Vec, b: Vec): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(dist / 0.25);
  // Check a slightly widened corridor so squads do not clip corners.
  const nx = dist > 0 ? -(b.y - a.y) / dist : 0;
  const ny = dist > 0 ? (b.x - a.x) / dist : 0;
  const w = 0.3;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if (isBlocked(grid, px, py)) return false;
    if (isBlocked(grid, px + nx * w, py + ny * w)) return false;
    if (isBlocked(grid, px - nx * w, py - ny * w)) return false;
  }
  return true;
}

class MinHeap {
  private items: number[] = [];
  private scores: Float64Array;
  constructor(size: number) {
    this.scores = new Float64Array(size);
  }
  get size() {
    return this.items.length;
  }
  push(node: number, score: number) {
    this.scores[node] = score;
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[a[p]!]! <= score) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = node;
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      const s = this.scores[last]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let ms = s;
        if (l < a.length && this.scores[a[l]!]! < ms) {
          m = l;
          ms = this.scores[a[l]!]!;
        }
        if (r < a.length && this.scores[a[r]!]! < ms) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * A* over the tile grid (8-directional, no corner cutting), followed by
 * line-of-walk smoothing. Returns waypoints excluding the start position and
 * ending exactly at the (possibly adjusted) goal. Empty when unreachable.
 */
export function findPath(grid: NavGrid, start: Vec, goalIn: Vec): Vec[] {
  const goal = nearestWalkable(grid, goalIn.x, goalIn.y);
  if (walkable(grid, start, goal)) return [goal];

  const W = grid.width;
  const s0 = nearestWalkable(grid, start.x, start.y);
  const sIdx = Math.floor(s0.y) * W + Math.floor(s0.x);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);
  const gIdx = gy * W + gx;
  const n = W * grid.height;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap(n);
  const h = (i: number) => {
    const dx = Math.abs((i % W) - gx);
    const dy = Math.abs(Math.floor(i / W) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  g[sIdx] = 0;
  open.push(sIdx, h(sIdx));
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gIdx) {
      found = true;
      break;
    }
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= grid.height) continue;
      const ni = ny * W + nx;
      if (grid.blocked[ni] || closed[ni]) continue;
      if (dx !== 0 && dy !== 0) {
        if (grid.blocked[cy * W + nx] || grid.blocked[ny * W + cx]) continue;
      }
      const ng = g[cur]! + cost;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  if (!found) return [];

  const raw: Vec[] = [];
  for (let i = gIdx; i !== -1 && i !== sIdx; i = came[i]!) {
    raw.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 });
  }
  raw.reverse();
  if (raw.length > 0) raw[raw.length - 1] = goal;
  else raw.push(goal);

  // String-pulling: skip waypoints that can be reached directly.
  const out: Vec[] = [];
  let from = start;
  let i = 0;
  while (i < raw.length) {
    let j = raw.length - 1;
    while (j > i && !walkable(grid, from, raw[j]!)) j--;
    out.push(raw[j]!);
    from = raw[j]!;
    i = j + 1;
  }
  return out;
}
