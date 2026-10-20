import { MAX_QUEUE, POP_CAP, REINFORCE_RANGE, START_TICKETS, STRUCTURES, UNITS } from "../game/constants";
import { distanceTo, income, population } from "../game/sim";
import type { GameState, PlayerId, Squad, Structure, UnitType } from "../game/types";
import type { Controller } from "../input/controller";
import type { SessionInfo } from "../net/session";
import { TEAM } from "../render/theme";

export interface HudActions {
  recruit(unit: UnitType, structureId?: number): void;
  build(): void;
  stop(): void;
  reinforce(): void;
  cancel(structureId: number, index: number): void;
  select(ids: number[]): void;
  focus(ids: number[]): void;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------------------------------------------------------------------------

export function TopBar({ state, me, info, onMenu }: { state: GameState; me: PlayerId; info: SessionInfo; onMenu(): void }) {
  const p = state.players[me];
  const enemy: PlayerId = me === 0 ? 1 : 0;
  return (
    <div className="topbar">
      <div className="res">
        <Stat label="Manpower" value={Math.floor(p.manpower)} sub={`+${income(state, me).toFixed(1)}/s`} icon="👥" />
        <Stat label="Squads" value={`${population(state, me)}/${POP_CAP}`} icon="⚑" />
      </div>
      <div className="tickets">
        <TicketBar player={me} value={state.players[me].tickets} label="You" />
        <div className="flags" aria-label="Capture points">
          {state.points.map((pt) => (
            <span
              key={pt.id}
              className="flag-pip"
              title={`Point ${"ABC"[pt.id]}: ${pt.owner === null ? "neutral" : pt.owner === me ? "yours" : "enemy"}`}
              style={{ background: pt.owner === null ? "#cfc8ad" : TEAM[pt.owner].main }}
            >
              {"ABC"[pt.id]}
            </span>
          ))}
        </div>
        <TicketBar player={enemy} value={state.players[enemy].tickets} label="Enemy" right />
      </div>
      <div className="res right">
        <span className="mode-tag">
          {info.mode === "practice" ? "Practice" : `Room ${info.room}`}
          {info.mode !== "practice" && <ConnDot info={info} />}
        </span>
        <span className="clock">{fmtTime(state.time)}</span>
        <button className="btn small" onClick={onMenu} title="Menu (Esc)">
          Menu
        </button>
      </div>
    </div>
  );
}

function ConnDot({ info }: { info: SessionInfo }) {
  const ok = info.conn === "connected" && info.transportStatus === "open";
  const label = ok ? "Connected" : info.transportStatus !== "open" ? "Server connection lost" : "Opponent not connected";
  return <span className={`conn-dot ${ok ? "ok" : "bad"}`} title={label} aria-label={label} />;
}

function Stat({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: string }) {
  return (
    <div className="stat" title={label}>
      <span className="stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function TicketBar({ player, value, label, right }: { player: PlayerId; value: number; label: string; right?: boolean }) {
  const frac = Math.max(0, value / START_TICKETS);
  return (
    <div className={`ticket ${right ? "right" : ""}`} title={`${label}: ${Math.ceil(value)} victory points`}>
      <span className="ticket-label">{label}</span>
      <div className="ticket-track">
        <div className="ticket-fill" style={{ width: `${frac * 100}%`, background: TEAM[player].main }} />
      </div>
      <span className="ticket-num">{Math.ceil(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PanelProps {
  state: GameState;
  me: PlayerId;
  controller: Controller;
  actions: HudActions;
}

function selection(state: GameState, controller: Controller) {
  const squads = state.squads.filter((s) => controller.selected.has(s.id));
  const structure = state.structures.find((s) => controller.selected.has(s.id)) ?? null;
  return { squads, structure };
}

export function SelectionPanel({ state, me, controller, actions }: PanelProps) {
  const { squads, structure } = selection(state, controller);
  if (structure) return <StructureInfo s={structure} me={me} actions={actions} />;
  if (squads.length === 0) {
    const mine = state.squads.filter((s) => s.owner === me);
    return (
      <div className="panel selection">
        <div className="panel-title">No selection</div>
        <p className="muted small">
          Drag a box around your squads or click one. Right-click to move or attack. You have {mine.length} squad
          {mine.length === 1 ? "" : "s"} in the field.
        </p>
      </div>
    );
  }
  if (squads.length === 1) return <SquadInfo sq={squads[0]!} me={me} />;
  return (
    <div className="panel selection">
      <div className="panel-title">{squads.length} squads selected</div>
      <div className="cards">
        {squads.map((sq) => (
          <button key={sq.id} className="card" onClick={() => actions.focus([sq.id])} title={`${UNITS[sq.type].name} — click to select`}>
            <UnitIcon type={sq.type} owner={sq.owner} />
            <HpBar frac={hpFrac(sq)} />
            <span className="card-models">
              {sq.models.length}/{UNITS[sq.type].models}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const hpFrac = (sq: Squad) => sq.models.reduce((n, m) => n + m.hp, 0) / (UNITS[sq.type].models * UNITS[sq.type].modelHp);

function SquadInfo({ sq, me }: { sq: Squad; me: PlayerId }) {
  const stats = UNITS[sq.type];
  const status =
    sq.firingAt !== null
      ? "Engaging"
      : sq.order.kind === "move"
        ? "Moving"
        : sq.order.kind === "attack"
          ? "Closing in"
          : sq.type === "machinegun" && sq.stationaryFor < stats.setupTime
            ? "Setting up"
            : "Holding";
  return (
    <div className="panel selection">
      <div className="panel-title">
        <UnitIcon type={sq.type} owner={sq.owner} />
        {stats.name} {sq.owner !== me && <span className="enemy-tag">Enemy</span>}
      </div>
      <HpBar frac={hpFrac(sq)} wide />
      <dl className="facts">
        <div>
          <dt>Soldiers</dt>
          <dd>
            {sq.models.length}/{stats.models}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
        {sq.owner === me && (
          <div>
            <dt>Cover</dt>
            <dd className={`cover-${sq.cover}`}>{sq.cover === "none" ? "In the open" : sq.cover === "heavy" ? "Heavy cover" : "Light cover"}</dd>
          </div>
        )}
        <div>
          <dt>Range</dt>
          <dd>{stats.range}</dd>
        </div>
      </dl>
      {sq.type === "machinegun" && <p className="muted small">Must stop and set up before firing; long range, deadly suppressing fire.</p>}
    </div>
  );
}

function StructureInfo({ s, me, actions }: { s: Structure; me: PlayerId; actions: HudActions }) {
  const stats = STRUCTURES[s.kind];
  return (
    <div className="panel selection">
      <div className="panel-title">
        {stats.name} {s.owner !== me && <span className="enemy-tag">Enemy</span>}
      </div>
      <HpBar frac={s.hp / s.maxHp} wide />
      <div className="muted small">
        {Math.ceil(s.hp)} / {s.maxHp} HP{s.built < 1 ? ` · under construction ${Math.floor(s.built * 100)}%` : ""}
      </div>
      {s.owner === me && (
        <div className="queue" aria-label="Production queue">
          {Array.from({ length: MAX_QUEUE }, (_, i) => {
            const item = s.queue[i];
            if (!item) return <div key={i} className="queue-slot empty" />;
            return (
              <button
                key={i}
                className="queue-slot"
                onClick={() => actions.cancel(s.id, i)}
                title={`${UNITS[item.unit].name} — click to cancel (refund ${UNITS[item.unit].cost})`}
              >
                <UnitIcon type={item.unit} owner={me} />
                {i === 0 && <div className="queue-progress" style={{ width: `${(1 - item.remaining / item.total) * 100}%` }} />}
              </button>
            );
          })}
        </div>
      )}
      {s.owner === me && <p className="muted small">Right-click the map to set a rally point.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CommandPanel({ state, me, controller, actions }: PanelProps) {
  const mp = state.players[me].manpower;
  const pop = population(state, me);
  const mySquads = controller.selectedSquads();
  const sel = controller.selectedStructure();
  const hq = state.structures.find((s) => s.owner === me && s.kind === "hq");
  const barracks = state.structures.find((s) => s.owner === me && s.kind === "barracks");
  const barracksReady = !!barracks && barracks.built >= 1;

  const recruitBtn = (unit: UnitType, from: Structure | undefined, hotkey: string) => {
    const stats = UNITS[unit];
    const why = !from
      ? unit === "machinegun"
        ? barracks
          ? "Barracks under construction"
          : "Requires a Barracks"
        : "No headquarters"
      : from.queue.length >= MAX_QUEUE
        ? "Queue full"
        : pop >= POP_CAP
          ? "Squad limit reached"
          : mp < stats.cost
            ? "Not enough manpower"
            : null;
    return (
      <ActionButton
        key={unit}
        label={`Recruit ${stats.name}`}
        hotkey={hotkey}
        cost={stats.cost}
        disabled={why}
        onClick={() => actions.recruit(unit, from?.id)}
        icon={<UnitIcon type={unit} owner={me} />}
      />
    );
  };

  const buildBtn = (
    <ActionButton
      label="Build Barracks"
      hotkey="B"
      cost={STRUCTURES.barracks.cost}
      disabled={barracks ? "Already built" : mp < STRUCTURES.barracks.cost ? "Not enough manpower" : null}
      onClick={actions.build}
      icon={<span className="glyph">🏚</span>}
    />
  );

  let buttons: React.ReactNode;
  if (mySquads.length > 0) {
    const missing = mySquads.reduce((n, s) => n + (UNITS[s.type].models - s.models.length), 0);
    const nearBase = mySquads.some((sq) =>
      state.structures.some((st) => st.owner === me && st.built >= 1 && distanceTo(sq.pos, st) <= REINFORCE_RANGE),
    );
    const cost = mySquads.reduce((n, s) => n + (UNITS[s.type].models - s.models.length) * UNITS[s.type].reinforceCost, 0);
    buttons = (
      <>
        <ActionButton label="Stop" hotkey="S" onClick={actions.stop} icon={<span className="glyph">■</span>} />
        <ActionButton
          label="Reinforce"
          hotkey="E"
          cost={missing > 0 ? cost : undefined}
          disabled={missing === 0 ? "Squads at full strength" : !nearBase ? "Move near your HQ or Barracks" : mp < Math.min(...mySquads.map((s) => UNITS[s.type].reinforceCost)) ? "Not enough manpower" : null}
          onClick={actions.reinforce}
          icon={<span className="glyph">✚</span>}
        />
      </>
    );
  } else if (sel && sel.owner === me) {
    buttons =
      sel.kind === "hq" ? (
        <>
          {recruitBtn("riflemen", sel, "R")}
          {buildBtn}
        </>
      ) : (
        <>
          {recruitBtn("riflemen", barracksReady ? sel : undefined, "R")}
          {recruitBtn("machinegun", barracksReady ? sel : undefined, "M")}
        </>
      );
  } else {
    buttons = (
      <>
        {recruitBtn("riflemen", hq, "R")}
        {recruitBtn("machinegun", barracksReady ? barracks : undefined, "M")}
        {buildBtn}
      </>
    );
  }

  return (
    <div className="panel commands">
      <div className="panel-title">Orders</div>
      <div className="action-grid">{buttons}</div>
    </div>
  );
}

function ActionButton({
  label,
  hotkey,
  cost,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  hotkey: string;
  cost?: number;
  disabled?: string | null;
  onClick(): void;
  icon: React.ReactNode;
}) {
  return (
    <button className="action" onClick={onClick} disabled={!!disabled} title={disabled ? `${label} — ${disabled}` : `${label} (${hotkey})`}>
      <span className="action-icon">{icon}</span>
      <span className="action-label">{label}</span>
      <span className="action-meta">
        {cost !== undefined && <span className="cost">👥 {cost}</span>}
        <kbd>{hotkey}</kbd>
      </span>
      {disabled && <span className="action-why">{disabled}</span>}
    </button>
  );
}

function HpBar({ frac, wide }: { frac: number; wide?: boolean }) {
  return (
    <div className={`hp ${wide ? "wide" : ""}`} role="meter" aria-valuenow={Math.round(frac * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Health">
      <div className="hp-fill" style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: frac > 0.35 ? "#7fc25f" : "#e04a3a" }} />
    </div>
  );
}

export function UnitIcon({ type, owner }: { type: UnitType; owner: PlayerId }) {
  const c = TEAM[owner];
  const dots = type === "riflemen" ? [[11, 6], [6, 12], [16, 12], [11, 17]] : [[8, 8], [15, 9], [11, 16]];
  return (
    <svg className="unit-icon" viewBox="0 0 22 22" width="22" height="22" aria-hidden>
      <rect x="0.5" y="0.5" width="21" height="21" rx="4" fill="#20261a" stroke={c.main} />
      {type === "machinegun" && <line x1="8" y1="8" x2="19" y2="4" stroke="#ddd" strokeWidth="1.6" />}
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill={c.main} stroke={c.dark} strokeWidth="1" />
      ))}
    </svg>
  );
}
