"use client";

import { useEffect, useState } from "react";
import {
  fetchProfile,
  getCachedProfile,
  type ProfileMeta,
} from "@/services/profiles";

/**
 * Hook to fetch and cache profile metadata for a pubkey.
 * Returns the profile (or null while loading).
 */
export function useProfile(pubkey: string | undefined): ProfileMeta | null {
  // The last profile fetched from the relays, tagged with the pubkey it was
  // fetched for so that a stale result is never shown for a different pubkey.
  const [fetched, setFetched] = useState<{
    pubkey: string;
    profile: ProfileMeta | null;
  } | null>(null);

  useEffect(() => {
    if (!pubkey) return;

    // On a cache hit this resolves with the cached profile and makes no relay
    // request. Holding it in state keeps the profile on screen after the
    // cache entry expires.
    let cancelled = false;
    fetchProfile(pubkey).then((p) => {
      if (!cancelled) setFetched({ pubkey, profile: p });
    });

    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  if (!pubkey) return null;
  if (fetched?.pubkey === pubkey) return fetched.profile;
  return getCachedProfile(pubkey) ?? null;
}
