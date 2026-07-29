import { ProjectInfo, ProjectShareEntry } from "@/types";

const BASE = "/api/me/projects";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed: ${res.status}`
    );
  }
  return data as T;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const data = await http<{ projects: ProjectInfo[] }>(BASE);
  return data.projects;
}

export async function createProject(input: {
  name: string;
  instructions?: string;
  assistantId?: string | null;
  collectionId?: string | null;
}): Promise<ProjectInfo> {
  const data = await http<{ project: ProjectInfo }>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.project;
}

export async function updateProject(
  id: string,
  patch: {
    name?: string;
    instructions?: string;
    assistantId?: string | null;
    collectionId?: string | null;
  }
): Promise<void> {
  await http(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteProject(id: string): Promise<void> {
  await http(`${BASE}/${id}`, { method: "DELETE" });
}

export async function putProjectShares(
  id: string,
  shares: { groupId?: string; userId?: string }[]
): Promise<ProjectShareEntry[]> {
  const data = await http<{ shares: ProjectShareEntry[] }>(
    `${BASE}/${id}/shares`,
    { method: "PUT", body: JSON.stringify({ shares }) }
  );
  return data.shares;
}

export interface DirectoryResult {
  groups: { id: string; name: string }[];
  users: { id: string; email: string; username: string }[];
}

export async function searchDirectory(q: string): Promise<DirectoryResult> {
  return http<DirectoryResult>(`/api/me/directory?q=${encodeURIComponent(q)}`);
}

export async function duplicateChat(id: string): Promise<string> {
  const data = await http<{ id: string }>(`/api/me/chats/${id}/duplicate`, {
    method: "POST",
  });
  return data.id;
}
