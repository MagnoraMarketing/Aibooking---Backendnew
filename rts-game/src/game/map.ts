import { Tile, type GameMap, type Vec } from "./types";

const W = 60;
const H = 40;

type Rect = [x: number, y: number, w: number, h: number];

// The map is authored for the left half only (player 0's side) and the
// top half where noted, then mirrored, so both players get an identical
// battlefield.
const FOREST: Rect[] = [
  [2, 2, 4, 6],
  [14, 2, 5, 3],
  [15, 14, 3, 3],
  [8, 26, 2, 3],
];
const ROADS: Rect[] = [
  [7, 19, 23, 2], // main road from the HQ to the village
  [29, 3, 1, 34], // north-south road through the centre
  [11, 7, 2, 26], // western ring road
  [11, 7, 19, 2], // northern road
  [11, 31, 19, 2], // southern road
];
const WALLS: Rect[] = [
  [15, 12, 8, 1],
  [19, 15, 1, 3],
  [26, 10, 3, 1],
  [21, 4, 1, 2],
  [6, 9, 3, 1],
];
const BUILDINGS: Rect[] = [
  [25, 16, 3, 2],
  [26, 3, 2, 2],
  [22, 9, 3, 3],
  [16, 9, 2, 2],
];

/** Mirror a rect from the top half into the bottom half. */
function mirrorY([x, y, w, h]: Rect): Rect {
  return [x, H - y - h, w, h];
}

export function createMap(): GameMap {
  const tiles: Tile[] = new Array(W * H).fill(Tile.Grass);
  const fill = (rects: Rect[], tile: Tile, mirrorVertically: boolean) => {
    const all = mirrorVertically ? [...rects, ...rects.map(mirrorY)] : rects;
    for (const [rx, ry, rw, rh] of all) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          if (x >= 0 && x < W / 2 && y >= 0 && y < H) tiles[y * W + x] = tile;
        }
      }
    }
  };
  fill(FOREST.slice(0, 3), Tile.Forest, true);
  fill(FOREST.slice(3), Tile.Forest, false);
  fill(ROADS, Tile.Road, false);
  fill(WALLS, Tile.Wall, true);
  fill(BUILDINGS, Tile.Building, true);

  // Mirror the left half onto the right half.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W / 2; x++) {
      tiles[y * W + (W - 1 - x)] = tiles[y * W + x]!;
    }
  }

  const hq: Vec = { x: 3, y: 18 };
  const barracks: Vec = { x: 4, y: 13 };
  return {
    width: W,
    height: H,
    tiles,
    points: [
      { x: 30, y: 8 },
      { x: 30, y: 20 },
      { x: 30, y: 32 },
    ],
    bases: [
      { hq, barracks },
      { hq: { x: W - hq.x - 4, y: hq.y }, barracks: { x: W - barracks.x - 3, y: barracks.y } },
    ],
  };
}

/** The single battlefield. Created once; it is static for the whole match. */
export const MAP: GameMap = createMap();

export function tileAt(map: GameMap, x: number, y: number): Tile {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return Tile.Building;
  return map.tiles[ty * map.width + tx]!;
}

export function isSolidTile(t: Tile): boolean {
  return t === Tile.Building || t === Tile.Wall;
}
