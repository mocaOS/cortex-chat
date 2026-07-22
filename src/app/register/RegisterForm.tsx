"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import PasswordInput from "@/components/PasswordInput";

export default function RegisterForm() {
  useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );
  const [ready, setReady] = useState(() => !!getCachedConfig());

  useEffect(() => {
    getConfig()
      .then((cfg) => setLogoUrl(cfg.logoUrl || "/logo.png"))
      .finally(() => setReady(true));
  }, []);

  const matches = password === confirm;
  const canSubmit =
    !loading && email.length > 0 && password.length >= 8 && matches;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 409
            ? t("registerEmailTaken")
            : res.status === 429
              ? t("registerRateLimited")
              : t("registerFailed")
        );
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError(t("registerFailed"));
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="h-dvh" style={{ background: "var(--bg)" }} />;
  }

  const fieldLabelStyle: React.CSSProperties = { color: "var(--fg2)" };

  return (
    <div
      className="h-dvh flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Soft accent glow at 15% — MOCA hero signature */}
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
        style={{
          background: "oklch(0.17 0 0 / 0.75)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div className="flex items-center justify-center pb-1">
          <img src={logoUrl} alt="Logo" className="h-9 w-auto" />
        </div>

        {done ? (
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: "var(--fg2)" }}
          >
            {t("registerSuccess")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <h1
              className="text-[15px] font-semibold text-center"
              style={{ color: "var(--fg1)" }}
            >
              {t("registerHeading")}
            </h1>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={fieldLabelStyle}
              >
                {t("email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
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
                style={fieldLabelStyle}
              >
                {t("registerPasswordLabel")}
              </label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={fieldLabelStyle}
              >
                {t("registerConfirmLabel")}
              </label>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              {password.length > 0 && confirm.length > 0 && (
                <div
                  className="flex items-center gap-1.5 text-[12px] pt-0.5"
                  style={{
                    color: matches ? "var(--success)" : "var(--destructive)",
                  }}
                >
                  {matches ? (
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  )}
                  <span>
                    {matches ? t("passwordsMatch") : t("resetPasswordMismatch")}
                  </span>
                </div>
              )}
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
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-[var(--radius)] text-[13px] font-medium disabled:opacity-60 transition-all active:scale-[0.98]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow:
                  "0 0 20px color-mix(in oklch, var(--accent) 30%, transparent)",
              }}
            >
              {loading ? t("registerSubmitting") : t("registerSubmit")}
            </button>
          </form>
        )}

        <div className="text-center">
          <Link
            href="/login"
            className="text-[12.5px] transition-colors"
            style={{ color: "var(--fg2)" }}
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
