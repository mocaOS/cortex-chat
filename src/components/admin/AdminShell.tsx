"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

interface Props {
  user: { id: string; email: string; username: string };
  children: React.ReactNode;
}

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/groups", label: "User groups" },
  { href: "/admin/content-roles", label: "Content roles" },
  { href: "/admin/logins", label: "Login history" },
  { href: "/admin/analytics", label: "Analytics" },
];

export default function AdminShell({ user, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState("/logo.svg");

  useEffect(() => {
    getConfig().then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.svg"));
  }, []);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="h-dvh flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <img src={logoUrl} alt="Logo" className="h-7 w-auto" />
          </Link>
          <span className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">
            {t("admin")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)] truncate max-w-[200px]">
            {user.username || user.email}
          </span>
          <Link
            href="/"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Chat →
          </Link>
          <button
            onClick={handleSignOut}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t("signOut")}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-52 shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] py-4 px-2 overflow-y-auto">
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${
                  active
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
