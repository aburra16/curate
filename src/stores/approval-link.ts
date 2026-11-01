/**
 * The approval page a remote signer last asked the person to open (NIP-46
 * `auth_url`), until they dismiss it or the signer connects. Only `https:`
 * links are kept, whatever sends them: anything else is ignored. The page
 * shows the link and the person decides to open it.
 */

import { create } from "zustand";

interface ApprovalLinkState {
  url: string | null;
  show: (url: string) => void;
  dismiss: () => void;
}

/** The link as the browser reads it, when it is an `https:` link. */
function secureLink(url: string): string | null {
  try {
    const link = new URL(url);
    return link.protocol === "https:" ? link.href : null;
  } catch {
    return null;
  }
}

export const useApprovalLink = create<ApprovalLinkState>()((set) => ({
  url: null,
  show: (url) => {
    const secure = secureLink(url);
    if (secure) set({ url: secure });
  },
  dismiss: () => set({ url: null }),
}));
