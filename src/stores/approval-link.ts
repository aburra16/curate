/**
 * The approval page a remote signer last asked the person to open (NIP-46
 * `auth_url`), until they dismiss it or the signer connects. Only `https:`
 * links get here; the page shows the link and the person decides to open it.
 */

import { create } from "zustand";

interface ApprovalLinkState {
  url: string | null;
  show: (url: string) => void;
  dismiss: () => void;
}

export const useApprovalLink = create<ApprovalLinkState>()((set) => ({
  url: null,
  show: (url) => set({ url }),
  dismiss: () => set({ url: null }),
}));
