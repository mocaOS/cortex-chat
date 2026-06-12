import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiKeys, appSettings, groups, users } from "@/lib/db/schema";
import { encryptSecret, newId } from "@/lib/auth/crypto";
import { createBackendKey, deleteBackendKey } from "@/lib/backend";

const MARKER_KEY = "defaultGroupProvisioned";
const GROUP_NAME = "Default";
// Spaced retries cover the docker-compose race where the Cortex backend
// comes up after this app does.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000];

// On the first boot of a fresh instance, create a "Default" group with access
// to all collections and place the superadmin in it, so chat works out of the
// box without a manual trip through /admin/groups. Runs in the background —
// never blocks boot, never throws. The app_settings marker guarantees this
// happens at most once per database: existing deployments (any group already
// present) are adopted as-is, and an admin deleting or reshaping the group
// later won't see a restart resurrect it.
export function bootstrapDefaultGroup(): void {
  void attempt(0);
}

async function attempt(attemptNo: number): Promise<void> {
  try {
    if (alreadyProvisioned()) return;

    const backendKey = await createBackendKey({
      permission: "read",
      collection_ids: [], // empty = all collections
      label: `group:${GROUP_NAME}`,
      name: `cortex-chat group:${GROUP_NAME}`,
    });
    try {
      provision(backendKey.id, backendKey.key);
    } catch (err) {
      // Don't leak a minted backend key if the local insert fails.
      await deleteBackendKey(backendKey.id).catch(() => {});
      throw err;
    }
    console.log(
      `[bootstrap] Created default group "${GROUP_NAME}" (all collections) and assigned the superadmin to it.`
    );
  } catch (err) {
    scheduleRetry(attemptNo, err);
  }
}

function alreadyProvisioned(): boolean {
  const marker = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, MARKER_KEY))
    .get();
  if (marker) return true;

  // Pre-existing deployment upgrading to this version: adopt its groups
  // as the admin's deliberate configuration and never auto-create.
  if (db.select({ id: groups.id }).from(groups).limit(1).get()) {
    db.insert(appSettings)
      .values({ key: MARKER_KEY, value: "1", updatedAt: Date.now() })
      .onConflictDoNothing()
      .run();
    return true;
  }
  return false;
}

function provision(backendKeyId: string, plaintextKey: string): void {
  const keyId = newId();
  const groupId = newId();
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(apiKeys)
      .values({
        id: keyId,
        backendKeyId,
        encryptedValue: encryptSecret(plaintextKey),
        permission: "read",
        collectionIds: "[]",
        label: `group:${GROUP_NAME}`,
      })
      .run();
    tx.insert(groups)
      .values({
        id: groupId,
        name: GROUP_NAME,
        description:
          "Created automatically on first start. Has access to all collections.",
        chatKeyId: keyId,
      })
      .run();
    tx.update(users)
      .set({ groupId, updatedAt: now })
      .where(and(eq(users.role, "superadmin"), isNull(users.groupId)))
      .run();
    tx.insert(appSettings)
      .values({ key: MARKER_KEY, value: "1", updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: "1", updatedAt: now },
      })
      .run();
  });
}

function scheduleRetry(attemptNo: number, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  const delay = RETRY_DELAYS_MS[attemptNo];
  if (delay === undefined) {
    console.warn(
      `[bootstrap] Giving up on default group creation after ${RETRY_DELAYS_MS.length + 1} attempts: ${detail}\n` +
        "[bootstrap] Create a group manually in /admin/groups, or restart once the Cortex backend is reachable."
    );
    return;
  }
  console.warn(
    `[bootstrap] Default group not created yet (${detail}); retrying in ${Math.round(delay / 1000)}s.`
  );
  setTimeout(() => void attempt(attemptNo + 1), delay).unref();
}
