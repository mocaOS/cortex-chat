import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings, groups, sessions, users } from "@/lib/db/schema";
import { getDemoConfig } from "@/lib/demo";
import { hashPassword } from "./password";
import { newId } from "./crypto";

const MARKER_KEY = "demoUserId";
// The demo user needs a group (chat is dead without a group key), but on a
// fresh install the default group is itself provisioned in the background
// (it needs the Cortex backend). Same spaced-retry approach, never blocks.
const GROUP_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000];
const GROUP_STEADY_RETRY_MS = 300_000;

// On each server start, upsert the demo user from env (mirrors the
// superadmin bootstrap: env is the single source of truth, the password is
// re-hashed every boot so the published credentials self-heal). With
// DEMO_MODE off, a previously provisioned demo user is disarmed: password
// set to the unusable "" sentinel and all its sessions evicted.
export async function bootstrapDemoUser(): Promise<void> {
  const cfg = getDemoConfig();

  if (!cfg) {
    disarmDemoUser();
    return;
  }

  const passwordHash = await hashPassword(cfg.password);
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, cfg.email))
    .get();

  let userId: string;
  if (existing) {
    if (existing.role !== "user") {
      console.error(
        `[bootstrap] DEMO_EMAIL ${cfg.email} belongs to an existing ${existing.role} account — refusing to repurpose it as the demo user. Pick a different DEMO_EMAIL.`
      );
      return;
    }
    userId = existing.id;
    db.update(users)
      .set({ passwordHash, updatedAt: Date.now() })
      .where(eq(users.id, userId))
      .run();
  } else {
    userId = newId();
    db.insert(users)
      .values({
        id: userId,
        email: cfg.email,
        passwordHash,
        username: "Demo",
        role: "user",
      })
      .run();
    console.log(`[bootstrap] Created demo user ${cfg.email}.`);
  }

  db.insert(appSettings)
    .values({ key: MARKER_KEY, value: userId, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: userId, updatedAt: Date.now() },
    })
    .run();

  ensureDemoGroup(userId, cfg.group, 0);
}

// DEMO_MODE was turned off: the published test@test.com/test credentials must
// stop working. "" is the existing unusable-password sentinel (verifyPassword
// fails closed on it — see the users.passwordHash schema comment).
function disarmDemoUser(): void {
  const marker = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, MARKER_KEY))
    .get();
  if (!marker) return;

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, marker.value))
    .get();
  if (user && user.role === "user") {
    db.update(users)
      .set({ passwordHash: "", updatedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();
    db.delete(sessions).where(eq(sessions.userId, user.id)).run();
    console.log(
      `[bootstrap] DEMO_MODE is off — disarmed demo user ${user.email} (password disabled, sessions evicted).`
    );
  }
  db.delete(appSettings).where(eq(appSettings.key, MARKER_KEY)).run();
}

// Group resolution, in order: DEMO_GROUP by name (re-pinned every boot when
// set), else the user's current group, else the first group ever created.
// No group in the DB yet (fresh install racing the default-group bootstrap)
// → retry in the background.
function ensureDemoGroup(
  userId: string,
  groupName: string | null,
  attemptNo: number
): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return;

  let targetGroupId: string | null = null;
  if (groupName) {
    const named = db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.name, groupName))
      .get();
    if (named) {
      targetGroupId = named.id;
    } else {
      console.warn(
        `[bootstrap] DEMO_GROUP "${groupName}" not found — falling back to the demo user's current/first group.`
      );
    }
  }
  if (!targetGroupId && user.groupId) return; // already grouped, nothing to do
  if (!targetGroupId) {
    const first = db
      .select({ id: groups.id })
      .from(groups)
      .orderBy(asc(groups.createdAt))
      .limit(1)
      .get();
    targetGroupId = first?.id ?? null;
  }

  if (!targetGroupId) {
    const delay =
      GROUP_RETRY_DELAYS_MS[attemptNo] ?? GROUP_STEADY_RETRY_MS;
    console.warn(
      `[bootstrap] No group exists yet for the demo user; retrying in ${Math.round(delay / 1000)}s.`
    );
    setTimeout(
      () => ensureDemoGroup(userId, groupName, attemptNo + 1),
      delay
    ).unref();
    return;
  }

  if (user.groupId !== targetGroupId) {
    db.update(users)
      .set({ groupId: targetGroupId, updatedAt: Date.now() })
      .where(eq(users.id, userId))
      .run();
    console.log(`[bootstrap] Assigned demo user to group ${targetGroupId}.`);
  }
}
