import type { StateStorage } from "zustand/middleware";

/**
 * localStorage with every read and write guarded. It is missing on the server
 * and in tests, and blocked or full in some browsers; the page works without it.
 */
export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Not saved; the setting still applies for this visit.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Nothing to remove.
    }
  },
};
