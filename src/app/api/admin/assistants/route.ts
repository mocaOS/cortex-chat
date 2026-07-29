import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { assistants } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { parseSoulFile, toAssistantSummary } from "@/lib/souls";
import { fetchSoulFromUrl } from "@/lib/soul-import";

export const dynamic = "force-dynamic";

const MAX_SOUL_CHARS = 64_000;

export async function GET() {
  let userId: string;
  try {
    userId = (await requireAdmin()).user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = db
    .select()
    .from(assistants)
    .orderBy(desc(assistants.createdAt))
    .all();
  return NextResponse.json({
    assistants: rows.map((a) => ({
      ...toAssistantSummary(a, userId),
      groupId: a.groupId,
      sourceUrl: a.sourceUrl,
      createdAt: a.createdAt,
    })),
  });
}

// Create an admin-curated soul, visible globally or to one group.
const Body = z
  .object({
    content: z.string().min(1).max(MAX_SOUL_CHARS).optional(),
    url: z.string().url().max(2000).optional(),
    scope: z.enum(["global", "group"]),
    groupId: z.string().min(1).optional(),
  })
  .refine((b) => !!b.content !== !!b.url, {
    message: "Provide either content or url",
  })
  .refine((b) => b.scope !== "group" || !!b.groupId, {
    message: "groupId is required for group scope",
  });

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireAdmin()).user.id;
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
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
    mode: soul.mode,
    collectionId: soul.collectionId,
    scope: parsed.data.scope,
    groupId: parsed.data.scope === "group" ? parsed.data.groupId! : null,
    userId: null,
    enabled: 1,
    sourceUrl,
    verifiedSigner,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.insert(assistants).values(row).run();

  return NextResponse.json({
    assistant: { ...toAssistantSummary(row, userId), groupId: row.groupId },
  });
}
