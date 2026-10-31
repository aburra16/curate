/**
 * Signed-in user state — pubkey and kind of the currently connected signer.
 *
 * We persist the *intent* to be connected (the last successful pubkey) so
 * subsequent page loads can offer a quick reconnect, but the signer itself
 * lives only in-memory (`services/signer.ts`) until the user connects again.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeStorage } from "@/lib/safeStorage";
import type { SignerMethod } from "@/services/signer";

export type SignerStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

interface SignerState {
  pubkey: string | null;
  /** How the signer in use signs; null while none is connected. Not persisted. */
  method: SignerMethod | null;
  status: SignerStatus;
  error: string | null;
  setConnecting: () => void;
  setConnected: (pubkey: string, method: SignerMethod) => void;
  setError: (message: string) => void;
  setDisconnected: () => void;
}

export const useSigner = create<SignerState>()(
  persist(
    (set) => ({
      pubkey: null,
      method: null,
      status: "disconnected",
      error: null,
      setConnecting: () => set({ status: "connecting", error: null }),
      setConnected: (pubkey, method) =>
        set({ pubkey, method, status: "connected", error: null }),
      setError: (message) => set({ status: "error", error: message }),
      setDisconnected: () =>
        set({ pubkey: null, method: null, status: "disconnected", error: null }),
    }),
    {
      name: "curate-signer",
      storage: createJSONStorage(() => safeStorage),
      // Only persist the last-known pubkey; method and status always reset on load.
      partialize: (s) => ({ pubkey: s.pubkey }),
      version: 1,
    }
  )
);
