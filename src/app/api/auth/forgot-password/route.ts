import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { isEmailConfigured } from "@/lib/email/config";
import { createResetToken, hasRecentResetToken } from "@/lib/auth/reset-token";
import { sendPasswordResetEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  // Enumeration-safe: always return 200, regardless of input or existence.
  if (parsed.success) {
    const email = parsed.data.email.trim().toLowerCase();
    try {
      if (isEmailConfigured()) {
        const user = db.select().from(users).where(eq(users.email, email)).get();
        // Skip the superadmin (env-managed password) and throttle resends.
        if (user && user.role !== "superadmin" && !hasRecentResetToken(user.id)) {
          const { token } = createResetToken(user.id);
          await sendPasswordResetEmail({
            to: user.email,
            userName: user.username || user.email,
            token,
          });
        }
      }
    } catch (err) {
      // Never surface failures to the caller (would break enumeration-safety
      // and leak SMTP issues). Report server-side for the operator.
      Sentry.captureException(err);
    }
  }
  return NextResponse.json({ ok: true });
}
