"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

function ResetForm() {
  useLocale();
  const router = useRouter();
  const token = useSearchParams().get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );

  useEffect(() => {
    getConfig().then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.png"));
  }, []);

  useEffect(() => {
    if (!token) {
      setTokenValid(false);
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setTokenValid(!!d.valid))
      .catch(() => setTokenValid(false));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("resetPasswordMismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("resetPasswordInvalid"));
        setLoading(false);
        return;
      }
      router.replace("/login?reset=1");
    } catch {
      setError(t("resetPasswordInvalid"));
      setLoading(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: "oklch(0.17 0 0 / 0.75)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    borderColor: "var(--border)",
    boxShadow: "var(--shadow-xl)",
  };

  return (
    <div
      className="h-dvh flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="absolute pointer-events-none"
        style={{
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "720px",
          height: "480px",
          background:
            "radial-gradient(circle, color-mix(in oklch, var(--accent) 15%, transparent) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />

      <div
        className="w-full max-w-sm rounded-[var(--radius-xl)] p-7 space-y-5 relative border"
        style={cardStyle}
      >
        <div className="flex items-center justify-center pb-1">
          <img src={logoUrl} alt="Logo" className="h-9 w-auto" />
        </div>

        {tokenValid === null ? (
          <p className="text-[13px] text-center" style={{ color: "var(--fg2)" }}>
            {t("resetPasswordCheckingLink")}
          </p>
        ) : tokenValid === false ? (
          <div className="space-y-4 text-center">
            <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
              {t("resetPasswordInvalid")}
            </p>
            <Link
              href="/forgot-password"
              className="inline-block text-[12.5px]"
              style={{ color: "var(--fg2)" }}
            >
              {t("forgotPassword")}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <h1
              className="text-[15px] font-semibold text-center"
              style={{ color: "var(--fg1)" }}
            >
              {t("resetPasswordHeading")}
            </h1>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
              >
                {t("resetPasswordNew")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                autoFocus
                className="w-full rounded-[var(--radius)] px-3 py-2.5 text-[13px] outline-none border transition-colors"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--input)",
                  color: "var(--fg1)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--input)";
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
              >
                {t("resetPasswordConfirm")}
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-[var(--radius)] px-3 py-2.5 text-[13px] outline-none border transition-colors"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--input)",
                  color: "var(--fg1)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--ring)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--input)";
                }}
              />
            </div>

            {error && (
              <div
                className="text-[12.5px] text-center"
                style={{ color: "var(--destructive)" }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-[var(--radius)] text-[13px] font-medium disabled:opacity-60 transition-all active:scale-[0.98]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow:
                  "0 0 20px color-mix(in oklch, var(--accent) 30%, transparent)",
              }}
            >
              {loading ? t("resetPasswordSaving") : t("resetPasswordSubmit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={<div className="h-dvh" style={{ background: "var(--bg)" }} />}
    >
      <ResetForm />
    </Suspense>
  );
}
