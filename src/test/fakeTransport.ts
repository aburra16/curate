import type { NostrEvent } from "nostr-tools";
import type { RelayTransport, ReqEnd } from "@/services/transport";

/** What one relay does when asked. */
export interface FakeRelay {
  /** Events the relay sends before it ends the request. */
  events: NostrEvent[];
  /** How the request ends (EOSE, CLOSED, timeout or error). */
  end: ReqEnd;
  /** The answer to a COUNT. Absent means null. A refusing relay answers null whatever this says. */
  count?: number | null;
  /**
   * Milliseconds the relay takes before it sends anything. A delay longer than
   * the caller's timeout ends the request as `{state:"timeout"}` with no events,
   * at the timeout.
   */
  delayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A relay transport that answers from a script, keyed by relay URL, so the
 * reading services test without sockets. A relay missing from the script ends
 * with `{state:"error"}`. Timers are real `setTimeout`s, so a test that uses
 * `delayMs` runs under vitest fake timers.
 */
export function fakeTransport(script: Record<string, FakeRelay>): RelayTransport {
  return {
    async req(relay, _filters, onEvent, timeoutMs) {
      const entry = script[relay];
      if (!entry) return { state: "error", reason: `fakeTransport: nothing scripted for ${relay}` };
      const delay = entry.delayMs ?? 0;
      if (delay > timeoutMs) {
        await sleep(timeoutMs);
        return { state: "timeout" };
      }
      if (delay > 0) await sleep(delay);
      for (const ev of entry.events) onEvent(ev);
      return entry.end;
    },

    async count(relay, _filters, timeoutMs) {
      const entry = script[relay];
      if (!entry) return null;
      const delay = entry.delayMs ?? 0;
      if (delay > timeoutMs) {
        await sleep(timeoutMs);
        return null;
      }
      if (delay > 0) await sleep(delay);
      if (entry.end.state === "closed" || entry.end.state === "error" || entry.end.state === "timeout") {
        return null;
      }
      return entry.count ?? null;
    },

    live(relay, _filters, onEvent) {
      let open = true;
      queueMicrotask(() => {
        if (!open) return;
        for (const ev of script[relay]?.events ?? []) onEvent(ev);
      });
      return () => {
        open = false;
      };
    },
  };
}
