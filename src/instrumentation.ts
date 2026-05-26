export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Back-compat: LIBRARY_API_URL was renamed to CORTEX_API_URL. If a deployment
  // only sets the deprecated name, mirror it onto the new one so the rest of
  // the codebase can read CORTEX_API_URL exclusively.
  if (!process.env.CORTEX_API_URL && process.env.LIBRARY_API_URL) {
    process.env.CORTEX_API_URL = process.env.LIBRARY_API_URL;
    console.warn(
      "[env] LIBRARY_API_URL is deprecated; please rename to CORTEX_API_URL."
    );
  }

  const { runMigrations } = await import("@/lib/db/migrate");
  const { bootstrapSuperadmin } = await import("@/lib/auth/superadmin-bootstrap");
  runMigrations();
  await bootstrapSuperadmin();
}
