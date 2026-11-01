/**
 * Whether the Connect chooser is open. The header opens it, and so does
 * anything else that needs the person to connect again (a write that a remote
 * signer stopped answering).
 */

import { create } from "zustand";

interface ConnectDialogState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useConnectDialog = create<ConnectDialogState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
