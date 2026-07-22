"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getConfig, getCachedConfig } from "@/lib/config";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";
import PasswordInput from "@/components/PasswordInput";

// Only allow same-origin, absolute-path redirects — reject absolute URLs and
// protocol-relative "//host" values so ?next= can't be used for open-redirect
// phishing after login.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  return raw;
}

function LoginForm() {
  useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(
    () => getCachedConfig()?.logoUrl || "/logo.png"
  );
  const [supportUrl, setSupportUrl] = useState(
    () => getCachedConfig()?.supportUrl || ""
  );
  const [supportLabel, setSupportLabel] = useState(
    () => getCachedConfig()?.supportLabel || ""
  );
  const [ready, setReady] = useState(() => !!getCachedConfig());
  const [emailConfigured, setEmailConfigured] = useState(
    () => getCachedConfig()?.emailConfigured ?? false
  );
  const [registrationEnabled, setRegistrationEnabled] = useState(
    () => getCachedConfig()?.registrationEnabled ?? false
  );
  const justReset = params.get("reset") === "1";

  useEffect(() => {
    getConfig()
      .then((cfg) => {
        setLogoUrl(cfg.logoUrl || "/logo.png");
        setSupportUrl(cfg.supportUrl || "");
        setSupportLabel(cfg.supportLabel || "");
        setEmailConfigured(!!cfg.emailConfigured);
        setRegistrationEnabled(!!cfg.registrationEnabled);
      })
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
        setError(
          data.code === "pendingApproval"
            ? t("loginPendingApproval")
            : data.error || t("loginFailed")
        );
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
    return <div className="h-dvh" style={{ background: "var(--bg)" }} />;
  }

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

      <form
        onSubmit={onSubmit}
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

        <div className="space-y-1.5">
          <label
            className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
            style={{ color: "var(--fg2)" }}
          >
            {t("password")}
          </label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {justReset && (
          <div
            className="text-[12.5px] text-center"
            style={{ color: "var(--fg2)" }}
          >
            {t("resetPasswordSuccess")}
          </div>
        )}

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
          {loading ? t("signingIn") : t("signIn")}
        </button>

        {(emailConfigured || registrationEnabled) && (
          <div className="text-center pt-1 space-y-1.5">
            {emailConfigured && (
              <div>
                <a
                  href="/forgot-password"
                  className="text-[12.5px] transition-colors"
                  style={{ color: "var(--fg2)" }}
                >
                  {t("forgotPassword")}
                </a>
              </div>
            )}
            {registrationEnabled && (
              <div>
                <a
                  href="/register"
                  className="text-[12.5px] transition-colors"
                  style={{ color: "var(--fg2)" }}
                >
                  {t("createAccount")}
                </a>
              </div>
            )}
          </div>
        )}
      </form>

      {supportUrl ? (
        <a
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 text-[12.5px] transition-colors relative"
          style={{ color: "var(--fg2)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--fg1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--fg2)";
          }}
        >
          {supportLabel || t("support")}
        </a>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-dvh" style={{ background: "var(--bg)" }} />}>
      <LoginForm />
    </Suspense>
  );
}
