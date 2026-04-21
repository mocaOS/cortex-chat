"use client";

import { forwardRef } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label?: string }
>(function Input({ label, className = "", ...props }, ref) {
  return (
    <label className="block space-y-1.5">
      {label && (
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      )}
      <input
        ref={ref}
        {...props}
        className={`w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-60 ${className}`}
      />
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
      {label && (
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      )}
      <textarea
        {...props}
        className={`w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors ${className}`}
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
      {label && (
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      )}
      <select
        {...props}
        className={`w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors ${className}`}
      >
        {children}
      </select>
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const base =
    "px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed";
  const map: Record<typeof variant, string> = {
    primary: "text-black",
    secondary:
      "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:brightness-110",
    danger: "bg-red-600/80 text-white hover:bg-red-600",
    ghost:
      "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]",
  };
  const style =
    variant === "primary" ? { background: "var(--accent)" } : undefined;
  return (
    <button
      {...props}
      style={style}
      className={`${base} ${map[variant]} ${className}`}
    />
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg-secondary)]">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left font-medium text-xs uppercase tracking-wider text-[var(--text-secondary)] px-4 py-3 border-b border-[var(--border)]">
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
      className={`px-4 py-3 border-b border-[var(--border)] align-middle ${className}`}
    >
      {children}
    </td>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
      {message}
    </div>
  );
}
