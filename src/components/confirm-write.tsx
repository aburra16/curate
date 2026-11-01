"use client";

import type { NostrEvent } from "nostr-tools";
import { useId } from "react";
import { PublishOutcome } from "@/components/publish-outcome";
import { useSettled } from "@/hooks/use-settled";
import { useWrite } from "@/hooks/use-write";
import type { EventTemplate } from "@/lib/conceptCopy";

const inputStyle = { borderRadius: "var(--radius-input)" as const };

/**
 * A question the reader answers with one write: Cancel, or the confirm
 * button, which signs and publishes what `template` makes when it is pressed.
 * Until the list relay has taken the write nothing has changed: a refusal says
 * so, and Retry sends the same event again. A write the list relay took is
 * handed to `onDone` at once, and a toast names any of the author's own relays
 * that missed it.
 */
export function ConfirmWrite({
  question,
  confirmLabel,
  busyLabel,
  template,
  onDone,
  onCancel,
}: {
  question: string;
  /** The confirm button's words, and what it says while the write is in flight. */
  confirmLabel: string;
  busyLabel: string;
  /** The write, made when the person confirms. */
  template: () => EventTemplate;
  /** The list relay has the write; handed the signed event. */
  onDone: (event: NostrEvent) => void;
  onCancel: () => void;
}) {
  const { state, busy, write, retry } = useWrite();
  const settled = useSettled(onDone);
  const askedId = useId();

  return (
    <div role="group" aria-labelledby={askedId} className="flex flex-col gap-4">
      <p id={askedId} className="text-[14px] text-ink">
        {question}
      </p>
      <PublishOutcome state={state} busy={busy} onRetry={() => void retry().then(settled)} />
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[12px] text-mute hover:text-ink-soft transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void write(template()).then(settled)}
          disabled={busy}
          className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={inputStyle}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
