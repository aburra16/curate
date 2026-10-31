"use client";

import type { NostrEvent } from "nostr-tools";
import { useState } from "react";
import type { PublishResult } from "@/services/publish";

/**
 * What happens once a write has been answered. A write the list relay took
 * is handed on at once (`onSaved`), unless one of the author's own relays
 * missed it: then it waits in `waiting`, so the person reads which one, and
 * the caller hands it on when they are done. A write the list relay refused,
 * or one that never went out (null), is neither: the outcome line says why.
 */
export function useSettled(onSaved: (event: NostrEvent) => void): {
  waiting: NostrEvent | null;
  settled: (result: PublishResult | null) => void;
} {
  const [waiting, setWaiting] = useState<NostrEvent | null>(null);
  const settled = (result: PublishResult | null) => {
    if (!result?.onHub) return;
    if (result.failed.length === 0) onSaved(result.event);
    else setWaiting(result.event);
  };
  return { waiting, settled };
}
