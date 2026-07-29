import { NextResponse } from "next/server";
import { like, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { groups, users } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Minimal people/groups search backing the project share modal. Deliberately
// small surface: min 2 chars, max 8 hits per kind, names/emails only — this
// is a workplace tool, discoverability of colleagues is the feature.
export async function GET(request: Request) {
  const { user } = await requireAuth();
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ groups: [], users: [] });
  }
  const pattern = `%${q.replaceAll("%", "").replaceAll("_", "")}%`;

  const groupRows = db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(like(groups.name, pattern))
    .limit(8)
    .all();

  const userRows = db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(or(like(users.email, pattern), like(users.username, pattern)))
    .limit(8)
    .all()
    .filter((u) => u.id !== user.id); // sharing with yourself is a no-op

  return NextResponse.json({ groups: groupRows, users: userRows });
}
