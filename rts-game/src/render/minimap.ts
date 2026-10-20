import { MAP } from "../game/map";
import type { PlayerId } from "../game/types";
import { renderTerrain } from "./terrain";
import { NEUTRAL, TEAM } from "./theme";
import type { Camera } from "./renderer";
import type { GameState } from "../game/types";

export const MINIMAP_SCALE = 4; // pixels per tile

let terrain: HTMLCanvasElement | null = null;

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  viewW: number,
  viewH: number,
  localPlayer: PlayerId,
  now: number,
) {
  const s = MINIMAP_SCALE;
  if (!terrain) terrain = renderTerrain(MAP, s);
  ctx.drawImage(terrain, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(0, 0, MAP.width * s, MAP.height * s);

  for (const p of state.points) {
    ctx.fillStyle = p.owner === null ? NEUTRAL : TEAM[p.owner].main;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.pos.x * s, p.pos.y * s, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const st of state.structures) {
    ctx.fillStyle = TEAM[st.owner].dark;
    ctx.fillRect(st.x * s - 1, st.y * s - 1, st.w * s + 2, st.h * s + 2);
    ctx.fillStyle = TEAM[st.owner].main;
    ctx.fillRect(st.x * s, st.y * s, st.w * s, st.h * s);
  }
  for (const sq of state.squads) {
    const firing = sq.firingAt !== null && sq.owner === localPlayer && Math.floor(now * 4) % 2 === 0;
    ctx.fillStyle = firing ? "#fff3b0" : TEAM[sq.owner].light;
    ctx.fillRect(sq.pos.x * s - 2, sq.pos.y * s - 2, 4, 4);
  }
  // Camera viewport.
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.x * s + 0.5, cam.y * s + 0.5, (viewW / cam.scale) * s, (viewH / cam.scale) * s);
}
