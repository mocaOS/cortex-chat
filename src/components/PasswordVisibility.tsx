"use client";

import { t } from "@/lib/i18n";

// Inline Lucide "eye" / "eye-off" outline paths — lucide-react is not a
// dependency; inline SVGs with currentColor are the repo convention.
export function EyeIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

// The eye button that sits inside a relative-positioned field wrapper.
export function VisibilityToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? t("hidePassword") : t("showPassword")}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-sm)] transition-colors"
      style={{ color: "var(--fg2)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--fg1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--fg2)";
      }}
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}
