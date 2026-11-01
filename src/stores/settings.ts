/**
 * User settings — the relay set. Persisted to localStorage so preferences
 * survive page reloads.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULT_RELAYS, RETIRED_RELAYS, normalizeRelayUrl } from "@/lib/curate/relayUrls";
import { safeStorage } from "@/lib/safeStorage";

interface SettingsState {
  /** Active relay set. Always non-empty (we fall back to DEFAULT_RELAYS if cleared). */
  relays: string[];
  /** The saved relays that are not defaults: the ones the reader added. Lists are read from these too. */
  extraRelays: () => string[];
  setRelays: (relays: string[]) => void;
  addRelay: (url: string) => void;
  removeRelay: (url: string) => void;
  resetRelays: () => void;
}

/** The part of the state that is saved. */
type SavedSettings = Partial<Pick<SettingsState, "relays">>;

/** The saved relays that are not defaults, normalized and deduped. */
export function extraRelays(relays: readonly string[]): string[] {
  const defaults = new Set<string>(DEFAULT_RELAYS);
  const extras: string[] = [];
  for (const url of relays) {
    const normalized = normalizeRelayUrl(url);
    if (!defaults.has(normalized) && !extras.includes(normalized)) extras.push(normalized);
  }
  return extras;
}

/**
 * Settings saved by an earlier Curate:
 *  - Version 1 still lists the retired relays. Reads wait for every relay, so a
 *    dead one would hold up every list. Drop them once; a reader who adds one
 *    back afterwards keeps it.
 *  - Every version up to 2 may hold a GrapeRank endpoint, which nothing reads
 *    now. It goes, so the saved state is only what the store still has.
 */
export function migrateSettings(persisted: unknown, version: number): SavedSettings {
  if (!persisted || typeof persisted !== "object") return {};
  const saved: Record<string, unknown> = { ...persisted };
  delete saved.wotEndpoint;
  if (!Array.isArray(saved.relays)) {
    delete saved.relays;
    return saved as SavedSettings;
  }
  if (version < 2) {
    const retired = new Set<string>(RETIRED_RELAYS);
    const kept = saved.relays.filter(
      (url): url is string => typeof url === "string" && !retired.has(normalizeRelayUrl(url))
    );
    saved.relays = kept.length ? kept : [...DEFAULT_RELAYS];
  }
  return saved as SavedSettings;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      relays: [...DEFAULT_RELAYS],
      extraRelays: () => extraRelays(get().relays),
      setRelays: (relays) =>
        set({
          relays: (relays.length ? relays : [...DEFAULT_RELAYS]).map(
            normalizeRelayUrl
          ),
        }),
      addRelay: (url) =>
        set((s) => {
          const next = normalizeRelayUrl(url);
          if (s.relays.includes(next)) return s;
          return { relays: [...s.relays, next] };
        }),
      removeRelay: (url) =>
        set((s) => {
          const filtered = s.relays.filter((r) => r !== url);
          return {
            relays: filtered.length ? filtered : [...DEFAULT_RELAYS],
          };
        }),
      resetRelays: () => set({ relays: [...DEFAULT_RELAYS] }),
    }),
    {
      name: "curate-settings",
      storage: createJSONStorage(() => safeStorage),
      version: 3,
      migrate: (persisted, version) => migrateSettings(persisted, version) as SettingsState,
    }
  )
);
