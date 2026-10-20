import { useState } from "react";
import type { GameState } from "../game/types";
import { inviteUrl } from "../net/rooms";
import { HostSession, PracticeSession, type Session, type SessionInfo } from "../net/session";
import { Controls } from "./Controls";

interface Props {
  session: Session;
  info: SessionInfo;
  state: GameState;
  menuOpen: boolean;
  onCloseMenu(): void;
  onExit(): void;
}

export function Overlays({ session, info, state, menuOpen, onCloseMenu, onExit }: Props) {
  const me = info.localPlayer;

  // Game over takes priority over everything else.
  if (state.winner !== null) {
    const won = state.winner === me;
    const reason =
      state.winReason === "hq"
        ? won
          ? "The enemy headquarters has been destroyed."
          : "Your headquarters has been destroyed."
        : state.winReason === "tickets"
          ? won
            ? "The enemy's victory points ran out."
            : "Your victory points ran out."
          : won
            ? "Your opponent withdrew from the battle."
            : "You withdrew from the battle.";
    const canRematch = session instanceof PracticeSession || session instanceof HostSession;
    return (
      <Modal title={won ? "Victory" : "Defeat"} tone={won ? "good" : "bad"}>
        <p>{reason}</p>
        <p className="muted small">Battle lasted {Math.floor(state.time / 60)} min {Math.floor(state.time % 60)} s.</p>
        <div className="row">
          {canRematch && (
            <button className="btn primary" onClick={() => (session as PracticeSession | HostSession).restartMatch()}>
              {session instanceof HostSession ? "Rematch" : "Play again"}
            </button>
          )}
          {!canRematch && <span className="muted small">The host can start a rematch.</span>}
          <button className="btn" onClick={onExit}>
            Main menu
          </button>
        </div>
      </Modal>
    );
  }

  if (info.conn === "waiting" && info.mode === "host") {
    return <Lobby info={info} onExit={onExit} />;
  }
  if (info.conn === "connecting" || (info.conn === "waiting" && info.mode === "guest")) {
    return (
      <Modal title="Joining battle">
        <p>
          Connecting to room <strong className="code">{info.room}</strong>…
        </p>
        <p className="muted small">
          {info.transportStatus === "error"
            ? `Could not reach the game server (${info.transportDetail ?? "unknown error"}). Retrying…`
            : "Waiting for the host to respond. Make sure the host still has the game open."}
        </p>
        <div className="row">
          <button className="btn" onClick={onExit}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }
  if (info.conn === "full") {
    return (
      <Modal title="Room is full" tone="bad">
        <p>
          Room <strong className="code">{info.room}</strong> already has two players.
        </p>
        <div className="row">
          <button className="btn primary" onClick={onExit}>
            Main menu
          </button>
        </div>
      </Modal>
    );
  }

  const banner =
    info.transportStatus === "reconnecting" || info.transportStatus === "error" ? (
      <div className="banner">Connection to the game server lost — reconnecting…</div>
    ) : null;

  if (info.conn === "opponent-left" || info.conn === "host-left") {
    const secs = Math.floor(info.disconnectedMs / 1000);
    const canClaim = session instanceof HostSession && secs >= 30;
    return (
      <>
        {banner}
        <Modal title="Opponent disconnected">
          <p>
            The game is paused while {info.conn === "host-left" ? "the host" : "your opponent"} reconnects
            {secs > 0 ? ` (${secs} s)` : ""}.
          </p>
          <p className="muted small">
            {info.conn === "host-left"
              ? "The host's browser runs the battle. It resumes automatically when they return."
              : "They can rejoin with the same invitation link. You may claim victory after 30 seconds."}
          </p>
          <div className="row">
            {session instanceof HostSession && (
              <button className="btn primary" disabled={!canClaim} onClick={() => session.claimVictory(performance.now())}>
                Claim victory
              </button>
            )}
            <button className="btn" onClick={onExit}>
              Leave
            </button>
          </div>
        </Modal>
      </>
    );
  }

  if (menuOpen) {
    return (
      <Modal title={session instanceof PracticeSession ? "Paused" : "Menu"}>
        <div className="row">
          <button className="btn primary" onClick={onCloseMenu}>
            Resume
          </button>
          <button
            className="btn danger"
            onClick={() => {
              session.issue({ type: "forfeit", player: me });
              onCloseMenu();
            }}
          >
            Surrender
          </button>
          <button className="btn" onClick={onExit}>
            Leave to menu
          </button>
        </div>
        {info.mode !== "practice" && <InviteBox room={info.room!} />}
        <h3>Controls</h3>
        <Controls />
      </Modal>
    );
  }
  return banner;
}

function Lobby({ info, onExit }: { info: SessionInfo; onExit(): void }) {
  return (
    <Modal title="Waiting for an opponent">
      <p>Share this invitation. The battle starts as soon as your opponent joins.</p>
      <InviteBox room={info.room!} />
      <p className="muted small">
        {info.transport === "local-tabs"
          ? "Local test mode (no Supabase configured): open the link in another tab of this browser."
          : info.transportStatus === "open"
            ? "Connected to the game server."
            : info.transportStatus === "error"
              ? `Cannot reach the game server: ${info.transportDetail ?? "unknown error"}`
              : "Connecting to the game server…"}
      </p>
      <div className="row">
        <button className="btn" onClick={onExit}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function InviteBox({ room }: { room: string }) {
  const url = inviteUrl(room);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (text: string, what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="invite">
      <div className="invite-row">
        <span className="muted small">Room code</span>
        <strong className="code big">{room}</strong>
        <button className="btn small" onClick={() => copy(room, "code")}>
          {copied === "code" ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="invite-row">
        <input readOnly value={url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn small primary" onClick={() => copy(url, "link")}>
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function Modal({ title, tone, children }: { title: string; tone?: "good" | "bad"; children: React.ReactNode }) {
  return (
    <div className="overlay">
      <div className={`modal ${tone ?? ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
