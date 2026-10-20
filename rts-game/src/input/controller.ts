import { MAP } from "../game/map";
import { isStructure } from "../game/sim";
import type { Command, EntityId, GameState, PlayerId, Squad, Structure, Vec } from "../game/types";
import type { Camera, RenderInput } from "../render/renderer";
import { interpolatedPos } from "../render/renderer";
import { TILE } from "../render/theme";

export interface ControllerHost {
  view(): { state: GameState; prevPos: ReadonlyMap<EntityId, Vec>; alpha: number };
  localPlayer: PlayerId;
  issue(cmd: Command): void;
  /** Hotkeys that map to HUD actions (recruit, build...) are delegated. */
  onAction(action: HotkeyAction): void;
  onSelectionChange(): void;
}

export type HotkeyAction = "recruit-riflemen" | "recruit-machinegun" | "build-barracks" | "reinforce" | "stop" | "menu";

const MIN_SCALE = 18;
const MAX_SCALE = 56;
const PAN_SPEED = 900; // screen pixels per second
const EDGE = 14; // pixels from the edge that start edge-scrolling

/**
 * Translates mouse and keyboard input into selection, camera movement and
 * game commands. Owns no game state: it reads the latest view on demand and
 * emits commands through the host, so it works the same for every session.
 */
export class Controller {
  cam: Camera = { x: 0, y: 0, scale: TILE };
  selected = new Set<EntityId>();
  hoverId: EntityId | null = null;
  dragBox: RenderInput["dragBox"] = null;
  markers: RenderInput["markers"] = [];
  private groups = new Map<number, EntityId[]>();
  private keys = new Set<string>();
  private mouse: { x: number; y: number; inside: boolean } = { x: 0, y: 0, inside: false };
  private dragStart: { x: number; y: number } | null = null;
  private lastClick = { at: 0, id: -1 as EntityId };
  private middleDrag: { x: number; y: number; camX: number; camY: number } | null = null;
  private width = 1;
  private height = 1;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private host: ControllerHost,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on(canvas, "mousedown", (e) => this.onMouseDown(e));
    on(window, "mousemove", (e) => this.onMouseMove(e));
    on(window, "mouseup", (e) => this.onMouseUp(e));
    on(canvas, "mouseleave", () => (this.mouse.inside = false));
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(canvas, "wheel", (e) => this.onWheel(e), { passive: false });
    on(window, "keydown", (e) => this.onKeyDown(e));
    on(window, "keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => this.keys.clear());
  }

  dispose() {
    for (const c of this.cleanup) c();
  }

  private sized = false;

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    if (!this.sized && width > 1) {
      this.sized = true;
      this.centerOnHq();
    }
    this.clampCamera();
  }

  // --- Coordinates ---------------------------------------------------------

  screenToWorld(sx: number, sy: number): Vec {
    return { x: this.cam.x + sx / this.cam.scale, y: this.cam.y + sy / this.cam.scale };
  }

  centerOn(p: Vec) {
    this.cam.x = p.x - this.width / this.cam.scale / 2;
    this.cam.y = p.y - this.height / this.cam.scale / 2;
    this.clampCamera();
  }

  centerOnHq() {
    const hq = MAP.bases[this.host.localPlayer].hq;
    this.centerOn({ x: hq.x + (this.host.localPlayer === 0 ? 10 : -6), y: hq.y + 1.5 });
  }

  private clampCamera() {
    const vw = this.width / this.cam.scale;
    const vh = this.height / this.cam.scale;
    const margin = 2;
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    this.cam.x = clamp(this.cam.x, -margin, MAP.width + margin - vw);
    this.cam.y = clamp(this.cam.y, -margin, MAP.height + margin - vh);
  }

  private local(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // --- Picking ---------------------------------------------------------------

  pick(world: Vec): Squad | Structure | null {
    const view = this.host.view();
    let best: Squad | null = null;
    let bestD = 0.85;
    for (const sq of view.state.squads) {
      const p = interpolatedPos(sq, view);
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d < bestD) {
        bestD = d;
        best = sq;
      }
    }
    if (best) return best;
    return (
      view.state.structures.find(
        (s) => world.x >= s.x && world.x <= s.x + s.w && world.y >= s.y && world.y <= s.y + s.h,
      ) ?? null
    );
  }

  /** The local player's selected squads that still exist. */
  selectedSquads(): Squad[] {
    const state = this.host.view().state;
    return state.squads.filter((s) => this.selected.has(s.id) && s.owner === this.host.localPlayer);
  }

  selectedStructure(): Structure | null {
    const state = this.host.view().state;
    return state.structures.find((s) => this.selected.has(s.id)) ?? null;
  }

  /** Drop dead entities from the selection. Call once per frame. */
  prune() {
    const state = this.host.view().state;
    let changed = false;
    for (const id of this.selected) {
      if (!state.squads.some((s) => s.id === id) && !state.structures.some((s) => s.id === id)) {
        this.selected.delete(id);
        changed = true;
      }
    }
    if (changed) this.host.onSelectionChange();
  }

  setSelection(ids: Iterable<EntityId>) {
    this.selected = new Set(ids);
    this.host.onSelectionChange();
  }

  // --- Mouse -----------------------------------------------------------------

  private onMouseDown(e: MouseEvent) {
    const p = this.local(e);
    if (e.button === 0) {
      this.dragStart = p;
      this.dragBox = null;
    } else if (e.button === 2) {
      this.command(this.screenToWorld(p.x, p.y));
    } else if (e.button === 1) {
      e.preventDefault();
      this.middleDrag = { x: p.x, y: p.y, camX: this.cam.x, camY: this.cam.y };
    }
  }

  private onMouseMove(e: MouseEvent) {
    const p = this.local(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    // Derived from real coordinates (not mouseenter) so edge-scrolling never
    // starts from a stale position.
    this.mouse.inside = e.target === this.canvas && p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height;
    if (this.middleDrag) {
      this.cam.x = this.middleDrag.camX - (p.x - this.middleDrag.x) / this.cam.scale;
      this.cam.y = this.middleDrag.camY - (p.y - this.middleDrag.y) / this.cam.scale;
      this.clampCamera();
    }
    if (this.dragStart && Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) > 5) {
      this.dragBox = { x0: this.dragStart.x, y0: this.dragStart.y, x1: p.x, y1: p.y };
    }
    const hit = this.pick(this.screenToWorld(p.x, p.y));
    this.hoverId = hit?.id ?? null;
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 1) this.middleDrag = null;
    if (e.button !== 0 || !this.dragStart) return;
    const additive = e.shiftKey;
    const view = this.host.view();
    const me = this.host.localPlayer;
    if (this.dragBox) {
      const a = this.screenToWorld(Math.min(this.dragBox.x0, this.dragBox.x1), Math.min(this.dragBox.y0, this.dragBox.y1));
      const b = this.screenToWorld(Math.max(this.dragBox.x0, this.dragBox.x1), Math.max(this.dragBox.y0, this.dragBox.y1));
      const inside = view.state.squads.filter((s) => {
        if (s.owner !== me) return false;
        const p = interpolatedPos(s, view);
        return p.x >= a.x - 0.4 && p.x <= b.x + 0.4 && p.y >= a.y - 0.4 && p.y <= b.y + 0.4;
      });
      const base = additive ? [...this.selected].filter((id) => view.state.squads.some((s) => s.id === id && s.owner === me)) : [];
      if (inside.length > 0 || !additive) this.setSelection([...base, ...inside.map((s) => s.id)]);
    } else {
      const hit = this.pick(this.screenToWorld(this.dragStart.x, this.dragStart.y));
      const now = performance.now();
      if (!hit) {
        if (!additive) this.setSelection([]);
      } else if (!isStructure(hit) && hit.owner === me && now - this.lastClick.at < 350 && this.lastClick.id === hit.id) {
        // Double-click: every own squad of that type on screen.
        const tl = this.screenToWorld(0, 0);
        const br = this.screenToWorld(this.width, this.height);
        this.setSelection(
          view.state.squads
            .filter((s) => s.owner === me && s.type === hit.type)
            .filter((s) => s.pos.x >= tl.x && s.pos.x <= br.x && s.pos.y >= tl.y && s.pos.y <= br.y)
            .map((s) => s.id),
        );
      } else if (additive && !isStructure(hit) && hit.owner === me) {
        const next = new Set([...this.selected].filter((id) => view.state.squads.some((s) => s.id === id && s.owner === me)));
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        this.setSelection(next);
      } else {
        this.setSelection([hit.id]);
      }
      this.lastClick = { at: now, id: hit?.id ?? -1 };
    }
    this.dragStart = null;
    this.dragBox = null;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    const before = this.screenToWorld(p.x, p.y);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.cam.scale * factor));
    this.cam.x = before.x - p.x / this.cam.scale;
    this.cam.y = before.y - p.y / this.cam.scale;
    this.clampCamera();
  }

  /** Right-click: attack what is under the cursor, otherwise move / set rally. */
  command(world: Vec) {
    const me = this.host.localPlayer;
    const squads = this.selectedSquads();
    const target = this.pick(world);
    const now = performance.now() / 1000;
    if (squads.length > 0) {
      const ids = squads.map((s) => s.id);
      if (target && target.owner !== me) {
        this.host.issue({ type: "attack", player: me, ids, targetId: target.id });
        const tp = isStructure(target) ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : target.pos;
        this.markers.push({ pos: tp, kind: "attack", at: now });
      } else {
        this.host.issue({ type: "move", player: me, ids, x: world.x, y: world.y });
        this.markers.push({ pos: world, kind: "move", at: now });
      }
    } else {
      const s = this.selectedStructure();
      if (s && s.owner === me) {
        this.host.issue({ type: "rally", player: me, structureId: s.id, x: world.x, y: world.y });
        this.markers.push({ pos: world, kind: "rally", at: now });
      }
    }
    this.markers = this.markers.filter((m) => now - m.at < 1);
  }

  // --- Keyboard ----------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const key = e.key.toLowerCase();
    const me = this.host.localPlayer;
    const state = this.host.view().state;
    if (key.startsWith("arrow")) {
      this.keys.add(key);
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(key)) {
      const n = Number(key);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, this.selectedSquads().map((s) => s.id));
      } else {
        const ids = (this.groups.get(n) ?? []).filter((id) => state.squads.some((s) => s.id === id));
        if (ids.length > 0) {
          const already = ids.every((id) => this.selected.has(id)) && ids.length === this.selected.size;
          this.setSelection(ids);
          if (already) this.centerOnSelection();
        }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "a") {
      e.preventDefault();
      this.setSelection(state.squads.filter((s) => s.owner === me).map((s) => s.id));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (key) {
      case "escape":
        if (this.selected.size > 0) this.setSelection([]);
        else this.host.onAction("menu");
        break;
      case " ":
        e.preventDefault();
        this.centerOnSelection();
        break;
      case "h": {
        const hq = state.structures.find((s) => s.owner === me && s.kind === "hq");
        if (hq) {
          this.setSelection([hq.id]);
          this.centerOn({ x: hq.x + hq.w / 2, y: hq.y + hq.h / 2 });
        }
        break;
      }
      case "s":
        this.host.onAction("stop");
        break;
      case "r":
        this.host.onAction("recruit-riflemen");
        break;
      case "m":
        this.host.onAction("recruit-machinegun");
        break;
      case "b":
        this.host.onAction("build-barracks");
        break;
      case "e":
        this.host.onAction("reinforce");
        break;
    }
  }

  centerOnSelection() {
    const view = this.host.view();
    const squads = view.state.squads.filter((s) => this.selected.has(s.id));
    if (squads.length > 0) {
      const c = squads.reduce((a, s) => ({ x: a.x + s.pos.x / squads.length, y: a.y + s.pos.y / squads.length }), { x: 0, y: 0 });
      this.centerOn(c);
      return;
    }
    const s = this.selectedStructure();
    if (s) this.centerOn({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
  }

  // --- Per-frame -----------------------------------------------------------------

  update(dt: number) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("arrowright")) dx += 1;
    if (this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("arrowdown")) dy += 1;
    if (this.mouse.inside && !this.dragStart && !this.middleDrag && document.hasFocus()) {
      if (this.mouse.x < EDGE) dx -= 1;
      if (this.mouse.x > this.width - EDGE) dx += 1;
      if (this.mouse.y < EDGE) dy -= 1;
      if (this.mouse.y > this.height - EDGE) dy += 1;
    }
    if (dx !== 0 || dy !== 0) {
      this.cam.x += (dx * PAN_SPEED * dt) / this.cam.scale;
      this.cam.y += (dy * PAN_SPEED * dt) / this.cam.scale;
      this.clampCamera();
    }
    this.prune();
  }
}
