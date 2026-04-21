"use client";

import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

export default function Header({
  logoUrl,
  onToggleSidebar,
}: {
  logoUrl: string;
  onToggleSidebar: () => void;
}) {
  useLocale();
  return (
    <header
      className="flex items-center justify-between px-5 h-14 border-b"
      style={{
        background: "oklch(0.15 0 0 / 0.65)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="w-8 h-8 rounded-[var(--radius)] flex items-center justify-center text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          aria-label={t("toggleSidebar")}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <img src={logoUrl} alt="Logo" className="h-6 w-auto" />
      </div>
      <div />
    </header>
  );
}
