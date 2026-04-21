import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/session";
import { listBackendCollections } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const collections = await listBackendCollections();
    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend error" },
      { status: 502 }
    );
  }
}
