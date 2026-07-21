import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { passwordResetTokens } from "@/lib/db/schema";
import { newId } from "./crypto";

const TTL_MS = 60 * 60 * 1000; // 60 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Mints a fresh single-use token for the user, invalidating any prior unused
// ones. Returns the PLAINTEXT token — exposed only via the emailed link.
export function createResetToken(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  db.transaction((tx) => {
    tx.delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .run();
    tx.insert(passwordResetTokens)
      .values({ id: newId(), userId, tokenHash, expiresAt, createdAt: now })
      .run();
  });
  return { token, expiresAt };
}

// True if an unused, unexpired token was minted for this user within the resend
// cooldown — used to throttle repeated "forgot password" submissions.
export function hasRecentResetToken(userId: string): boolean {
  const now = Date.now();
  const row = db
    .select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.userId, userId),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.createdAt, now - RESEND_COOLDOWN_MS),
        gt(passwordResetTokens.expiresAt, now)
      )
    )
    .get();
  return !!row;
}

// Returns the token row id + userId for a valid (exists, unused, unexpired)
// token, else null. Does not mutate — the caller consumes it atomically.
export function findResetTokenUser(
  token: string
): { id: string; userId: string } | null {
  const tokenHash = hashResetToken(token);
  const row = db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      usedAt: passwordResetTokens.usedAt,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .get();
  if (!row) return null;
  if (row.usedAt !== null) return null;
  if (row.expiresAt < Date.now()) return null;
  return { id: row.id, userId: row.userId };
}
