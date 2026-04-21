export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("@/lib/db/migrate");
  const { bootstrapSuperadmin } = await import("@/lib/auth/superadmin-bootstrap");
  runMigrations();
  await bootstrapSuperadmin();
}
