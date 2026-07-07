import { t } from "@/lib/i18n";

// The backend returns 429 for two distinct conditions, told apart by the
// Retry-After horizon: the per-key burst limit (RATE_LIMIT_QPM, seconds) and
// the monthly unit quota (MAX_QUERIES_PER_MONTH, seconds until the next UTC
// month). Anything beyond a few hours can only be the quota.
const QUOTA_THRESHOLD_SECONDS = 6 * 60 * 60;

export function rateLimitMessage(retryAfterSeconds?: number | null): string {
  if (retryAfterSeconds == null) return t("rateLimitedNoTime");
  if (retryAfterSeconds > QUOTA_THRESHOLD_SECONDS) {
    const resetDate = new Date(Date.now() + retryAfterSeconds * 1000);
    return t("quotaExhausted", { date: resetDate.toLocaleDateString() });
  }
  return t("rateLimited", { seconds: Math.ceil(retryAfterSeconds) });
}
