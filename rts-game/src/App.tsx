import { useCallback, useEffect, useState } from "react";
import type { Difficulty } from "./game/ai";
import { createRoom, leaveRoom, openRoom, roomFromUrl } from "./net/rooms";
import { PracticeSession, type Session } from "./net/session";
import { GameScreen } from "./ui/GameScreen";
import { MainMenu } from "./ui/MainMenu";

export function App() {
  const [session, setSession] = useState<Session | null>(null);

  // An invitation link (?room=CODE) drops the player straight into the room.
  useEffect(() => {
    const room = roomFromUrl();
    if (!room) return;
    const s = openRoom(room).start();
    setSession(s);
    return () => s.dispose();
  }, []);

  const exit = useCallback(() => {
    setSession((s) => {
      s?.dispose();
      return null;
    });
    leaveRoom();
  }, []);

  if (session) return <GameScreen key={sessionKey(session)} session={session} onExit={exit} />;

  return (
    <MainMenu
      onPractice={(d: Difficulty) => setSession(new PracticeSession(d).start())}
      onHost={() => setSession(createRoom().start())}
      onJoin={(code) => setSession(openRoom(code).start())}
    />
  );
}

const keys = new WeakMap<Session, number>();
let nextKey = 1;
function sessionKey(s: Session) {
  let k = keys.get(s);
  if (!k) keys.set(s, (k = nextKey++));
  return k;
}
