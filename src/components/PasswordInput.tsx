"use client";

import { useState } from "react";
import { VisibilityToggle } from "./PasswordVisibility";

// Password field for the public auth pages (login / register / reset) —
// visually identical to their raw inputs, plus the show/hide eye toggle.
// `type` is owned by the component; everything else passes through.
export default function PasswordInput(
  props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
) {
  const [visible, setVisible] = useState(false);
  const { className = "", ...rest } = props;
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`w-full rounded-[var(--radius)] pl-3 pr-10 py-2.5 text-[13px] outline-none border transition-colors ${className}`}
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
      <VisibilityToggle
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
      />
    </div>
  );
}
