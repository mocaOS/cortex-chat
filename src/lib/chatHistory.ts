import { ChatMessage, ChatSession } from "@/types";
import * as local from "./demoChatStore";

const BASE = "/api/me/chats";

// Storage dispatch: the shared demo account keeps its chats in the visitor's
// browser (localStorage, see demoChatStore.ts) instead of the server. page.tsx
// sets the mode right after /api/auth/me resolves — unconditionally, because
// login/logout are client-side navigations and a stale "local" must never
// leak into a real user's session in the same tab. Every consumer call site
// runs after that fetch, so a plain module flag is race-free.
let useLocalStore = false;

export function setChatStorageMode(mode: "server" | "local"): void {
  useLocalStore = mode === "local";
}

async function http<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Chat API error: ${res.status}`);
  }
  return res.json();
}

export async function listChats(): Promise<ChatSession[]> {
  if (useLocalStore) return local.listChats();
  const data = await http<{ sessions: ChatSession[] }>(BASE);
  return data?.sessions ?? [];
}

export async function getChat(id: string): Promise<ChatSession | null> {
  if (useLocalStore) return local.getChat(id);
  return http<ChatSession>(`${BASE}/${id}`);
}

export async function createChat(
  id?: string,
  title?: string,
  assistantId?: string | null,
  projectId?: string | null
): Promise<ChatSession> {
  if (useLocalStore) return local.createChat(id, title, assistantId, projectId);
  const data = await http<ChatSession>(BASE, {
    method: "POST",
    body: JSON.stringify({
      id,
      title,
      ...(assistantId ? { assistantId } : {}),
      ...(projectId ? { projectId } : {}),
    }),
  });
  if (!data) throw new Error("Failed to create chat");
  return data;
}

export function updateChatMessages(
  id: string,
  messages: ChatMessage[],
  memory?: unknown
): Promise<void> {
  if (useLocalStore) return local.updateChatMessages(id, messages, memory);
  // Only include memory when we actually have one, so we never clobber a stored
  // blob with null on a turn that produced no memory_update.
  const body =
    memory !== undefined ? { messages, memory } : { messages };
  return http(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then(() => undefined);
}

export function setChatProject(
  id: string,
  projectId: string | null
): Promise<void> {
  if (useLocalStore) return local.setChatProject(id, projectId);
  return http(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ projectId }),
  }).then(() => undefined);
}

export function setChatPinned(id: string, pinned: boolean): Promise<void> {
  if (useLocalStore) return local.setChatPinned(id, pinned);
  return http(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  }).then(() => undefined);
}

export function updateChatTitle(id: string, title: string): Promise<void> {
  if (useLocalStore) return local.updateChatTitle(id, title);
  return http(`${BASE}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }).then(() => undefined);
}

export function deleteChat(id: string): Promise<void> {
  if (useLocalStore) return local.deleteChat(id);
  return http(`${BASE}/${id}`, { method: "DELETE" }).then(() => undefined);
}
