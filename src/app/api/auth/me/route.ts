import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groups, users } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth/session";
import { ensureDefaultGroup } from "@/lib/default-group-bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let { user } = ctx;

  // Self-heal: on a fresh deploy the boot-time bootstrap may not have reached
  // the Cortex backend yet. If the superadmin loads the app without a group,
  // try provisioning the default group now so this very response includes it.
  // Bounded so a slow backend can't stall login; failures fall through to the
  // normal "no group" response and the background retry loop.
  if (!user.groupId && user.role === "superadmin") {
    const provisioned = await Promise.race([
      ensureDefaultGroup().catch(() => false),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 8_000).unref()),
    ]);
    if (provisioned) {
      const fresh = db.select().from(users).where(eq(users.id, user.id)).get();
      if (fresh) user = fresh;
    }
  }

  const group = user.groupId
    ? db.select().from(groups).where(eq(groups.id, user.groupId)).get()
    : null;

  return NextResponse.json({
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarPath ? `/api/avatars/${user.id}` : null,
    role: user.role,
    group: group
      ? { id: group.id, name: group.name, description: group.description }
      : null,
    canUpload:
      user.role === "superadmin" ||
      user.role === "admin" ||
      !!user.contentKeyId,
  });
}
