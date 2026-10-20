import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { NetMessage } from "./protocol";

export type TransportStatus = "connecting" | "open" | "reconnecting" | "error";

/** A best-effort broadcast pipe shared by everyone in one room. */
export interface Transport {
  readonly kind: "supabase" | "local-tabs";
  send(msg: NetMessage): void;
  onMessage(fn: (msg: NetMessage) => void): void;
  onStatus(fn: (status: TransportStatus, detail?: string) => void): void;
  close(): void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client: SupabaseClient | null = null;

/**
 * Supabase Realtime "broadcast" channel: low-latency pub/sub with no database
 * tables involved. realtime-js reconnects the socket and rejoins the channel
 * on its own after network drops; we surface that as a status.
 */
class SupabaseTransport implements Transport {
  readonly kind = "supabase";
  private channel: RealtimeChannel;
  private handlers: ((m: NetMessage) => void)[] = [];
  private statusHandlers: ((s: TransportStatus, d?: string) => void)[] = [];
  private everOpen = false;
  private queue: NetMessage[] = [];
  private open = false;

  constructor(room: string) {
    client ??= createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      realtime: { params: { eventsPerSecond: 40 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.channel = client.channel(`rts-room-${room}`, { config: { broadcast: { self: false, ack: false } } });
    this.channel.on("broadcast", { event: "m" }, ({ payload }) => {
      for (const h of this.handlers) h(payload as NetMessage);
    });
    this.channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        this.open = true;
        this.everOpen = true;
        this.emit("open");
        const pending = this.queue;
        this.queue = [];
        for (const m of pending) this.send(m);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.open = false;
        this.emit(this.everOpen ? "reconnecting" : "error", err?.message ?? status);
      } else if (status === "CLOSED") {
        this.open = false;
      }
    });
  }

  private emit(s: TransportStatus, d?: string) {
    for (const h of this.statusHandlers) h(s, d);
  }

  send(msg: NetMessage) {
    if (!this.open) {
      // Keep only control messages while connecting; snapshots go stale anyway.
      if (msg.t !== "snap") this.queue.push(msg);
      return;
    }
    void this.channel.send({ type: "broadcast", event: "m", payload: msg });
  }
  onMessage(fn: (m: NetMessage) => void) {
    this.handlers.push(fn);
  }
  onStatus(fn: (s: TransportStatus, d?: string) => void) {
    this.statusHandlers.push(fn);
    fn(this.open ? "open" : "connecting");
  }
  close() {
    void client?.removeChannel(this.channel);
  }
}

/**
 * Same-browser transport over BroadcastChannel. Used when Supabase is not
 * configured so multiplayer can still be exercised with two tabs locally.
 */
class LocalTabsTransport implements Transport {
  readonly kind = "local-tabs";
  private bc: BroadcastChannel;
  constructor(room: string) {
    this.bc = new BroadcastChannel(`rts-room-${room}`);
  }
  send(msg: NetMessage) {
    this.bc.postMessage(msg);
  }
  onMessage(fn: (m: NetMessage) => void) {
    this.bc.addEventListener("message", (e) => fn(e.data as NetMessage));
  }
  onStatus(fn: (s: TransportStatus) => void) {
    fn("open");
  }
  close() {
    this.bc.close();
  }
}

export function createTransport(room: string): Transport {
  return supabaseConfigured ? new SupabaseTransport(room) : new LocalTabsTransport(room);
}
