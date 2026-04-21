import "server-only";

// Thin wrappers over the library-backend admin API. All requests use the
// master admin-tier key from env (BACKEND_ADMIN_API_KEY) — never a user key.

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.LIBRARY_API_URL ||
    "http://localhost:8000"
  );
}

function adminKey(): string {
  const k = process.env.BACKEND_ADMIN_API_KEY;
  if (!k) {
    throw new Error(
      "BACKEND_ADMIN_API_KEY is required to perform admin operations against the library-backend."
    );
  }
  return k;
}

async function call<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": adminKey(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BackendError(
      `Library backend ${init?.method ?? "GET"} ${path} -> ${res.status}: ${body.slice(0, 400)}`,
      res.status
    );
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export class BackendError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "BackendError";
  }
}

// --- Collections ------------------------------------------------------------

export interface BackendCollection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
}

export async function listBackendCollections(): Promise<BackendCollection[]> {
  const data = await call<{ collections?: BackendCollection[] } | BackendCollection[]>(
    "/api/collections"
  );
  if (Array.isArray(data)) return data;
  return data.collections ?? [];
}

// --- API Keys --------------------------------------------------------------

export type BackendPermission = "read" | "manage" | "admin";

export interface BackendKeyCreateInput {
  permission: BackendPermission;
  collection_ids?: string[]; // omitted / empty = all collections
  label?: string;
  name?: string;
}

export interface BackendKeyCreateResult {
  id: string;
  key: string; // the plaintext secret — only returned once at creation
  permission: BackendPermission;
  collection_ids?: string[];
}

export async function createBackendKey(
  input: BackendKeyCreateInput
): Promise<BackendKeyCreateResult> {
  // Backend schema: permissions is a plural array; collection_ids omitted = all.
  const body: Record<string, unknown> = {
    permissions: [input.permission],
    name: input.name ?? input.label ?? `cortex-chat-${input.permission}`,
  };
  if (input.collection_ids && input.collection_ids.length > 0) {
    body.collection_ids = input.collection_ids;
  }
  return call<BackendKeyCreateResult>("/api/admin/api-keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateBackendKey(
  id: string,
  patch: { collection_ids?: string[]; label?: string; name?: string }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.collection_ids !== undefined) body.collection_ids = patch.collection_ids;
  if (patch.name !== undefined) body.name = patch.name;
  await call(`/api/admin/api-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteBackendKey(id: string): Promise<void> {
  await call(`/api/admin/api-keys/${id}`, { method: "DELETE" });
}

// --- Usage ------------------------------------------------------------------

export interface BackendUsageRow {
  key_id?: string;
  date?: string;
  count?: number;
  endpoint?: string;
  [k: string]: unknown;
}

export async function fetchBackendUsage(): Promise<BackendUsageRow[]> {
  try {
    const data = await call<{ usage?: BackendUsageRow[] } | BackendUsageRow[]>(
      "/api/admin/api-usage"
    );
    if (Array.isArray(data)) return data;
    return data.usage ?? [];
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return [];
    throw err;
  }
}
