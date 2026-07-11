import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { readAvatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ userId: string }>;
}

// Avatars are user-facing (Sidebar, admin tables) so we don't gate on role,
// but we still validate the session here. The edge middleware only checks that
// the session cookie is *present*, not that it's valid, so it is not
// authentication — every route must re-validate via getAuth().
export async function GET(_: Request, ctx: Ctx) {
  const auth = await getAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = await ctx.params;
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row?.avatarPath) {
    return NextResponse.json({ error: "No avatar" }, { status: 404 });
  }
  const data = readAvatar(row.avatarPath);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(data.buffer), {
    headers: {
      "Content-Type": data.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=60",
    },
  });
}
