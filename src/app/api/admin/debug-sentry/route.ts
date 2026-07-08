import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Deliberately throws an unhandled error so an operator can verify the
// GlitchTip pipeline end-to-end after a deploy: capture via onRequestError,
// release/source-map resolution, and user context. Superadmin-only.
export async function GET() {
  try {
    await requireSuperadmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  throw new Error(
    "GlitchTip verification error from cortex-chat (deliberately thrown via /api/admin/debug-sentry)"
  );
}
