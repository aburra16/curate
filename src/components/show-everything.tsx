"use client";

import { cn } from "@/lib/utils";
import { useShowEverything } from "@/stores/view";

/**
 * The switch that shows all of it: copies under their concept, withdrawn
 * copies and blank headers on Discover, items from outside the reader's web
 * of trust on a list. Off, the page is Brainstorm's own view.
 */
export function ShowEverything() {
  const { on, set } = useShowEverything();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className="flex items-center gap-2 cursor-pointer select-none"
    >
      <span className="text-[12px] text-mute">Show everything</span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200",
          on ? "bg-accent border-accent/60" : "bg-rule border-rule-strong",
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3.5 w-3.5 rounded-full bg-ink shadow-sm transition-transform duration-200",
            on ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </button>
  );
}
