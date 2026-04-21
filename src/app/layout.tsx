import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask AI",
  description: "AI-powered knowledge assistant",
};

function readEnv(key: string): string | undefined {
  return process.env[key];
}

// Resolve the accent server-side and inject it as an inline CSS variable so
// the first paint of any page (notably /login) already has the correct value.
// /api/config still overrides it client-side for cases where the env differs.
function resolveAccent(): string {
  return (
    readEnv("ACCENT_COLOR") ||
    readEnv("NEXT_PUBLIC_ACCENT_COLOR") ||
    "#ff9500"
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const accent = resolveAccent();
  return (
    <html lang="en" style={{ ["--accent" as string]: accent }}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
