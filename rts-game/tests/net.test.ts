import { describe, expect, it } from "vitest";
import type { NetMessage } from "../src/net/protocol";
import { GuestSession, HostSession, hostRecordKey, type HostRecord, type KeyValueStore } from "../src/net/session";
import type { Transport, TransportStatus } from "../src/net/transport";

/** An in-memory room: every message reaches every other endpoint. */
class Hub {
  endpoints: MemTransport[] = [];
  queue: [MemTransport, NetMessage][] = [];
  join() {
    const t = new MemTransport(this);
    this.endpoints.push(t);
    return t;
  }
  flush() {
    while (this.queue.length) {
      const [from, msg] = this.queue.shift()!;
      for (const t of this.endpoints) if (t !== from && !t.closed) t.deliver(structuredClone(msg));
    }
  }
}

class MemTransport implements Transport {
  readonly kind = "local-tabs" as const;
  closed = false;
  private handlers: ((m: NetMessage) => void)[] = [];
  constructor(private hub: Hub) {}
  send(msg: NetMessage) {
    if (!this.closed) this.hub.queue.push([this, msg]);
  }
  deliver(m: NetMessage) {
    for (const h of this.handlers) h(m);
  }
  onMessage(fn: (m: NetMessage) => void) {
    this.handlers.push(fn);
  }
  onStatus(fn: (s: TransportStatus) => void) {
    fn("open");
  }
  close() {
    this.closed = true;
  }
}

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

/** Advance both sessions by `ms` of wall-clock time in small steps. */
function run(hub: Hub, sessions: (HostSession | GuestSession)[], from: number, ms: number): number {
  let t = from;
  for (; t < from + ms; t += 16) {
    for (const s of sessions) s.pump(t);
    hub.flush();
  }
  return t;
}

describe("host/guest sessions", () => {
  it("starts when the guest joins and mirrors the host's state", () => {
    const hub = new Hub();
    const host = new HostSession("ROOM1", hub.join(), null);
    let t = run(hub, [host], 0, 500);
    expect(host.info(t).conn).toBe("waiting");

    const guest = new GuestSession("ROOM1", hub.join(), "guest-token");
    t = run(hub, [host, guest], t, 1500);
    expect(host.info(t).conn).toBe("connected");
    expect(guest.info(t).conn).toBe("connected");
    expect(host.state.time).toBeGreaterThan(0.5);
    expect(Math.abs(guest.state.time - host.state.time)).toBeLessThan(0.2);
  });

  it("applies guest commands to the guest's own (player 1) squads only", () => {
    const hub = new Hub();
    const host = new HostSession("ROOM2", hub.join(), null);
    const guest = new GuestSession("ROOM2", hub.join(), "g");
    const t = run(hub, [host, guest], 0, 1500);
    const mine = host.state.squads.filter((s) => s.owner === 1).map((s) => s.id);
    const theirs = host.state.squads.filter((s) => s.owner === 0).map((s) => s.id);
    // A spoofed player id must not let the guest control the host's units.
    guest.issue({ type: "move", player: 0, ids: [...mine, ...theirs], x: 30, y: 20 });
    run(hub, [host, guest], t, 200);
    for (const s of host.state.squads) expect(s.order.kind).toBe(s.owner === 1 ? "move" : "idle");
  });

  it("pauses when the guest goes silent and resumes when it returns", () => {
    const hub = new Hub();
    const host = new HostSession("ROOM3", hub.join(), null);
    let guest = new GuestSession("ROOM3", hub.join(), "g");
    let t = run(hub, [host, guest], 0, 1500);
    guest.dispose(); // tab closed without saying goodbye
    t = run(hub, [host], t, 5000);
    expect(host.info(t).conn).toBe("opponent-left");
    const frozen = host.state.time;
    t = run(hub, [host], t, 1000);
    expect(host.state.time).toBe(frozen);

    guest = new GuestSession("ROOM3", hub.join(), "g"); // same token: reclaims the seat
    t = run(hub, [host, guest], t, 2000);
    expect(host.info(t).conn).toBe("connected");
    expect(guest.info(t).conn).toBe("connected");
    expect(host.state.time).toBeGreaterThan(frozen);
  });

  it("turns away a third player", () => {
    const hub = new Hub();
    const host = new HostSession("ROOM4", hub.join(), null);
    const guest = new GuestSession("ROOM4", hub.join(), "g1");
    const intruder = new GuestSession("ROOM4", hub.join(), "g2");
    const t = run(hub, [host, guest, intruder], 0, 2500);
    expect(guest.info(t).conn).toBe("connected");
    expect(intruder.info(t).conn).toBe("full");
  });

  it("a restarted host resumes the saved match and re-admits the guest", () => {
    const hub = new Hub();
    const store = memStore();
    const host = new HostSession("ROOM5", hub.join(), store);
    const guest = new GuestSession("ROOM5", hub.join(), "g");
    let t = run(hub, [host, guest], 0, 4000);
    host.dispose(); // persists and closes
    const saved = JSON.parse(store.get(hostRecordKey("ROOM5"))!) as HostRecord;
    expect(saved.guestToken).toBe("g");
    const savedTime = saved.state.time;
    t = run(hub, [guest], t, 5000);
    expect(guest.info(t).conn).toBe("host-left");

    const host2 = new HostSession("ROOM5", hub.join(), store, saved);
    t = run(hub, [host2, guest], t, 2500);
    expect(host2.info(t).conn).toBe("connected");
    expect(guest.info(t).conn).toBe("connected");
    expect(host2.state.time).toBeGreaterThan(savedTime + 1);
  });
});
