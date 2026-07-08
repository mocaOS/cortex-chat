"use client";

// Last-resort error boundary: replaces the root layout when rendering crashes,
// so it must render its own <html>/<body> and cannot rely on globals.css.
// Colors below are the MOCA dark tokens from globals.css as literals.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "oklch(0.1448 0 0)",
          color: "oklch(0.9851 0 0)",
          fontFamily:
            "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "90%",
            padding: 32,
            borderRadius: 16,
            background: "oklch(0.2134 0 0)",
            border: "1px solid oklch(0.3407 0 0)",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 20, margin: "0 0 8px", letterSpacing: "-0.015em" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, margin: "0 0 24px", color: "oklch(0.7090 0 0)" }}>
            An unexpected error occurred. It has been reported automatically.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "oklch(0.9851 0 0)",
              color: "oklch(0.1448 0 0)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
