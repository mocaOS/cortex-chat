import { ChatMessage, ChatSession } from "@/types";

// localStorage-backed chat persistence for demo mode. Mirrors the semantics
// of the /api/me/chats routes exactly (see chatHistory.ts, which dispatches
// here when the signed-in user is the shared demo account):
//   - listChats: personal chats only, ordered pinned desc → updatedAt desc
//   - getChat: null for unknown ids (drives the deep-link URL cleanup)
//   - updateChatMessages: full replace; memory === undefined leaves the
//     stored blob untouched; bumps updatedAt
//   - setChatPinned / setChatProject: organizational — no updatedAt bump
// All functions are async to keep the chatHistory signatures drop-in.
//
// Storage layout (bump the version prefix on breaking shape changes):
//   cortexDemo.v1.index      → IndexEntry[] (sidebar summary rows)
//   cortexDemo.v1.chat.<id>  → full ChatSession incl. messages + memory

const PREFIX = "cortexDemo.v1.";
const INDEX_KEY = `${PREFIX}index`;
const chatKey = (id: string) => `${PREFIX}chat.${id}`;

// Public demos accumulate chats forever otherwise; ~5MB of localStorage also
// fills up fast with sources/graph metadata. Oldest unpinned chats are
// evicted first, pinned ones only when nothing else is left.
const MAX_DEMO_CHATS = 30;

interface IndexEntry {
  id: string;
  title: string;
  pinned: number;
  assistantId: string | null;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
}

// Safari private mode (and some embedded webviews) throw on any setItem.
// Fall back to an in-memory Map — demo chats then last for the tab session,
// which is acceptable for a demo.
const memoryStore = new Map<string, string>();
const storageAvailable = (() => {
  try {
    // Client modules are still evaluated during SSR — no window there.
    if (typeof window === "undefined") return false;
    const probe = `${PREFIX}probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

function read(key: string): string | null {
  if (!storageAvailable) return memoryStore.get(key) ?? null;
  return window.localStorage.getItem(key);
}

function remove(key: string): void {
  if (!storageAvailable) {
    memoryStore.delete(key);
    return;
  }
  window.localStorage.removeItem(key);
}

// Write with quota pressure-relief: on QuotaExceededError evict the oldest
// unpinned chat (never the one being written) and retry until it fits or
// nothing evictable remains.
function write(key: string, value: string, protectId?: string): void {
  if (!storageAvailable) {
    memoryStore.set(key, value);
    return;
  }
  for (;;) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      if (!evictOne(protectId)) throw new Error("Demo chat storage is full");
    }
  }
}

function loadIndex(): IndexEntry[] {
  try {
    const raw = read(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

function saveIndex(index: IndexEntry[], protectId?: string): void {
  write(INDEX_KEY, JSON.stringify(index), protectId);
}

// Eviction order: oldest unpinned by updatedAt, then oldest pinned.
function evictOne(protectId?: string): boolean {
  const index = loadIndex();
  const candidates = index
    .filter((e) => e.id !== protectId)
    .sort((a, b) => a.pinned - b.pinned || a.updatedAt - b.updatedAt);
  const victim = candidates[0];
  if (!victim) return false;
  remove(chatKey(victim.id));
  if (storageAvailable) {
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.filter((e) => e.id !== victim.id))
    );
  } else {
    memoryStore.set(
      INDEX_KEY,
      JSON.stringify(index.filter((e) => e.id !== victim.id))
    );
  }
  return true;
}

function upsertIndexEntry(entry: IndexEntry): void {
  const index = loadIndex().filter((e) => e.id !== entry.id);
  index.push(entry);
  saveIndex(index, entry.id);
}

function loadChat(id: string): ChatSession | null {
  try {
    const raw = read(chatKey(id));
    return raw ? (JSON.parse(raw) as ChatSession) : null;
  } catch {
    return null;
  }
}

function saveChat(session: ChatSession): void {
  write(chatKey(session.id), JSON.stringify(session), session.id);
  upsertIndexEntry({
    id: session.id,
    title: session.title,
    pinned: session.pinned ?? 0,
    assistantId: session.assistantId ?? null,
    projectId: session.projectId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

export async function listChats(): Promise<ChatSession[]> {
  return loadIndex()
    .filter((e) => e.projectId == null)
    .sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt)
    .map((e) => ({
      id: e.id,
      title: e.title,
      pinned: e.pinned,
      assistantId: e.assistantId,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
}

export async function getChat(id: string): Promise<ChatSession | null> {
  return loadChat(id);
}

export async function createChat(
  id?: string,
  title?: string,
  assistantId?: string | null,
  projectId?: string | null
): Promise<ChatSession> {
  // Demo chats are always personal — there are no demo projects, and the
  // server would downgrade an inaccessible projectId to null the same way.
  void projectId;
  const now = Date.now();
  const session: ChatSession = {
    id: id || crypto.randomUUID(),
    title: title || "",
    pinned: 0,
    assistantId: assistantId ?? null,
    projectId: null,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  // Enforce the cap before adding one more.
  while (loadIndex().length >= MAX_DEMO_CHATS) {
    if (!evictOne(session.id)) break;
  }
  saveChat(session);
  return session;
}

export async function updateChatMessages(
  id: string,
  messages: ChatMessage[],
  memory?: unknown
): Promise<void> {
  const session = loadChat(id);
  if (!session) return; // mirrors the server 404 → resolved-null semantics
  // Strip transient flags the server would drop too.
  session.messages = messages.map(({ isStreaming, ...m }) => {
    void isStreaming;
    return m as ChatMessage;
  });
  if (memory !== undefined) session.memory = memory;
  session.updatedAt = Date.now();
  saveChat(session);
}

export async function setChatProject(
  id: string,
  projectId: string | null
): Promise<void> {
  // No projects in demo mode; accept and ignore like the server's downgrade.
  void id;
  void projectId;
}

export async function setChatPinned(
  id: string,
  pinned: boolean
): Promise<void> {
  const session = loadChat(id);
  if (!session) return;
  session.pinned = pinned ? 1 : 0; // organizational — no updatedAt bump
  saveChat(session);
}

export async function updateChatTitle(
  id: string,
  title: string
): Promise<void> {
  const session = loadChat(id);
  if (!session) return;
  session.title = title;
  session.updatedAt = Date.now();
  saveChat(session);
}

export async function deleteChat(id: string): Promise<void> {
  remove(chatKey(id));
  saveIndex(loadIndex().filter((e) => e.id !== id));
}
