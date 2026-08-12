import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { assistants } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { forbidDemo } from "@/lib/auth/demo-guard";
import { newId } from "@/lib/auth/crypto";
import {
  listVisibleAssistants,
  parseSoulFile,
  toAssistantSummary,
} from "@/lib/souls";
import { fetchSoulFromUrl } from "@/lib/soul-import";

export const dynamic = "force-dynamic";

const MAX_SOUL_CHARS = 64_000;
const MAX_PERSONAL_SOULS = 20;

export async function GET() {
  const { user } = await requireAuth();
  const rows = listVisibleAssistants(user);
  return NextResponse.json({
    assistants: rows.map((a) => toAssistantSummary(a, user.id)),
  });
}

// Create a personal soul: either paste/upload content directly, or import
// from a URL (soulweaver public souls API — EIP-191-verified when signed —
// or any URL serving raw SOUL.md).
const Body = z
  .object({
    content: z.string().min(1).max(MAX_SOUL_CHARS).optional(),
    url: z.string().url().max(2000).optional(),
  })
  .refine((b) => !!b.content !== !!b.url, {
    message: "Provide either content or url",
  });

export async function POST(request: Request) {
  const { user } = await requireAuth();
  // Shared demo account: its 20 personal-soul slots would be one global pool
  // for all visitors, and the URL import is server-side fetch (SSRF surface).
  const blocked = forbidDemo(user);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const own = listVisibleAssistants(user).filter(
    (a) => a.scope === "user" && a.userId === user.id
  );
  if (own.length >= MAX_PERSONAL_SOULS) {
    return NextResponse.json(
      { error: `Personal soul limit reached (${MAX_PERSONAL_SOULS}).` },
      { status: 400 }
    );
  }

  let content = parsed.data.content ?? "";
  let sourceUrl: string | null = null;
  let verifiedSigner: string | null = null;

  if (parsed.data.url) {
    try {
      const imported = await fetchSoulFromUrl(parsed.data.url);
      content = imported.content;
      sourceUrl = imported.sourceUrl;
      verifiedSigner = imported.verifiedSigner;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Import failed" },
        { status: 400 }
      );
    }
    if (content.length > MAX_SOUL_CHARS) {
      return NextResponse.json({ error: "Soul file too large" }, { status: 400 });
    }
  }

  const soul = parseSoulFile(content);
  if (!soul.body) {
    return NextResponse.json(
      { error: "The soul file has no persona content" },
      { status: 400 }
    );
  }

  const row = {
    id: newId(),
    builtinKey: null,
    name: soul.name ?? "Unnamed soul",
    description: soul.description,
    soul: content,
    starters: JSON.stringify(soul.starters),
    collectionId: soul.collectionId,
    scope: "user" as const,
    userId: user.id,
    enabled: 1,
    sourceUrl,
    verifiedSigner,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.insert(assistants).values(row).run();

  return NextResponse.json({
    assistant: toAssistantSummary({ ...row, groupId: null }, user.id),
  });
}
