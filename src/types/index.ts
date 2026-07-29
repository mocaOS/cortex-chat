export interface Source {
  document_id: string;
  chunk_id: string;
  content: string;
  score: number;
  // Conversation-stable source id, accumulated in the backend memory
  // source_ledger. Additive — lets a follow-up reference the same document
  // across turns. Rides inside the sources array, so it persists with the
  // message metadata and reloads automatically. Per-turn [src_N] numbering
  // and citation rendering are unchanged.
  sid?: string;
  metadata: {
    filename: string;
    chunk_index?: number;
    rerank_score?: number;
  };
}

/**
 * Structured pipeline status emitted by the backend on every mode.
 * `stage` is a stable machine key (analyzing | searching | reranking |
 * generating); `message` is human/i18n-friendly text to show directly.
 */
export interface StreamStatus {
  stage: string;
  message: string;
}

export interface GraphContext {
  entities: { name: string; type: string; description: string }[];
  relationships: {
    source: string;
    target: string;
    type: string;
    description: string;
  }[];
  communities?: { id: number; name: string; summary: string }[];
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  document_count: number;
}

export interface RetrievalStats {
  total_sources_considered: number;
  unique_sources: number;
  search_calls: number;
  communities_used: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  graphContext?: GraphContext;
  thinking?: string[];
  subQuestions?: string[];
  retrieval?: string[];
  retrievalStats?: RetrievalStats;
  status?: StreamStatus;
  // Thumbs rating the user gave this answer. Persisted in message metadata
  // (so it survives reload); the analytics event is written separately.
  feedback?: "up" | "down";
  isStreaming?: boolean;
}

export interface AskRequest {
  question: string;
  top_k?: number;
  use_graph?: boolean;
  use_reranking?: boolean;
  use_agentic?: boolean;
  conversation_history?: { role: "user" | "assistant"; content: string }[];
  collection_id?: string | null;
  // Soul (assistant persona) for this chat. Chat-app concept: the proxy
  // scope-checks it, injects the soul body server-side, and strips the field
  // before forwarding upstream.
  assistant_id?: string | null;
  // Opaque client-carried memory blob. Sent verbatim each turn, replaced from
  // the memory_update event — never constructed or mutated client-side.
  conversation_memory?: unknown;
}

export type Mode = "chat" | "deep-research";

export interface Settings {
  streaming: boolean;
  collectionId: string | null;
}

// A soul (assistant persona) as the client sees it. The soul file content is
// only included by endpoints that need it (export, admin editing).
export interface AssistantSummary {
  id: string;
  name: string;
  description: string;
  starters: string[];
  mode: "chat" | "deep-research" | null;
  collectionId: string | null;
  scope: "builtin" | "global" | "group" | "user";
  builtinKey: string | null;
  enabled: boolean;
  verifiedSigner: string | null;
  isOwn: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  // 0/1 from SQLite. Pinned chats sort above the time-grouped sidebar list.
  pinned?: number;
  // Soul this chat was started with (null = plain Cortex).
  assistantId?: string | null;
  messages?: ChatMessage[];
  // Opaque conversation memory blob, replayed as conversation_memory on the
  // next turn. Persisted server-side so it survives reload/device-switch.
  memory?: unknown;
  createdAt: number;
  updatedAt: number;
}
