import "server-only";
import { NextResponse } from "next/server";
import { isDemoUser } from "@/lib/demo";

// Route-level lockdown for the shared demo account. The demo user is a
// normal role:user row that any visitor signs into, so every per-user
// mutation (password, profile, personal souls, projects, …) must reject it —
// otherwise one visitor could break or poison the account for everyone.
// Returns a 403 response to short-circuit with, or null to proceed.
// Lives outside demo.ts so instrumentation.ts never imports next/server.
export function forbidDemo(user: { email: string }): NextResponse | null {
  if (!isDemoUser(user)) return null;
  return NextResponse.json(
    { error: "Not available in demo mode" },
    { status: 403 }
  );
}
