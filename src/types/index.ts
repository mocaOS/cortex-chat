export interface Source {
  document_id: string;
  chunk_id: string;
  content: string;
  score: number;
  metadata: {
    filename: string;
    chunk_index?: number;
    rerank_score?: number;
  };
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
}

export type Mode = "chat" | "deep-research";

export interface Settings {
  streaming: boolean;
  collectionId: string | null;
}

export interface ChatSession {
  id: string;
  title: string;
  messages?: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
