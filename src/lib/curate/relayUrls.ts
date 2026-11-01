/**
 * Default relay set for Curate. `dcosl.brainstorm.world` is Tapestry's primary
 * DList relay and the lists we want to discover live there.
 *
 * `relay.nostr.band` (dead) and `relay.damus.io` (not answering on 31 October
 * 2026) are retired.
 */
export const DEFAULT_RELAYS = [
  "wss://dcosl.brainstorm.world",
  "wss://relay.primal.net",
  "wss://nos.lol",
] as const;

/** Defaults that earlier versions saved into Settings and have since been retired. */
export const RETIRED_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
] as const;

export type RelayUrl = string;

const WSS_RE = /^wss:\/\/[^\s]+$/i;

export function isValidRelayUrl(url: string): boolean {
  return WSS_RE.test(url.trim());
}

export function normalizeRelayUrl(url: string): string {
  const trimmed = url.trim();
  // Strip trailing slash for consistent identity.
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
