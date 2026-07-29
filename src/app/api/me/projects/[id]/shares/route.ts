import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { groups, projects, projectShares, users } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { listProjectShares } from "@/lib/projects";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const MAX_SHARES = 50;

// Replace the full share list (the modal edits chips, then saves the set).
// Each entry grants either a whole group or a single user.
const Body = z.object({
  shares: z
    .array(
      z
        .object({
          groupId: z.string().min(1).optional(),
          userId: z.string().min(1).optional(),
        })
        .refine((s) => !!s.groupId !== !!s.userId, {
          message: "Each share is either a group or a user",
        })
    )
    .max(MAX_SHARES),
});

export async function PUT(request: Request, ctx: Ctx) {
  const { user } = await requireAuth();
  const { id } = await ctx.params;
  const project = db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.id)))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Validate referenced ids exist (dedup first).
  const groupIds = [
    ...new Set(parsed.data.shares.flatMap((s) => (s.groupId ? [s.groupId] : []))),
  ];
  const userIds = [
    ...new Set(parsed.data.shares.flatMap((s) => (s.userId ? [s.userId] : []))),
  ];
  const validGroups = groupIds.length
    ? new Set(
        db
          .select({ id: groups.id })
          .from(groups)
          .where(inArray(groups.id, groupIds))
          .all()
          .map((g) => g.id)
      )
    : new Set<string>();
  const validUsers = userIds.length
    ? new Set(
        db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, userIds))
          .all()
          .map((u) => u.id)
      )
    : new Set<string>();

  const now = Date.now();
  db.transaction((tx) => {
    tx.delete(projectShares).where(eq(projectShares.projectId, id)).run();
    for (const gid of groupIds) {
      if (!validGroups.has(gid)) continue;
      tx.insert(projectShares)
        .values({ id: newId(), projectId: id, groupId: gid, createdAt: now })
        .run();
    }
    for (const uid of userIds) {
      if (!validUsers.has(uid) || uid === user.id) continue; // owner is implicit
      tx.insert(projectShares)
        .values({ id: newId(), projectId: id, userId: uid, createdAt: now })
        .run();
    }
    tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, id)).run();
  });

  return NextResponse.json({ shares: listProjectShares(id) });
}
