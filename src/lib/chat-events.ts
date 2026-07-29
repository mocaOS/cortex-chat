import "server-only";

// In-process realtime bus for multi-user project chats. Deployment model is
// a single Node container (standalone output), so a module-level pub/sub is
// sufficient — no Redis, no WebSocket server. Multi-replica deployments
// would need a shared bus; that's explicitly out of scope.
//
// Stashed on globalThis so dev-mode HMR (which can re-instantiate modules
// per bundle) still shares one bus between the PATCH publisher and the SSE
// subscriber route.

export interface ChatEvent {
  updatedAt: number;
  // Who caused the change — lets clients ignore their own echoes.
  by: string;
}

type Listener = (event: ChatEvent) => void;

const bus: Map<string, Set<Listener>> = ((
  globalThis as { __chatEventBus?: Map<string, Set<Listener>> }
).__chatEventBus ??= new Map());

export function subscribeChatEvents(
  sessionId: string,
  listener: Listener
): () => void {
  let set = bus.get(sessionId);
  if (!set) {
    set = new Set();
    bus.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) bus.delete(sessionId);
  };
}

export function publishChatEvent(sessionId: string, event: ChatEvent): void {
  const set = bus.get(sessionId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      // one broken subscriber must never break the others
    }
  }
}
