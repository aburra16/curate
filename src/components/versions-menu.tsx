"use client";

import { useEffect, useRef, useState } from "react";
import type { ListVersion, VersionLabel } from "@/app/list/list-model";
import { UserIdentity } from "@/components/user-identity";
import { cn } from "@/lib/utils";

interface Props {
  versions: ListVersion[];
  /** The address of the version being read (`definition.coordinate`). */
  current: string;
  /** A reader chose to read this version instead. */
  onSelect: (version: ListVersion) => void;
}

/** What a version is called beside its author. */
const WORDS: Record<VersionLabel, string> = {
  community: "community",
  house: "house",
  yours: "yours",
  assistant: "assistant",
  copy: "copy",
};

/**
 * The versions of a list a reader can read instead of the one that governs
 * for them: the community header, then each author's copy.
 * A menu button; Escape or a click elsewhere closes it.
 */
export function VersionsMenu({ versions, current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 border border-rule bg-surface px-2.5 py-1 text-[12px] text-ink-soft transition-colors duration-150 hover:border-rule-strong hover:text-ink"
        style={{ borderRadius: "var(--radius-input)" }}
      >
        {versions.length} versions
        <span aria-hidden className="text-[10px] text-mute">
          &#9662;
        </span>
      </button>
      {open ? (
        <ul
          role="menu"
          aria-label="Versions of this list"
          className="absolute left-0 z-20 mt-1.5 w-72 border border-rule-strong bg-surface-raised py-1 shadow-lg"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          {versions.map((v) => {
            const shown = v.coordinate === current;
            return (
              <li key={`${v.label}:${v.coordinate}`} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={shown}
                  onClick={() => {
                    setOpen(false);
                    if (!shown) onSelect(v);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-surface-hover",
                    shown ? "text-ink" : "text-ink-soft",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className={cn("w-2 text-[10px]", shown ? "text-accent" : "text-transparent")}>
                      &#9679;
                    </span>
                    <UserIdentity pubkey={v.author} avatarSize={16} textClass="text-[12px]" />
                  </span>
                  <span
                    className="shrink-0 border border-rule px-1.5 py-px text-[10px] tracking-[0.04em] text-mute"
                    style={{ borderRadius: "var(--radius-input)" }}
                  >
                    {WORDS[v.label]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
