import { normalizeRoomCode, randomRoomCode, randomToken } from "./protocol";
import { GuestSession, HostSession, hostRecordKey, type HostRecord, type KeyValueStore } from "./session";
import { createTransport } from "./transport";

// Browser glue for rooms: deciding whether this tab is the host or the guest
// of a room, and remembering enough to rejoin after a refresh or a closed tab.
//
// - The host's tab is marked in sessionStorage, so a refresh resumes hosting.
// - The host also saves the full game to localStorage every ~1.5 s. If the
//   host's tab was closed, reopening the link in the same browser resumes the
//   match from that save (a live host keeps the save fresh, so a second tab
//   opened while the host is running joins as the guest instead).
// - The guest keeps a per-room token in localStorage so it reclaims its seat.

const HOSTING_KEY = "rts:hosting";
const GUESTING_KEY = "rts:guesting";
const STALE_HOST_MS = 5000;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

function safeStore(storage: () => Storage): KeyValueStore {
  return {
    get: (k) => {
      try {
        return storage().getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        storage().setItem(k, v);
      } catch {
        // ignore
      }
    },
  };
}

const local = safeStore(() => window.localStorage);
const session = safeStore(() => window.sessionStorage);

export function inviteUrl(room: string): string {
  const url = new URL(window.location.href);
  url.search = `?room=${room}`;
  url.hash = "";
  return url.toString();
}

export function roomFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get("room");
  return raw ? normalizeRoomCode(raw) : null;
}

export function setUrlRoom(room: string | null) {
  const url = new URL(window.location.href);
  if (room) url.searchParams.set("room", room);
  else url.searchParams.delete("room");
  window.history.replaceState(null, "", url.toString());
}

function readHostRecord(room: string): HostRecord | null {
  const raw = local.get(hostRecordKey(room));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as HostRecord;
    return Date.now() - rec.savedAt < RECORD_TTL_MS ? rec : null;
  } catch {
    return null;
  }
}

function pruneOldRecords() {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith("rts:host:")) continue;
      const room = key.slice("rts:host:".length);
      if (!readHostRecord(room)) window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function createRoom(): HostSession {
  pruneOldRecords();
  const room = randomRoomCode();
  session.set(HOSTING_KEY, room);
  setUrlRoom(room);
  const host = new HostSession(room, createTransport(room), local);
  host.persist();
  return host;
}

export function openRoom(room: string): HostSession | GuestSession {
  pruneOldRecords();
  setUrlRoom(room);
  const record = readHostRecord(room);
  const thisTabHosts = session.get(HOSTING_KEY) === room;
  // A tab that joined as the guest never takes over hosting (matters when
  // testing both seats in one browser).
  const thisTabGuests = session.get(GUESTING_KEY) === room;
  const hostTabGone = record !== null && !thisTabGuests && Date.now() - record.savedAt > STALE_HOST_MS;
  if (record && (thisTabHosts || hostTabGone)) {
    session.set(HOSTING_KEY, room);
    return new HostSession(room, createTransport(room), local, record);
  }
  session.set(GUESTING_KEY, room);
  const tokenKey = `rts:guest:${room}`;
  let token = local.get(tokenKey);
  if (!token) {
    token = randomToken();
    local.set(tokenKey, token);
  }
  return new GuestSession(room, createTransport(room), token);
}

export function leaveRoom() {
  session.set(HOSTING_KEY, "");
  session.set(GUESTING_KEY, "");
  setUrlRoom(null);
}
