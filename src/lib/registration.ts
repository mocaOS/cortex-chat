import "server-only";
import { isOidcOnly } from "./auth/oidc";

// Self-registration feature gate. Default ON — disabled only when
// ENABLE_REGISTRATION is explicitly set to "false" or "0" (case-insensitive).
// OIDC_ONLY also disables it: accounts then come from the IdP (JIT), not a
// local signup form. The admin Registrations tab keeps working for leftover
// pending rows either way.
export function isRegistrationEnabled(): boolean {
  if (isOidcOnly()) return false;
  const raw = (process.env.ENABLE_REGISTRATION ?? "").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}
