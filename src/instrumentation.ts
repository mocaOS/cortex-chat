export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { runMigrations } = await import("@/lib/db/migrate");
  const { bootstrapSuperadmin } = await import("@/lib/auth/superadmin-bootstrap");
  runMigrations();
  await bootstrapSuperadmin();
}
