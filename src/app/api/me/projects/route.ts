import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import {
  listAccessibleProjects,
  listProjectChats,
  listProjectShares,
} from "@/lib/projects";
import { getUsableAssistant } from "@/lib/souls";

export const dynamic = "force-dynamic";

const MAX_PROJECTS = 50;

export async function GET() {
  const { user } = await requireAuth();
  const rows = listAccessibleProjects(user);
  return NextResponse.json({
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      instructions: p.instructions,
      assistantId: p.assistantId,
      collectionId: p.collectionId,
      isOwner: p.ownerId === user.id,
      // Share list only for the owner — members just see the project.
      shares: p.ownerId === user.id ? listProjectShares(p.id) : undefined,
      chats: listProjectChats(p.id, user.id),
      updatedAt: p.updatedAt,
    })),
  });
}

const Body = z.object({
  name: z.string().min(1).max(100),
  instructions: z.string().max(4000).optional(),
  assistantId: z.string().min(1).nullable().optional(),
  collectionId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  const { user } = await requireAuth();
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const owned = listAccessibleProjects(user).filter((p) => p.ownerId === user.id);
  if (owned.length >= MAX_PROJECTS) {
    return NextResponse.json(
      { error: `Project limit reached (${MAX_PROJECTS}).` },
      { status: 400 }
    );
  }

  // Only bind souls the creator can actually use.
  const assistantId = parsed.data.assistantId
    ? (getUsableAssistant(user, parsed.data.assistantId)?.id ?? null)
    : null;

  const now = Date.now();
  const row = {
    id: newId(),
    ownerId: user.id,
    name: parsed.data.name.trim(),
    instructions: parsed.data.instructions?.trim() ?? "",
    assistantId,
    collectionId: parsed.data.collectionId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(projects).values(row).run();

  return NextResponse.json({
    project: {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      assistantId: row.assistantId,
      collectionId: row.collectionId,
      isOwner: true,
      shares: [],
      chats: [],
      updatedAt: row.updatedAt,
    },
  });
}
