import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask AI",
  description: "AI-powered knowledge assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
