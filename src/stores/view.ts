/**
 * How much Discover and the list page show: the "Show everything" switch.
 * Off, the page is Brainstorm's: copies fold under their concept, withdrawn
 * copies and blank headers are hidden, and items from outside the reader's
 * web of trust fold into "N more". On, all of it is shown, each labelled.
 *
 * Kept in localStorage so it survives a reload. Every read and write is
 * guarded: storage is missing on the server and in tests, and blocked or
 * full in some browsers. Without it the switch still works for the visit.
 *
 * The saved value is read after mount, not when the module loads, so the
 * first render matches what the server drew.
 */
import { useEffect } from "react";
import { create } from "zustand";

export const SHOW_EVERYTHING_KEY = "curate.showEverything";

function readSaved(): boolean {
  try {
    return localStorage.getItem(SHOW_EVERYTHING_KEY) === "true";
  } catch {
    return false;
  }
}

function save(on: boolean): void {
  try {
    localStorage.setItem(SHOW_EVERYTHING_KEY, String(on));
  } catch {
    // Not kept; the switch still applies for this visit.
  }
}

interface ViewState {
  on: boolean;
  /** Whether the saved value has been read (once, after mount) or the reader has chosen. */
  loaded: boolean;
  load: () => void;
  set: (on: boolean) => void;
}

export const useView = create<ViewState>()((set, get) => ({
  on: false,
  loaded: false,
  load: () => {
    if (!get().loaded) set({ on: readSaved(), loaded: true });
  },
  set: (on) => {
    save(on);
    set({ on, loaded: true });
  },
}));

/** The "Show everything" switch: whether it is on, and a way to change it. */
export function useShowEverything(): { on: boolean; set: (on: boolean) => void } {
  const on = useView((s) => s.on);
  const setOn = useView((s) => s.set);
  const load = useView((s) => s.load);
  useEffect(() => load(), [load]);
  return { on, set: setOn };
}
