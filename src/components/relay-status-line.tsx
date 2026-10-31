"use client";

import { DCOSL, INDEX, TAG_HUB } from "@/services/relays";
import { useRelayStatus } from "@/stores/relay-status";

const NAMES: Record<string, string> = {
  [DCOSL]: "dcosl",
  [INDEX]: "the index",
  [TAG_HUB]: "the tag hub",
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A relay as a reader meets it: "the index (search.brainstorm.world)"; one with no name of ours is its host. */
const labelOf = (url: string): string => (NAMES[url] ? `${NAMES[url]} (${hostOf(url)})` : hostOf(url));

const joined = (names: string[]): string =>
  names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Names the relays that refused or didn't answer their last read.
 * The page carries on with the others; this says what it is missing. Nothing
 * shows while every relay asked has answered.
 */
export function RelayStatusLine() {
  const statuses = useRelayStatus((s) => s.statuses);
  const reasons = useRelayStatus((s) => s.reasons);

  const silent = Object.keys(statuses).filter((relay) => statuses[relay] !== "ok");
  if (silent.length === 0) return null;

  // Only the index answers COUNT and word search, so without it there are no counts.
  const missing = silent.includes(INDEX) ? ", so counts are missing" : "";
  const why = silent
    .filter((relay) => reasons[relay])
    .map((relay) => `${hostOf(relay)}: ${reasons[relay]}`)
    .join("\n");

  return (
    <p role="status" title={why || undefined} className="mt-4 text-[12px] leading-[1.5] text-mute">
      No answer from {joined(silent.map(labelOf))}. What&apos;s shown comes from the other relays{missing}.
    </p>
  );
}
