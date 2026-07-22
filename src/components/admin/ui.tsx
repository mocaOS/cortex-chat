"use client";

import { forwardRef, useState } from "react";
import { VisibilityToggle } from "../PasswordVisibility";

const inputBase =
  "w-full rounded-[var(--radius)] px-3 py-2 text-[13px] outline-none border transition-colors disabled:opacity-60";

const fieldLabel =
  "text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--fg2)]";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label?: string }
>(function Input({ label, className = "", ...props }, ref) {
  return (
    <label className="block space-y-1.5">
      {label && <span className={fieldLabel}>{label}</span>}
      <input
        ref={ref}
        {...props}
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
        className={`${inputBase} placeholder:text-[var(--fg3)] ${className}`}
      />
    </label>
  );
});

// Password variant of Input: same label + styling, plus the show/hide eye
// toggle. `type` is owned by the component.
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string }
>(function PasswordInput({ label, className = "", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block space-y-1.5">
      {label && <span className={fieldLabel}>{label}</span>}
      <div className="relative">
        <input
          ref={ref}
          {...props}
          type={visible ? "text" : "password"}
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
          className={`${inputBase} pr-10 placeholder:text-[var(--fg3)] ${className}`}
        />
        <VisibilityToggle
          visible={visible}
          onToggle={() => setVisible((v) => !v)}
        />
      </div>
    </label>
  );
});

export function Textarea({
  label,
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className={fieldLabel}>{label}</span>}
      <textarea
        {...props}
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
        className={`${inputBase} placeholder:text-[var(--fg3)] ${className}`}
      />
    </label>
  );
}

export function Select({
  label,
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      {label && <span className={fieldLabel}>{label}</span>}
      <select
        {...props}
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
        className={`${inputBase} ${className}`}
      >
        {children}
      </select>
    </label>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";

const variantClass: Record<ButtonVariant, string> = {
  primary: "",
  secondary: "",
  danger: "",
  ghost:
    "text-[var(--fg2)] hover:text-[var(--fg1)] hover:bg-[var(--muted)] border border-transparent",
  outline: "border text-[var(--fg1)] hover:bg-[var(--muted)]",
};

const variantStyle: Record<ButtonVariant, React.CSSProperties | undefined> = {
  primary: { background: "var(--accent)", color: "var(--accent-fg)" },
  secondary: { background: "var(--muted)", color: "var(--fg1)" },
  danger: {
    background: "color-mix(in oklch, var(--destructive) 18%, transparent)",
    color: "var(--destructive)",
    border: "1px solid color-mix(in oklch, var(--destructive) 30%, transparent)",
  },
  ghost: undefined,
  outline: { borderColor: "var(--border)" },
};

export function Button({
  variant = "primary",
  className = "",
  style,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]";
  const merged = { ...variantStyle[variant], ...style };
  return (
    <button
      {...props}
      style={merged}
      className={`${base} ${variantClass[variant]} ${className}`}
    />
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] overflow-hidden border"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {/* Wide tables scroll inside the card on narrow viewports — the page
          itself must never scroll horizontally */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">{children}</table>
      </div>
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left font-medium text-[10.5px] uppercase tracking-[0.08em] px-4 py-3 border-b"
      style={{ color: "var(--fg2)", borderColor: "var(--border)" }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...props}
      className={`px-4 py-3 border-b align-middle ${className}`}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </td>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="text-[13px] rounded-[var(--radius)] px-3 py-2 border"
      style={{
        background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
        borderColor:
          "color-mix(in oklch, var(--destructive) 30%, transparent)",
        color: "var(--destructive)",
      }}
    >
      {message}
    </div>
  );
}

// Underline tab bar (accent border marks the active tab). Lifted from the
// admin analytics page so users + analytics share one implementation.
export function Tabs<K extends string>({
  active,
  onChange,
  tabs,
}: {
  active: K;
  onChange: (k: K) => void;
  tabs: { key: K; label: string }[];
}) {
  return (
    <div
      className="flex gap-1 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="px-3 py-2 text-[13px] -mb-px border-b-2 transition-colors"
            style={{
              color: on ? "var(--fg1)" : "var(--fg2)",
              borderColor: on ? "var(--accent)" : "transparent",
              fontWeight: on ? 500 : 400,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
