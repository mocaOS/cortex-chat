"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState("/logo.svg");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getConfig()
      .then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.svg"))
      .finally(() => setReady(true));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("loginFailed"));
        setLoading(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError(t("loginFailed"));
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="h-dvh bg-[var(--bg-primary)]" />;
  }

  return (
    <div className="h-dvh flex items-center justify-center px-4 bg-[var(--bg-primary)]">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center justify-center pb-2">
          <img src={logoUrl} alt="Logo" className="h-10 w-auto" />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-[var(--text-secondary)]">
            {t("email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-[var(--text-secondary)]">
            {t("password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 text-center">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-lg text-sm font-medium text-black disabled:opacity-60 transition-opacity"
          style={{ background: "var(--accent)" }}
        >
          {loading ? t("signingIn") : t("signIn")}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-[var(--bg-primary)]" />}>
      <LoginForm />
    </Suspense>
  );
}
