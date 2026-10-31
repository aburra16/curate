"use client";

import { useState, type ReactNode } from "react";

interface Props {
  /** How many items are folded. Nothing shows for none. */
  count: number;
  /** Draws the folded items; called only once the fold is open. */
  children: () => ReactNode;
}

/**
 * Items from accounts outside the reader's web of trust, folded below the
 * list, and opened in place. The wording is no verdict on the
 * people in it, and says nothing of anyone's rank.
 */
export function TrustFold({ count, children }: Props) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full border border-dashed border-rule px-4 py-2.5 text-left text-[12px] text-mute hover:text-ink-soft hover:border-rule-strong transition-colors"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        {count.toLocaleString()} more from accounts outside your web of trust
      </button>
      {open ? <div className="mt-3 flex flex-col gap-3">{children()}</div> : null}
    </div>
  );
}
