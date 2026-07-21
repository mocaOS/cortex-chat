"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

export default function ForgotPasswordPage() {
  useLocale();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* Always show the same confirmation regardless of outcome. */
    }
    setSent(true);
    setLoading(false);
  }

  if (!ready) return <div className="h-dvh" style={{ background: "var(--bg)" }} />;

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

        {sent ? (
          <p
            className="text-[13px] text-center leading-relaxed"
            style={{ color: "var(--fg2)" }}
          >
            {t("forgotPasswordSent")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <h1
                className="text-[15px] font-semibold text-center"
                style={{ color: "var(--fg1)" }}
              >
                {t("forgotPasswordHeading")}
              </h1>
              <p
                className="text-[12.5px] text-center leading-relaxed"
                style={{ color: "var(--fg2)" }}
              >
                {t("forgotPasswordDescription")}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: "var(--fg2)" }}
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
              {loading ? t("forgotPasswordSending") : t("forgotPasswordSubmit")}
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
