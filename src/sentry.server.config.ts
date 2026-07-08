// Node.js runtime GlitchTip init — imported from src/instrumentation.ts
// register(), which Next.js runs once per server boot.
import * as Sentry from "@sentry/nextjs";
import {
  glitchtipDsn,
  glitchtipEnabled,
  glitchtipEnvironment,
} from "@/lib/glitchtip";

Sentry.init({
  dsn: glitchtipDsn(),
  enabled: glitchtipEnabled(),
  environment: glitchtipEnvironment(),

  // Errors only — see src/instrumentation-client.ts for the rationale.
  tracesSampleRate: 0,
});
