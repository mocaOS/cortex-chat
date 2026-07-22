import "server-only";

// Self-registration feature gate. Default ON — disabled only when
// ENABLE_REGISTRATION is explicitly set to "false" or "0" (case-insensitive).
export function isRegistrationEnabled(): boolean {
  const raw = (process.env.ENABLE_REGISTRATION ?? "").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}
