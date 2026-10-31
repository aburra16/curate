"use client";

import type { EventTemplate } from "nostr-tools";
import { useCallback, useRef, useState } from "react";
import { retryPublish, signAndPublish, type PublishResult } from "@/services/publish";
import { SignerError } from "@/services/signer";

/** Where a write is: not started, in flight, answered by the relays, or stopped before any relay was asked. */
export type WriteState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; result: PublishResult }
  | { phase: "error"; message: string };

/** What the person is told when something other than the signer went wrong. */
const UNKNOWN_FAILURE = "Something went wrong, and the write may not have been saved.";

/** A failure as words for the person: a signer's own are plain already. */
const wordsOf = (err: unknown): string => (err instanceof SignerError ? err.message : UNKNOWN_FAILURE);

/**
 * One write at a time. `write` signs and publishes a template; a call made
 * while another is in flight does nothing and answers null, as does one that
 * fails to sign. `retry` sends the last write's same event again to the relays
 * that missed it, and only when the list relay was one of them. `reset` clears
 * the outcome; it doesn't stop a write already sent, whose outcome shows when
 * it lands.
 *
 * The guard is a ref, not just `busy`: two calls in the same tick both see the
 * `busy` of the render they were made in.
 */
export function useWrite(): {
  state: WriteState;
  busy: boolean;
  write(template: EventTemplate): Promise<PublishResult | null>;
  retry(): Promise<PublishResult | null>;
  reset(): void;
} {
  const [state, setState] = useState<WriteState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lastRef = useRef<PublishResult | null>(null);

  /** Take the turn; false when another write holds it. */
  const claim = useCallback((): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }, []);

  /** Wait for a send, show how it went, and give the turn back. */
  const settle = useCallback(async (send: () => Promise<PublishResult>): Promise<PublishResult | null> => {
    try {
      const result = await send();
      lastRef.current = result;
      setState({ phase: "done", result });
      return result;
    } catch (err) {
      setState({ phase: "error", message: wordsOf(err) });
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const write = useCallback(
    async (template: EventTemplate): Promise<PublishResult | null> => {
      if (!claim()) return null;
      lastRef.current = null;
      setState({ phase: "working" });
      return settle(() => signAndPublish(template));
    },
    [claim, settle],
  );

  const retry = useCallback(async (): Promise<PublishResult | null> => {
    const last = lastRef.current;
    if (!last || last.onHub || !claim()) return null;
    return settle(() => retryPublish(last));
  }, [claim, settle]);

  const reset = useCallback((): void => {
    lastRef.current = null;
    setState({ phase: "idle" });
  }, []);

  return { state, busy, write, retry, reset };
}
