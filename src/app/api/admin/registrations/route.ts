import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { registrations } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = db
    .select({
      id: registrations.id,
      email: registrations.email,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .orderBy(asc(registrations.createdAt))
    .all();

  return NextResponse.json({ registrations: rows });
}
