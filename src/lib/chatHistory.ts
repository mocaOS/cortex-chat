import { ChatSession, ChatMessage } from "@/types";

const STORAGE_KEY = "chat_sessions";

function loadAll(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(sessions: ChatSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function getSessions(): ChatSession[] {
  return loadAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSession | undefined {
  return loadAll().find((s) => s.id === id);
}

export function createSession(id: string): ChatSession {
  const session: ChatSession = {
    id,
    title: "",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const all = loadAll();
  all.push(session);
  saveAll(all);
  return session;
}

export function updateSessionMessages(id: string, messages: ChatMessage[]) {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return;
  all[idx].messages = messages;
  all[idx].updatedAt = Date.now();
  saveAll(all);
}

export function updateSessionTitle(id: string, title: string) {
  const all = loadAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return;
  all[idx].title = title;
  all[idx].updatedAt = Date.now();
  saveAll(all);
}

export function deleteSession(id: string) {
  const all = loadAll().filter((s) => s.id !== id);
  saveAll(all);
}
