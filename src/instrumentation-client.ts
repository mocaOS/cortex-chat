// Browser-side GlitchTip init. Next.js loads this file automatically before
// the app hydrates (and before any client code can throw).
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

  // Errors only. GlitchTip has no Replay/Profiling products, and we don't do
  // performance tracing — never add those integrations here.
  tracesSampleRate: 0,
});

// Required export for App Router navigation instrumentation (no-op while
// tracing is off, but silences the SDK warning and is ready if we ever
// enable performance monitoring).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
