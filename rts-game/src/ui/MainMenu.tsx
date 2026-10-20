import { useState } from "react";
import type { Difficulty } from "../game/ai";
import { normalizeRoomCode } from "../net/protocol";
import { supabaseConfigured } from "../net/transport";
import { Controls } from "./Controls";

interface Props {
  onPractice(d: Difficulty): void;
  onHost(): void;
  onJoin(code: string): void;
}

export function MainMenu({ onPractice, onHost, onJoin }: Props) {
  const [code, setCode] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const valid = normalizeRoomCode(code);

  return (
    <div className="menu">
      <div className="menu-card">
        <header className="menu-title">
          <h1>Frontline</h1>
          <p>Squad tactics on a WWII battlefield. Take the high ground, hold the line.</p>
        </header>

        <section className="menu-section">
          <h2>Practice</h2>
          <p className="muted">Play against the computer to learn the ropes.</p>
          <div className="row">
            <div className="segmented" role="radiogroup" aria-label="AI difficulty">
              {(["easy", "normal"] as const).map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={difficulty === d}
                  className={difficulty === d ? "active" : ""}
                  onClick={() => setDifficulty(d)}
                >
                  {d === "easy" ? "Easy" : "Normal"}
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={() => onPractice(difficulty)}>
              Start practice
            </button>
          </div>
        </section>

        <section className="menu-section">
          <h2>Play online (1v1)</h2>
          <p className="muted">
            {supabaseConfigured
              ? "Create a room and send the invitation link to a friend. No account needed."
              : "Online server not configured: rooms work between tabs of this browser only (see README)."}
          </p>
          <div className="row">
            <button className="btn primary" onClick={onHost}>
              Create room
            </button>
            <form
              className="join"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) onJoin(valid);
              }}
            >
              <input
                aria-label="Room code"
                placeholder="Room code"
                value={code}
                maxLength={12}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button className="btn" type="submit" disabled={!valid}>
                Join
              </button>
            </form>
          </div>
        </section>

        <section className="menu-section">
          <h2>How to win</h2>
          <p className="muted">
            Capture and hold the three flags. Holding more flags than the enemy drains their victory points to zero,
            and flags also boost your manpower income. Or destroy the enemy headquarters.
          </p>
          <Controls />
        </section>
      </div>
      <footer className="menu-footer">Original graphics, all drawn in code. Not affiliated with any game publisher.</footer>
    </div>
  );
}
