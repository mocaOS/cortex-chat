import "server-only";

// In-process realtime bus. Deployment model is a single Node container
// (standalone output), so a module-level pub/sub is sufficient — no Redis,
// no WebSocket server. Multi-replica deployments would need a shared bus;
// that's explicitly out of scope.
//
// Channels:
//   chat:<sessionId>   — a specific chat changed (open-chat live updates)
//   project:<id>       — a project's chat list changed (sidebar freshness)
//   user:<id>          — something affecting this user (e.g. new share)
//   group:<id>         — something affecting a whole group (group grants)
//
// Stashed on globalThis so dev-mode HMR (which can re-instantiate modules
// per bundle) still shares one bus between publishers and subscriber routes.

export interface ChatEvent {
  // "changed" (default when absent): a settled write — refetch the session.
  // Live-turn relay (Phase B): "turn_start" carries the asker's question,
  // "token" streams answer fragments, "turn_done" closes the live view
  // (watchers then refetch the authoritative settled state).
  kind?: "changed" | "turn_start" | "token" | "turn_done";
  updatedAt: number;
  // Who caused the change — lets clients ignore their own echoes.
  by: string;
  byName?: string;
  question?: string;
  token?: string;
}

type Listener = (event: ChatEvent) => void;

const bus: Map<string, Set<Listener>> = ((
  globalThis as { __chatEventBus?: Map<string, Set<Listener>> }
).__chatEventBus ??= new Map());

export function subscribeChannel(channel: string, listener: Listener): () => void {
  let set = bus.get(channel);
  if (!set) {
    set = new Set();
    bus.set(channel, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.delete(channel);
  };
}

export function publishChannel(channel: string, event: ChatEvent): void {
  const set = bus.get(channel);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // one broken subscriber must never break the others
    }
  }
}

// Chat-scoped convenience wrappers (the open-chat live feed).
export function subscribeChatEvents(sessionId: string, listener: Listener) {
  return subscribeChannel(`chat:${sessionId}`, listener);
}

export function publishChatEvent(sessionId: string, event: ChatEvent): void {
  publishChannel(`chat:${sessionId}`, event);
}
