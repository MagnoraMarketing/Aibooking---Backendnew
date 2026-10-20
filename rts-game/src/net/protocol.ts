import type { Command, GameState } from "../game/types";

// Host-authoritative protocol. The host runs the only simulation; the guest
// sends commands and renders the host's snapshots. This keeps the guest
// unable to cheat, and makes reconnection trivial: any fresh snapshot fully
// restores a client.

export const SNAPSHOT_INTERVAL_MS = 100;
/** A peer silent for this long is considered disconnected. */
export const PEER_TIMEOUT_MS = 4000;
export const HELLO_INTERVAL_MS = 1000;

export type NetMessage =
  | { t: "hello"; from: string }
  | { t: "welcome"; to: string }
  | { t: "full"; to: string }
  | { t: "snap"; seq: number; started: boolean; paused: boolean; state: GameState }
  | { t: "cmd"; from: string; cmd: Command }
  | { t: "ping"; from: string }
  | { t: "bye"; from: string };

/**
 * Lean snapshot for the wire: drops path waypoints (the guest only needs the
 * destination) and rounds floats to keep payloads small.
 */
export function encodeSnapshot(state: GameState): GameState {
  return JSON.parse(
    JSON.stringify(state, (key, value: unknown) => {
      if (key === "path") return [];
      if (typeof value === "number" && !Number.isInteger(value)) return Math.round(value * 1000) / 1000;
      return value;
    }),
  ) as GameState;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomRoomCode(): string {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null;
}

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}
