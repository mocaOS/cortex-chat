import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assistants, type Assistant, type User } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import { BUILTIN_SOULS } from "@/lib/builtin-souls";

export interface ParsedSoul {
  name: string | null;
  description: string;
  starters: string[];
  mode: "chat" | "deep-research" | null;
  collectionId: string | null;
  // The persona text that gets injected — the file minus its frontmatter.
  body: string;
}

const MAX_STARTERS = 4;

/**
 * Parse a SOUL.md file: optional YAML-ish frontmatter (only the flat keys we
 * define — name, description, mode, collection, and a dash-list `starters:`)
 * followed by the persona body. Deliberately hand-rolled: no YAML dependency,
 * unknown keys are ignored, and a file without frontmatter is just a body.
 */
export function parseSoulFile(content: string): ParsedSoul {
  const result: ParsedSoul = {
    name: null,
    description: "",
    starters: [],
    mode: null,
    collectionId: null,
    body: content.trim(),
  };

  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    result.body = content.slice(fm[0].length).trim();
    const lines = fm[1].split(/\r?\n/);
    let inStarters = false;
    for (const line of lines) {
      const item = line.match(/^\s*-\s+(.*)$/);
      if (inStarters && item) {
        if (result.starters.length < MAX_STARTERS) {
          const v = item[1].trim().replace(/^["']|["']$/g, "");
          if (v) result.starters.push(v);
        }
        continue;
      }
      inStarters = false;
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const value = kv[2].trim().replace(/^["']|["']$/g, "");
      if (key === "starters") {
        inStarters = true;
      } else if (key === "name" && value) {
        result.name = value.slice(0, 80);
      } else if (key === "description") {
        result.description = value.slice(0, 300);
      } else if (key === "mode") {
        if (value === "chat" || value === "deep-research") result.mode = value;
      } else if (key === "collection" && value) {
        result.collectionId = value.slice(0, 100);
      }
    }
  }

  // Fallback name: first markdown heading in the body.
  if (!result.name) {
    const h = result.body.match(/^#\s+(.+)$/m);
    if (h) result.name = h[1].replace(/^SOUL\.md\s*[—-]\s*/i, "").trim().slice(0, 80);
  }

  return result;
}

/** Client-facing shape (no soul content — export/edit endpoints add it). */
export function toAssistantSummary(a: Assistant, userId: string) {
  let starters: string[] = [];
  try {
    const parsed = JSON.parse(a.starters);
    if (Array.isArray(parsed)) starters = parsed.filter((s) => typeof s === "string");
  } catch {}
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    starters,
    mode: a.mode,
    collectionId: a.collectionId,
    scope: a.scope,
    builtinKey: a.builtinKey,
    enabled: !!a.enabled,
    verifiedSigner: a.verifiedSigner,
    isOwn: a.scope === "user" && a.userId === userId,
  };
}

/** Every soul the user may see/use: enabled builtins + global + their group's + their own. */
export function listVisibleAssistants(user: User): Assistant[] {
  return db
    .select()
    .from(assistants)
    .where(
      and(
        eq(assistants.enabled, 1),
        or(
          inArray(assistants.scope, ["builtin", "global"]),
          user.groupId
            ? and(eq(assistants.scope, "group"), eq(assistants.groupId, user.groupId))
            : and(eq(assistants.scope, "group"), isNull(assistants.groupId)), // never matches
          and(eq(assistants.scope, "user"), eq(assistants.userId, user.id))
        )
      )
    )
    .all();
}

/** Scope check used by the stream route before injecting a soul. */
export function getUsableAssistant(user: User, id: string): Assistant | null {
  const a = db.select().from(assistants).where(eq(assistants.id, id)).get();
  if (!a || !a.enabled) return null;
  if (a.scope === "builtin" || a.scope === "global") return a;
  if (a.scope === "group") return a.groupId === user.groupId ? a : null;
  return a.userId === user.id ? a : null;
}

/**
 * Seed repo-shipped souls. Insert-if-missing by builtinKey ONLY — existing
 * rows are never updated or re-enabled, so an admin's "remove" (enabled=0)
 * sticks across restarts while new releases can still add new souls.
 */
export function seedBuiltinSouls(): void {
  for (const entry of BUILTIN_SOULS) {
    const existing = db
      .select({ id: assistants.id })
      .from(assistants)
      .where(eq(assistants.builtinKey, entry.key))
      .get();
    if (existing) continue;
    const parsed = parseSoulFile(entry.content);
    db.insert(assistants)
      .values({
        id: newId(),
        builtinKey: entry.key,
        name: parsed.name ?? entry.key,
        description: parsed.description,
        soul: entry.content,
        starters: JSON.stringify(parsed.starters),
        mode: parsed.mode,
        collectionId: parsed.collectionId,
        scope: "builtin",
        enabled: 1,
      })
      .run();
  }
}
