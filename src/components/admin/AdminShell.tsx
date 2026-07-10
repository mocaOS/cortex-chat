"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t, type TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

interface Props {
  user: { id: string; email: string; username: string };
  children: React.ReactNode;
}

const NAV: { href: string; labelKey: TranslationKey }[] = [
  { href: "/admin", labelKey: "adminNavOverview" },
  { href: "/admin/users", labelKey: "adminNavUsers" },
  { href: "/admin/groups", labelKey: "adminNavGroups" },
  { href: "/admin/content-roles", labelKey: "adminNavContentRoles" },
  { href: "/admin/settings", labelKey: "adminNavSettings" },
];

export default function AdminShell({ user, children }: Props) {
  useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );
  // Mobile-only off-canvas nav. On md+ the sidebar is static and this is inert.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    getConfig().then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.png"));
  }, []);

  // Close the drawer after navigation (covers back/forward too).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="flex items-center justify-between px-5 h-14 border-b"
        style={{
          background: "oklch(0.15 0 0 / 0.65)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile nav toggle — the sidebar is static on md+ */}
          <button
            onClick={() => setNavOpen(true)}
            className="md:hidden w-8 h-8 -ml-1 shrink-0 rounded-[var(--radius)] flex items-center justify-center text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] transition-colors"
            aria-label={t("toggleSidebar")}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img src={logoUrl} alt="Logo" className="h-6 w-auto" />
          </Link>
          <span
            className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
            style={{ color: "var(--fg3)" }}
          >
            {t("admin")}
          </span>
        </div>
        <div className="flex items-center gap-3 md:gap-4 shrink-0">
          {/* Identity chip is informational — drop it on phones to keep the
              nav toggle + actions tappable */}
          <span
            className="hidden sm:inline text-[11px] truncate max-w-[140px] md:max-w-[200px]"
            style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)" }}
          >
            {user.username || user.email}
          </span>
          <Link
            href="/"
            className="text-[12.5px] transition-colors"
            style={{ color: "var(--fg2)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--fg1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--fg2)";
            }}
          >
            {t("chatArrow")}
          </Link>
          <button
            onClick={handleSignOut}
            className="text-[12.5px] transition-colors"
            style={{ color: "var(--fg2)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--fg1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--fg2)";
            }}
          >
            {t("signOut")}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Backdrop for the mobile drawer */}
        {navOpen && (
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "oklch(0 0 0 / 0.55)" }}
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* Static sidebar on md+; off-canvas drawer below */}
        <nav
          className={`w-56 md:w-52 shrink-0 border-r py-4 px-2 overflow-y-auto max-md:fixed max-md:top-0 max-md:left-0 max-md:h-full max-md:z-50 max-md:transition-transform max-md:duration-200 max-md:ease-out ${
            navOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
          }`}
          style={{
            background: "oklch(0.17 0 0 / 0.85)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderColor: "var(--border)",
          }}
        >
          {/* Drawer header (mobile only) — mirrors the chat sidebar pattern */}
          <div className="md:hidden flex items-center justify-between px-2 pb-3 mb-2 border-b" style={{ borderColor: "var(--border)" }}>
            <span
              className="text-[10.5px] font-medium uppercase tracking-[0.08em] px-1"
              style={{ color: "var(--fg3)" }}
            >
              {t("admin")}
            </span>
            <button
              onClick={() => setNavOpen(false)}
              className="w-8 h-8 rounded-[var(--radius)] flex items-center justify-center text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] transition-colors"
              aria-label={t("close")}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block px-3 py-2 rounded-[var(--radius)] text-[13px] mb-1 transition-colors"
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--accent-fg)" : "var(--fg1)",
                  fontWeight: active ? 500 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--muted)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
