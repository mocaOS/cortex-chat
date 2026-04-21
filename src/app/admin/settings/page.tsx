"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  ErrorBanner,
  Input,
  Select,
  Textarea,
} from "@/components/admin/ui";

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
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setDefaults(data.defaults);
      setSettings(data.settings);
      setAppTitle(data.settings.appTitle);
      setAppDescription(data.settings.appDescription);
      setLocaleState(data.settings.locale);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
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
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSettings(data.settings);
      setAppTitle(data.settings.appTitle);
      setAppDescription(data.settings.appDescription);
      setLocaleState(data.settings.locale);
      setMsg("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    savePatch({ appTitle, appDescription, locale });
  }

  function resetText() {
    if (!confirm("Reset title and description to defaults?")) return;
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
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await load();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    if (!confirm("Remove the custom logo and fall back to the default?"))
      return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      const res = await fetch("/api/admin/logo", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove");
      }
      await load();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Failed to remove");
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
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Branding and default language for the chat system. Shown in the
          header, login page, browser tab, meta description, and the chat
          landing page.
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading || !defaults || !settings ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading…</div>
      ) : (
        <>
          {/* Logo */}
          <section className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 space-y-4">
            <div className="text-sm font-medium">Logo</div>
            <div className="flex items-center gap-4">
              <div className="h-16 w-40 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center overflow-hidden px-3">
                <img
                  src={displayLogo}
                  alt="Logo preview"
                  className="max-h-12 max-w-full w-auto"
                />
              </div>
              <div className="flex gap-2">
                <label
                  className={`px-3 py-2 rounded-lg text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:brightness-110 cursor-pointer ${logoBusy ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  Upload logo
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
                    variant="ghost"
                    onClick={removeLogo}
                    disabled={logoBusy}
                    className="hover:!text-red-400"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <ErrorBanner message={logoError} />
            <p className="text-xs text-[var(--text-secondary)]">
              SVG, PNG, JPEG, or WebP. Max 1 MiB. Wide logos render best; they
              appear in the header, sidebar, and on the login page.
            </p>
          </section>

          {/* Text + locale */}
          <form
            onSubmit={handleSubmit}
            className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-5 space-y-4"
          >
            <Input
              label="Page title"
              value={appTitle}
              onChange={(e) => setAppTitle(e.target.value)}
              maxLength={120}
              placeholder={defaults.appTitle}
            />
            <p className="text-xs text-[var(--text-secondary)] -mt-2">
              Default: <span className="font-mono">{defaults.appTitle}</span>
            </p>

            <Textarea
              label="Page description"
              value={appDescription}
              onChange={(e) => setAppDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={defaults.appDescription}
            />
            <p className="text-xs text-[var(--text-secondary)] -mt-2">
              Default:{" "}
              <span className="font-mono">{defaults.appDescription}</span>
            </p>

            <Select
              label="Default language"
              value={locale}
              onChange={(e) => setLocaleState(e.target.value as Locale)}
            >
              <option value="en">English</option>
              <option value="de">Deutsch (du-Form)</option>
            </Select>
            <p className="text-xs text-[var(--text-secondary)] -mt-2">
              Applies to every user of the chat system. Reload required for
              already-open tabs.
            </p>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="ghost"
                type="button"
                onClick={resetText}
                disabled={saving}
                className="hover:!text-red-400"
              >
                Reset title &amp; description
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)]">
                  {msg}
                </span>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
