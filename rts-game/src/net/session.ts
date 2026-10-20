import { createAI, runAI, type AIMemory, type Difficulty } from "../game/ai";
import { DT } from "../game/constants";
import { applyCommand, createGame, step } from "../game/sim";
import type { Command, EntityId, GameState, PlayerId, Vec } from "../game/types";
import {
  HELLO_INTERVAL_MS,
  PEER_TIMEOUT_MS,
  SNAPSHOT_INTERVAL_MS,
  encodeSnapshot,
  randomToken,
  type NetMessage,
} from "./protocol";
import type { Transport, TransportStatus } from "./transport";

// A session owns "where the game state comes from": a local simulation with
// an AI (practice), the authoritative simulation plus a network link (host),
// or a network mirror of someone else's simulation (guest). The UI talks to
// all three through the same interface.

export type ConnState =
  | "local"
  | "connecting"
  | "waiting" // host: lobby, no opponent yet
  | "connected"
  | "opponent-left" // host: guest went silent mid-game
  | "host-left" // guest: host went silent
  | "full";

export interface SessionInfo {
  mode: "practice" | "host" | "guest";
  localPlayer: PlayerId;
  conn: ConnState;
  paused: boolean;
  /** Milliseconds the opponent has been unreachable (0 when connected). */
  disconnectedMs: number;
  transport: Transport["kind"] | null;
  transportStatus: TransportStatus;
  transportDetail?: string;
  room?: string;
}

export interface SessionView {
  state: GameState;
  prevPos: ReadonlyMap<EntityId, Vec>;
  alpha: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export abstract class Session {
  abstract readonly mode: SessionInfo["mode"];
  abstract readonly localPlayer: PlayerId;
  state: GameState;
  protected prevPos = new Map<EntityId, Vec>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(state: GameState) {
    this.state = state;
  }

  abstract issue(cmd: Command): void;
  abstract info(now: number): SessionInfo;
  abstract view(now: number): SessionView;
  /** Advance timers, simulation and networking up to wall-clock `now` (ms). */
  abstract pump(now: number): void;

  start(): this {
    this.timer ??= setInterval(() => this.pump(performance.now()), 15);
    return this;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected notify() {
    for (const fn of this.listeners) fn();
  }

  protected snapshotPositions() {
    this.prevPos = new Map(this.state.squads.map((s) => [s.id, { x: s.pos.x, y: s.pos.y }]));
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

/** Fixed-timestep accumulator. Caps catch-up so a stalled tab does not spiral. */
class Stepper {
  private last: number | null = null;
  acc = 0;
  advance(now: number, run: boolean, stepOnce: () => void) {
    const elapsed = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (!run) {
      this.acc = 0;
      return;
    }
    this.acc = Math.min(this.acc + elapsed, 2000);
    const dtMs = DT * 1000;
    while (this.acc >= dtMs) {
      this.acc -= dtMs;
      stepOnce();
    }
  }
  alpha() {
    return this.acc / (DT * 1000);
  }
}

// ---------------------------------------------------------------------------

export class PracticeSession extends Session {
  readonly mode = "practice";
  readonly localPlayer = 0 as const;
  paused = false;
  private ai: AIMemory;
  private stepper = new Stepper();

  constructor(private difficulty: Difficulty, seed = Math.floor(Math.random() * 2 ** 31)) {
    super(createGame(seed));
    this.ai = createAI(1, difficulty);
  }

  issue(cmd: Command) {
    applyCommand(this.state, { ...cmd, player: 0 } as Command);
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.notify();
  }

  restartMatch() {
    this.state = createGame(Math.floor(Math.random() * 2 ** 31));
    this.ai = createAI(1, this.difficulty);
    this.prevPos.clear();
    this.paused = false;
    this.notify();
  }

  pump(now: number) {
    this.stepper.advance(now, !this.paused && this.state.winner === null, () => {
      this.snapshotPositions();
      for (const c of runAI(this.state, this.ai)) applyCommand(this.state, c);
      step(this.state);
    });
  }

  view(): SessionView {
    return { state: this.state, prevPos: this.prevPos, alpha: this.stepper.alpha() };
  }

  info(): SessionInfo {
    return {
      mode: "practice",
      localPlayer: 0,
      conn: "local",
      paused: this.paused,
      disconnectedMs: 0,
      transport: null,
      transportStatus: "open",
    };
  }
}

// ---------------------------------------------------------------------------

export interface HostRecord {
  token: string;
  guestToken: string | null;
  started: boolean;
  state: GameState;
  savedAt: number;
}

export const hostRecordKey = (room: string) => `rts:host:${room}`;
const PERSIST_INTERVAL_MS = 1500;

export class HostSession extends Session {
  readonly mode = "host";
  readonly localPlayer = 0 as const;
  readonly token: string;
  private guestToken: string | null;
  private guestLastSeen = -Infinity;
  private started: boolean;
  private seq = 0;
  private lastSnapAt = -Infinity;
  private lastPersistAt = -Infinity;
  private stepper = new Stepper();
  private tStatus: TransportStatus = "connecting";
  private tDetail?: string;
  private lastNow = 0;

  constructor(
    readonly room: string,
    private transport: Transport,
    private store: KeyValueStore | null,
    resume?: HostRecord | null,
  ) {
    super(resume?.state ?? createGame(Math.floor(Math.random() * 2 ** 31)));
    this.token = resume?.token ?? randomToken();
    this.guestToken = resume?.guestToken ?? null;
    this.started = resume?.started ?? false;
    transport.onMessage((m) => this.onMessage(m));
    transport.onStatus((s, d) => {
      this.tStatus = s;
      this.tDetail = d;
      this.notify();
    });
  }

  private guestConnected(now: number) {
    return now - this.guestLastSeen < PEER_TIMEOUT_MS;
  }

  private onMessage(m: NetMessage) {
    const now = this.lastNow;
    switch (m.t) {
      case "hello": {
        if (this.guestToken === null) this.guestToken = m.from;
        if (m.from !== this.guestToken) {
          this.transport.send({ t: "full", to: m.from });
          return;
        }
        const wasConnected = this.guestConnected(now);
        this.guestLastSeen = now;
        this.transport.send({ t: "welcome", to: m.from });
        this.lastSnapAt = -Infinity; // push a snapshot right away
        if (!wasConnected) this.notify();
        break;
      }
      case "ping":
        if (m.from === this.guestToken) this.guestLastSeen = now;
        break;
      case "cmd":
        if (m.from !== this.guestToken) return;
        this.guestLastSeen = now;
        // Never trust the claimed player: the guest always plays seat 1.
        applyCommand(this.state, { ...m.cmd, player: 1 } as Command);
        break;
      case "bye":
        if (m.from === this.guestToken) {
          this.guestLastSeen = -Infinity;
          this.notify();
        }
        break;
      default:
        break;
    }
  }

  issue(cmd: Command) {
    applyCommand(this.state, { ...cmd, player: 0 } as Command);
  }

  pump(now: number) {
    this.lastNow = now;
    const connected = this.guestConnected(now);
    if (connected && !this.started) {
      this.started = true;
      this.notify();
    }
    const wasConn = this.lastConnected;
    this.lastConnected = connected;
    if (wasConn !== connected) this.notify();

    const running = this.started && connected && this.state.winner === null;
    this.stepper.advance(now, running, () => {
      this.snapshotPositions();
      step(this.state);
    });

    if (now - this.lastSnapAt >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapAt = now;
      this.transport.send({
        t: "snap",
        seq: ++this.seq,
        started: this.started,
        paused: this.started && !connected,
        state: encodeSnapshot(this.state),
      });
    }
    if (this.store && now - this.lastPersistAt >= PERSIST_INTERVAL_MS) {
      this.lastPersistAt = now;
      this.persist();
    }
  }
  private lastConnected = false;

  persist() {
    const rec: HostRecord = {
      token: this.token,
      guestToken: this.guestToken,
      started: this.started,
      state: this.state,
      savedAt: Date.now(),
    };
    try {
      this.store?.set(hostRecordKey(this.room), JSON.stringify(rec));
    } catch {
      // Storage full or unavailable: reconnection after a host refresh is
      // best-effort, the live game is unaffected.
    }
  }

  /** Start a fresh match in the same room with the same opponent. */
  restartMatch() {
    this.state = createGame(Math.floor(Math.random() * 2 ** 31));
    this.prevPos.clear();
    this.lastSnapAt = -Infinity;
    this.notify();
  }

  /** Award the win when the opponent has been gone for a while. */
  claimVictory(now: number): boolean {
    if (!this.started || this.guestConnected(now) || now - this.guestLastSeen < 30_000) return false;
    applyCommand(this.state, { type: "forfeit", player: 1 });
    this.lastSnapAt = -Infinity;
    this.notify();
    return true;
  }

  view(): SessionView {
    return { state: this.state, prevPos: this.prevPos, alpha: this.stepper.alpha() };
  }

  info(now: number): SessionInfo {
    const connected = this.guestConnected(now);
    return {
      mode: "host",
      localPlayer: 0,
      conn: !this.started ? "waiting" : connected ? "connected" : "opponent-left",
      paused: this.started && !connected,
      disconnectedMs: this.started && !connected && Number.isFinite(this.guestLastSeen) ? now - this.guestLastSeen : 0,
      transport: this.transport.kind,
      transportStatus: this.tStatus,
      transportDetail: this.tDetail,
      room: this.room,
    };
  }

  dispose() {
    this.persist();
    this.transport.close();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

export class GuestSession extends Session {
  readonly mode = "guest";
  readonly localPlayer = 1 as const;
  private welcomed = false;
  private full = false;
  private hasSnapshot = false;
  private started = false;
  private hostPaused = false;
  private lastSeq = 0;
  private lastSnapAt = -Infinity;
  private lastHelloAt = -Infinity;
  private lastNow = 0;
  private tStatus: TransportStatus = "connecting";
  private tDetail?: string;

  constructor(
    readonly room: string,
    private transport: Transport,
    readonly token: string,
  ) {
    super(createGame(0));
    transport.onMessage((m) => this.onMessage(m));
    transport.onStatus((s, d) => {
      this.tStatus = s;
      this.tDetail = d;
      if (s === "open") this.lastHelloAt = -Infinity; // re-announce after reconnect
      this.notify();
    });
  }

  private onMessage(m: NetMessage) {
    switch (m.t) {
      case "welcome":
        if (m.to === this.token && !this.welcomed) {
          this.welcomed = true;
          this.notify();
        }
        break;
      case "full":
        if (m.to === this.token) {
          this.full = true;
          this.notify();
        }
        break;
      case "snap": {
        if (this.full) return;
        // A host restart resets seq; accept it rather than freezing.
        if (m.seq <= this.lastSeq && m.seq > 5) return;
        this.lastSeq = m.seq;
        this.snapshotPositions();
        const changed = !this.hasSnapshot || this.started !== m.started || this.hostPaused !== m.paused;
        this.state = m.state;
        this.started = m.started;
        this.hostPaused = m.paused;
        this.hasSnapshot = true;
        this.lastSnapAt = this.lastNow;
        if (changed || m.state.winner !== null) this.notify();
        break;
      }
      default:
        break;
    }
  }

  private hostAlive(now: number) {
    return now - this.lastSnapAt < PEER_TIMEOUT_MS;
  }

  issue(cmd: Command) {
    if (!this.welcomed || this.full) return;
    this.transport.send({ t: "cmd", from: this.token, cmd: { ...cmd, player: 1 } as Command });
  }

  pump(now: number) {
    const wasAlive = this.hostAlive(this.lastNow);
    this.lastNow = now;
    if (this.full) return;
    if (now - this.lastHelloAt >= HELLO_INTERVAL_MS) {
      this.lastHelloAt = now;
      // Keep saying hello until welcomed, while the host seems gone, or while
      // the host is in its lobby, so a restarted host re-admits us; otherwise
      // a light keep-alive ping.
      const announce = !this.welcomed || !this.hostAlive(now) || !this.started;
      const msg: NetMessage = announce ? { t: "hello", from: this.token } : { t: "ping", from: this.token };
      this.transport.send(msg);
    }
    if (wasAlive !== this.hostAlive(now)) this.notify();
  }

  view(now: number): SessionView {
    return { state: this.state, prevPos: this.prevPos, alpha: (now - this.lastSnapAt) / SNAPSHOT_INTERVAL_MS };
  }

  info(now: number): SessionInfo {
    let conn: ConnState;
    if (this.full) conn = "full";
    else if (!this.hasSnapshot || !this.welcomed) conn = "connecting";
    else if (!this.hostAlive(now)) conn = "host-left";
    else if (!this.started) conn = "waiting";
    else conn = "connected";
    return {
      mode: "guest",
      localPlayer: 1,
      conn,
      paused: this.hostPaused || conn === "host-left",
      disconnectedMs: conn === "host-left" ? now - this.lastSnapAt : 0,
      transport: this.transport.kind,
      transportStatus: this.tStatus,
      transportDetail: this.tDetail,
      room: this.room,
    };
  }

  /** Tell the host we are leaving on purpose, so it pauses immediately. */
  leave() {
    this.transport.send({ t: "bye", from: this.token });
  }

  dispose() {
    this.transport.close();
    super.dispose();
  }
}
