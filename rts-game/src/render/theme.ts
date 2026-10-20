import type { PlayerId } from "../game/types";

export const TILE = 32; // pixels per tile at zoom 1

export const TEAM = {
  0: { main: "#4f86d9", dark: "#1f3f73", light: "#a9c8f5", name: "Blue Force" },
  1: { main: "#d9583f", dark: "#6e2216", light: "#f5b3a3", name: "Red Force" },
} as const satisfies Record<PlayerId, { main: string; dark: string; light: string; name: string }>;

export const NEUTRAL = "#d8d2bc";

export const TERRAIN = {
  grass: ["#5f7d3b", "#5a7738", "#64833f", "#58733a"],
  road: "#a99470",
  roadEdge: "#8c7a59",
  forestFloor: "#3f5a2a",
  tree: ["#2c4a22", "#33552a", "#264020"],
  wall: "#9a978c",
  wallDark: "#6c6a62",
  roofs: ["#7d4a38", "#6e5a4a", "#80664a", "#5f4a3f"],
  shadow: "rgba(0,0,0,0.28)",
};
