"use client";

import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import { getCachedConfig } from "@/lib/config";

export default function Header({
  logoUrl,
  onToggleSidebar,
}: {
  logoUrl: string;
  onToggleSidebar: () => void;
}) {
  useLocale();
  // Support link is seeded server-side via ConfigBootstrap, so it's present
  // on first paint. Empty URL → no button. Empty label → localized fallback.
  const cfg = getCachedConfig();
  const supportUrl = cfg?.supportUrl?.trim() || "";
  const supportLabel = cfg?.supportLabel?.trim() || t("support");
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
      <div className="flex items-center">
        {supportUrl ? (
          <a
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={supportLabel}
            className="group relative w-9 h-9 rounded-[var(--radius)] flex items-center justify-center text-[var(--accent)] hover:text-white hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            {/* Instant CSS tooltip — native title attribute has a browser hover delay */}
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1 text-[13px] opacity-0 group-hover:opacity-100 transition-opacity duration-100"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
                color: "var(--fg1)",
                boxShadow: "var(--shadow-xl)",
              }}
            >
              {supportLabel}
            </span>
          </a>
        ) : null}
      </div>
    </header>
  );
}
