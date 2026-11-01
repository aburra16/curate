"use client";

import { useEffect, useState } from "react";

/** A copy button: the text goes to the clipboard, and the button says so. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <span className="shrink-0">
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
        className="border border-rule px-2 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
        style={{ borderRadius: "var(--radius-input)" }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `Copied ${label}` : state === "failed" ? `Could not copy ${label}` : ""}
      </span>
    </span>
  );
}
