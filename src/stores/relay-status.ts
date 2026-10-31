/**
 * How each relay answered its last read: the data behind the status line that
 * names a relay that refused or didn't answer.
 */

import { create } from "zustand";
import type { ReqEnd } from "@/services/transport";

export type RelayState = ReqEnd["state"] | "ok";

interface RelayStatusState {
  /** By relay URL. `ok` means the relay answered to the end (EOSE). */
  statuses: Record<string, RelayState>;
  /** Why a relay is not `ok`, in its own words. Absent for an `ok` relay. */
  reasons: Record<string, string>;
  /** Record how a read from `relay` ended. */
  report: (relay: string, end: ReqEnd) => void;
  reset: () => void;
}

export const useRelayStatus = create<RelayStatusState>()((set) => ({
  statuses: {},
  reasons: {},
  report: (relay, end) =>
    set((s) => {
      const reasons = { ...s.reasons };
      delete reasons[relay];
      if ("reason" in end && end.reason) reasons[relay] = end.reason;
      return {
        statuses: { ...s.statuses, [relay]: end.state === "eose" ? "ok" : end.state },
        reasons,
      };
    }),
  reset: () => set({ statuses: {}, reasons: {} }),
}));
