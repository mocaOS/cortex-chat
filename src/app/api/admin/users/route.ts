import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { groups, users } from "@/lib/db/schema";
import { requireSuperadmin } from "@/lib/auth/session";
import { newId } from "@/lib/auth/crypto";
import { hashPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      groupId: users.groupId,
      groupName: groups.name,
      contentKeyId: users.contentKeyId,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .leftJoin(groups, eq(users.groupId, groups.id))
    .orderBy(asc(users.email))
    .all();

  return NextResponse.json({ users: rows });
}

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  username: z.string().max(80).optional(),
  groupId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 }
    );
  }
  const email = parsed.data.email.trim().toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists." },
      { status: 409 }
    );
  }

  const id = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  db.insert(users)
    .values({
      id,
      email,
      passwordHash,
      username: parsed.data.username ?? "",
      role: "user",
      groupId: parsed.data.groupId ?? null,
    })
    .run();

  return NextResponse.json({
    id,
    email,
    username: parsed.data.username ?? "",
    groupId: parsed.data.groupId ?? null,
  });
}
