"use client";

import { useEffect } from "react";
import { setRelayUrls } from "@/lib/nostr/ndk";
import { useSettings } from "@/stores/settings";

/**
 * Puts the relays saved in Settings into the pool at start. Before this, the
 * pool began from the defaults on every load and only the Settings page ever
 * passed it the saved set, so saved relays were lost on reload.
 */
export function SavedRelays() {
  useEffect(() => {
    setRelayUrls([...useSettings.getState().relays]);
  }, []);
  return null;
}
