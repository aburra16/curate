"use client";

import type { NostrEvent } from "nostr-tools";
import { useToast } from "@/components/toast";
import type { PublishResult } from "@/services/publish";

/** A relay as the person knows it: its host, "relay.example.com". */
const hostOf = (relay: string): string => {
  try {
    return new URL(relay).host;
  } catch {
    return relay;
  }
};

/** What the person is told of a write the list relay took that some of their own relays missed. */
function missedNote(result: PublishResult): string {
  const missed = result.failed.map((outcome) => hostOf(outcome.from));
  return `Saved to the list relay. Not saved to ${missed.length} of your own relays: ${missed.join(", ")}.`;
}

/**
 * What happens once a write has been answered: the function to hand the
 * answer to. A write the list relay took is handed on at once (`onSaved`), so
 * the form or the question can go; when some of the author's own relays
 * missed it, a toast says which. A write the list relay refused, or one that
 * never went out (null), is neither: the outcome line says why.
 */
export function useSettled(onSaved: (event: NostrEvent) => void): (result: PublishResult | null) => void {
  const { toast } = useToast();
  return (result) => {
    if (!result?.onHub) return;
    if (result.failed.length > 0) toast(missedNote(result));
    onSaved(result.event);
  };
}
