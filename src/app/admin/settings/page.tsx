"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorBanner,
  Input,
  Select,
  Textarea,
} from "@/components/admin/ui";
import { t, setLocale as setI18nLocale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-client";

type Locale = "en" | "de";

interface Settings {
  appTitle: string;
  appDescription: string;
  locale: Locale;
  hasCustomLogo: boolean;
  logoUrl: string;
}

interface Defaults {
  appTitle: string;
  appDescription: string;
  locale: Locale;
}

export default function AdminSettingsPage() {
  useLocale();
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appTitle, setAppTitle] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [locale, setLocaleState] = useState<Locale>("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("failedToLoad"));
      setDefaults(data.defaults);
      setSettings(data.settings);
      setAppTitle(data.settings.appTitle);
      setAppDescription(data.settings.appDescription);
      setLocaleState(data.settings.locale);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function savePatch(
    patch: Partial<{ appTitle: string; appDescription: string; locale: Locale }>
  ) {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveFailed"));
      setSettings(data.settings);
      setAppTitle(data.settings.appTitle);
      setAppDescription(data.settings.appDescription);
      setLocaleState(data.settings.locale);
      setI18nLocale(data.settings.locale);
      setMsg(t("saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    savePatch({ appTitle, appDescription, locale });
  }

  function resetText() {
    if (!confirm(t("resetTitleDescriptionConfirm"))) return;
    savePatch({ appTitle: "", appDescription: "" });
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const form = new FormData();
      form.append("logo", file);
      const res = await fetch("/api/admin/logo", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("uploadFailed"));
      await load();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!confirm(t("removeLogoConfirm"))) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      const res = await fetch("/api/admin/logo", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("failedToRemove"));
      }
      await load();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : t("failedToRemove"));
    } finally {
      setLogoBusy(false);
    }
  }

  const displayLogo =
    settings?.logoUrl && settings.logoUrl.length > 0
      ? settings.logoUrl
      : "/logo.svg";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1
          className="text-[24px] font-bold"
          style={{ color: "var(--fg1)", letterSpacing: "-0.015em" }}
        >
          {t("settingsHeading")}
        </h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--fg2)" }}>
          {t("settingsDescription")}
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading || !defaults || !settings ? (
        <div className="text-[13px]" style={{ color: "var(--fg2)" }}>
          {t("loading")}
        </div>
      ) : (
        <>
          {/* Logo */}
          <section
            className="rounded-[var(--radius-lg)] border p-5 space-y-4"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <div
              className="text-[10.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: "var(--fg2)" }}
            >
              {t("logoLabel")}
            </div>
            <div className="flex items-center gap-4">
              <div
                className="h-16 w-40 rounded-[var(--radius)] border flex items-center justify-center overflow-hidden px-3"
                style={{
                  background: "var(--bg)",
                  borderColor: "var(--border)",
                }}
              >
                <img
                  src={displayLogo}
                  alt="Logo preview"
                  className="max-h-12 max-w-full w-auto"
                />
              </div>
              <div className="flex gap-2">
                <label
                  className={`inline-flex items-center px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium cursor-pointer transition-all active:scale-[0.98] ${logoBusy ? "opacity-60 cursor-not-allowed" : ""}`}
                  style={{ background: "var(--muted)", color: "var(--fg1)" }}
                >
                  {t("uploadLogo")}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/svg+xml,image/png,image/jpeg,image/webp"
                    disabled={logoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {settings.hasCustomLogo && (
                  <Button
                    variant="danger"
                    onClick={removeLogo}
                    disabled={logoBusy}
                  >
                    {t("remove")}
                  </Button>
                )}
              </div>
            </div>
            <ErrorBanner message={logoError} />
            <p className="text-[11.5px]" style={{ color: "var(--fg2)" }}>
              {t("logoHint")}
            </p>
          </section>

          {/* Text + locale */}
          <form
            onSubmit={handleSubmit}
            className="rounded-[var(--radius-lg)] border p-5 space-y-4"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <Input
              label={t("pageTitle")}
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              maxLength={120}
              placeholder={defaults.appTitle}
            />
            <p
              className="text-[11.5px] -mt-2"
              style={{ color: "var(--fg2)" }}
            >
              {t("defaultLabel")}{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg1)" }}>
                {defaults.appTitle}
              </span>
            </p>

            <Textarea
              label={t("pageDescription")}
              value={appDescription}
              onChange={(e) => setAppDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={defaults.appDescription}
            />
            <p
              className="text-[11.5px] -mt-2"
              style={{ color: "var(--fg2)" }}
            >
              {t("defaultLabel")}{" "}
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg1)" }}>
                {defaults.appDescription}
              </span>
            </p>

            <Select
              label={t("defaultLanguage")}
              value={locale}
              onChange={(e) => setLocaleState(e.target.value as Locale)}
            >
              <option value="en">{t("langEnglish")}</option>
              <option value="de">{t("langGerman")}</option>
            </Select>
            <p
              className="text-[11.5px] -mt-2"
              style={{ color: "var(--fg2)" }}
            >
              {t("localeHint")}
            </p>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="danger"
                type="button"
                onClick={resetText}
                disabled={saving}
              >
                {t("resetTitleDescription")}
              </Button>
              <div className="flex items-center gap-3">
                <span
                  className="text-[12.5px]"
                  style={{ color: "var(--fg2)" }}
                >
                  {msg}
                </span>
                <Button type="submit" disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </Button>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
