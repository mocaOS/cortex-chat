"use client";

import { Settings, Collection } from "@/types";
import { t } from "@/lib/i18n";

interface Props {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  collections: Collection[];
  onClose: () => void;
}

export default function SettingsPanel({
  settings,
  onSettingsChange,
  collections,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bottom-16 right-4 md:right-auto md:left-1/2 md:-translate-x-1/2 md:max-w-md w-[calc(100%-2rem)] md:w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl p-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("settings")}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Streaming toggle */}
        <div className="flex items-center justify-between">
          <label className="text-sm text-[var(--text-secondary)]">
            {t("streamResponses")}
          </label>
          <button
            onClick={() =>
              onSettingsChange({
                ...settings,
                streaming: !settings.streaming,
              })
            }
            className={`relative w-11 h-6 rounded-full transition-colors ${
              settings.streaming ? "" : "bg-[var(--border)]"
            }`}
            style={
              settings.streaming
                ? { background: "var(--accent)" }
                : undefined
            }
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                settings.streaming ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* Collection scope */}
        <div className="space-y-1.5">
          <label className="text-sm text-[var(--text-secondary)]">
            {t("collectionScope")}
          </label>
          <select
            value={settings.collectionId || ""}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                collectionId: e.target.value || null,
              })
            }
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
          >
            <option value="">{t("allCollections")}</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name} ({col.document_count} {t("docs")})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
