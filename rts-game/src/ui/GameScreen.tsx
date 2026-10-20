import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { UNITS } from "../game/constants";
import { MAP } from "../game/map";
import type { Command, UnitType } from "../game/types";
import { Controller, type HotkeyAction } from "../input/controller";
import { GuestSession, HostSession, PracticeSession, type Session } from "../net/session";
import { MINIMAP_SCALE, renderMinimap } from "../render/minimap";
import { Renderer } from "../render/renderer";
import { CommandPanel, SelectionPanel, TopBar } from "./Hud";
import { Overlays } from "./Overlays";

interface Props {
  session: Session;
  onExit(): void;
}

export function GameScreen({ session, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<Controller | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const actionRef = useRef<(a: HotkeyAction) => void>(() => {});

  // Session status changes re-render immediately; the HUD also refreshes at
  // 10 Hz for counters and progress bars.
  useEffect(() => session.subscribe(rerender), [session]);
  useEffect(() => {
    const t = setInterval(rerender, 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctrl = new Controller(canvas, {
      view: () => session.view(performance.now()),
      localPlayer: session.localPlayer,
      issue: (cmd: Command) => session.issue(cmd),
      onAction: (a) => actionRef.current(a),
      onSelectionChange: rerender,
    });
    setController(ctrl);
    const renderer = new Renderer();
    const ctx = canvas.getContext("2d")!;
    const mini = minimapRef.current!;
    const mctx = mini.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      const wrap = wrapRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = wrap.clientWidth;
      cssH = wrap.clientHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctrl.resize(cssW, cssH);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);

    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      ctrl.update(dt);
      const view = session.view(t);
      renderer.render(ctx, cssW, cssH, ctrl.cam, {
        ...view,
        localPlayer: session.localPlayer,
        selected: ctrl.selected,
        hoverId: ctrl.hoverId,
        dragBox: ctrl.dragBox,
        now: t / 1000,
        markers: ctrl.markers,
      });
      renderMinimap(mctx, view.state, ctrl.cam, cssW, cssH, session.localPlayer, t / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Tell the host right away when the guest closes the tab.
    const bye = () => {
      if (session instanceof GuestSession) session.leave();
      if (session instanceof HostSession) session.persist();
    };
    window.addEventListener("beforeunload", bye);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctrl.dispose();
      window.removeEventListener("beforeunload", bye);
    };
  }, [session]);

  const me = session.localPlayer;
  const now = performance.now();
  const view = session.view(now);
  const state = view.state;
  const info = session.info(now);

  const recruit = useCallback(
    (unit: UnitType, structureId?: number) => {
      const st = session.view(performance.now()).state;
      const sel = controller?.selectedStructure();
      // Prefer the selected building, else any own building that can train it.
      const candidates = st.structures.filter(
        (s) => s.owner === me && s.built >= 1 && (s.kind === "barracks" || UNITS[unit].requires === s.kind),
      );
      const from =
        candidates.find((s) => s.id === structureId) ??
        candidates.find((s) => s.id === sel?.id) ??
        candidates.find((s) => s.kind === UNITS[unit].requires) ??
        candidates[0];
      if (from) session.issue({ type: "recruit", player: me, structureId: from.id, unit });
    },
    [session, controller, me],
  );

  const actions = useMemo(
    () => ({
      recruit,
      build: () => session.issue({ type: "build", player: me, kind: "barracks" }),
      stop: () => {
        const ids = controller?.selectedSquads().map((s) => s.id) ?? [];
        if (ids.length) session.issue({ type: "stop", player: me, ids });
      },
      reinforce: () => {
        const ids = controller?.selectedSquads().map((s) => s.id) ?? [];
        if (ids.length) session.issue({ type: "reinforce", player: me, ids });
      },
      cancel: (structureId: number, index: number) => session.issue({ type: "cancel", player: me, structureId, index }),
      select: (ids: number[]) => controller?.setSelection(ids),
      focus: (ids: number[]) => {
        controller?.setSelection(ids);
        controller?.centerOnSelection();
      },
    }),
    [session, controller, me, recruit],
  );

  actionRef.current = (a: HotkeyAction) => {
    switch (a) {
      case "recruit-riflemen":
        return actions.recruit("riflemen");
      case "recruit-machinegun":
        return actions.recruit("machinegun");
      case "build-barracks":
        return actions.build();
      case "reinforce":
        return actions.reinforce();
      case "stop":
        return actions.stop();
      case "menu":
        setMenuOpen((o) => !o);
        return;
    }
  };

  // Practice pauses while the menu is open.
  useEffect(() => {
    if (session instanceof PracticeSession) session.setPaused(menuOpen);
  }, [menuOpen, session]);

  const onMinimap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!controller) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = {
      x: ((e.clientX - r.left) / r.width) * MAP.width,
      y: ((e.clientY - r.top) / r.height) * MAP.height,
    };
    if (e.button === 2) controller.command(p);
    else controller.centerOn(p);
  };

  return (
    <div className="game">
      <TopBar state={state} me={me} info={info} onMenu={() => setMenuOpen(true)} />
      <div className="viewport" ref={wrapRef}>
        <canvas ref={canvasRef} className="battlefield" />
      </div>
      <div className="bottom">
        <div className="minimap-frame">
          <canvas
            ref={minimapRef}
            className="minimap"
            width={MAP.width * MINIMAP_SCALE}
            height={MAP.height * MINIMAP_SCALE}
            onMouseDown={onMinimap}
            onMouseMove={(e) => e.buttons === 1 && onMinimap(e)}
            onContextMenu={(e) => {
              e.preventDefault();
              onMinimap(e);
            }}
          />
        </div>
        {controller && <SelectionPanel state={state} me={me} controller={controller} actions={actions} />}
        {controller && <CommandPanel state={state} me={me} controller={controller} actions={actions} />}
      </div>
      <Overlays
        session={session}
        info={info}
        state={state}
        menuOpen={menuOpen}
        onCloseMenu={() => setMenuOpen(false)}
        onExit={onExit}
      />
    </div>
  );
}
