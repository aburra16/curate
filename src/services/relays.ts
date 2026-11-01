/**
 * The relays Curate reads, each with one job.
 *
 *  - DCOSL: the hub. Headers, items and URL templates.
 *  - INDEX: the search index. Read in parallel with DCOSL, and the only relay
 *    that answers COUNT. It refuses a filter that carries no NIP-50 `search`.
 *  - TAG_HUB: where URL templates are also filed.
 *  - PROFILE_RELAYS: kind 0 profiles.
 */

import { normalizeRelayUrl } from "@/lib/curate/relayUrls";
import { useSettings } from "@/stores/settings";

export const DCOSL = "wss://dcosl.brainstorm.world";
export const INDEX = "wss://search.brainstorm.world";
export const TAG_HUB = "wss://tags.brainstorm.world/relay";
export const PROFILE_RELAYS = [
  "wss://purplepag.es",
  "wss://nos.lol",
  "wss://relay.primal.net",
] as const;

/** A relay's identity for comparing: scheme and host are case-blind, and a trailing slash is nothing. */
export function relayKey(url: string): string {
  const trimmed = normalizeRelayUrl(url);
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/** Relays with a job of their own. A list read never goes to them as an extra, whatever the reader saved. */
const OWN_JOB = new Set([INDEX, TAG_HUB].map(relayKey));

/**
 * The relays a list read goes to besides the index: DCOSL, then the relays the
 * reader added in Settings, each once. The index and the tag hub are never
 * among them: the index refuses a read without its search token, and both are
 * read on their own terms where they are wanted.
 */
export function listRelays(): string[] {
  const relays = [DCOSL, ...useSettings.getState().extraRelays()];
  const seen = new Set<string>();
  return relays.map(normalizeRelayUrl).filter((url) => {
    if (seen.has(url) || OWN_JOB.has(relayKey(url))) return false;
    seen.add(url);
    return true;
  });
}
