/**
 * Publishing a write. The event is signed once, then sent to the list relay
 * and to the author's own write relays, and each relay's answer is reported to
 * the relay status line.
 *
 * A write counts as saved only when the list relay accepted it: the author's
 * own relays make it easy to find elsewhere, but Curate reads it back from the
 * list relay. The index and the tag hub are never written to.
 */

import type { NostrEvent } from "nostr-tools";
import type { EventTemplate } from "@/lib/conceptCopy";
import { normalizeRelayUrl } from "@/lib/curate/relayUrls";
import type { PublishOutcome } from "@/lib/publishQuorum";
import { writeRelaysOf } from "@/services/outbox";
import { DCOSL, INDEX, relayKey, TAG_HUB } from "@/services/relays";
import { activeSigner, signTemplate } from "@/services/signer";
import { PUBLISH_TIMED_OUT, transport } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";

/** How long a relay has to answer a publish before it is counted as silent. */
export const PUBLISH_TIMEOUT_MS = 8_000;

/** How long the author's own relays have to answer once the list relay has. */
export const OWN_RELAY_GRACE_MS = 1_500;

/** What the person is told when a relay refused without saying why. */
const NO_REASON = "no reason given";

/** How a write went: the signed event and what each relay said. */
export interface PublishResult {
  event: NostrEvent;
  /** The list relay accepted the event. The write is saved only then. */
  onHub: boolean;
  /** The list relay's own words when it didn't accept; null when it did. */
  hubMessage: string | null;
  /** The relays that accepted the event. */
  accepted: string[];
  /** The relays that refused it, failed, or didn't answer in time, with their words. */
  failed: PublishOutcome[];
}

/** Relays a write never goes to: they have jobs of their own. */
const NOT_WRITTEN_TO = new Set([INDEX, TAG_HUB].map(relayKey));

const isHub = (relay: string): boolean => relayKey(relay) === relayKey(DCOSL);

/**
 * The relays a write goes to: the list relay first, then the author's own
 * `writeRelays`, each once. The index and the tag hub are never among them,
 * whatever the author's list holds.
 */
export function publishRelays(writeRelays: string[]): string[] {
  const relays: string[] = [];
  const seen = new Set<string>();
  for (const url of [DCOSL, ...writeRelays]) {
    const key = relayKey(url);
    if (seen.has(key) || NOT_WRITTEN_TO.has(key)) continue;
    seen.add(key);
    relays.push(normalizeRelayUrl(url));
  }
  return relays;
}

/** What a relay said when it didn't accept, in its own words. */
const wordsOf = (outcome: PublishOutcome): string => outcome.message || NO_REASON;

/** Tell the relay status line how one relay answered: `refusal` is null when it accepted. */
function reportAnswer(relay: string, refusal: PublishOutcome | null): void {
  const { report } = useRelayStatus.getState();
  if (!refusal) report(relay, { state: "eose" });
  else if (refusal.message === PUBLISH_TIMED_OUT) report(relay, { state: "timeout" });
  else report(relay, { state: "closed", reason: wordsOf(refusal) });
}

/** The result of a write from what the relays said by the time it was answered. */
function resultOf(event: NostrEvent, accepted: string[], failed: PublishOutcome[]): PublishResult {
  const onHub = accepted.some(isHub);
  const refusal = failed.find((outcome) => isHub(outcome.from));
  return { event, onHub, hubMessage: onHub ? null : refusal ? wordsOf(refusal) : NO_REASON, accepted, failed };
}

/** A relay's failure to publish in words, from a transport that threw instead of answering. */
const thrownBy = (relay: string, err: unknown): PublishOutcome => ({
  ok: false,
  from: relay,
  message: err instanceof Error ? err.message : String(err),
});

/**
 * Send the event to each relay and answer once the list relay has answered and
 * the others have had `OWN_RELAY_GRACE_MS` more, or every relay has answered,
 * or `PUBLISH_TIMEOUT_MS` has passed. When the list relay isn't asked, the
 * grace starts at once. A relay still silent then is in `failed` as timed out,
 * and its answer, whenever it comes, still goes to the relay status line.
 * Every refusal comes back with words, so the status line and the result read
 * the same.
 */
function sendTo(event: NostrEvent, relays: string[]): Promise<{ accepted: string[]; failed: PublishOutcome[] }> {
  return new Promise((resolve) => {
    const accepted: string[] = [];
    const failed: PublishOutcome[] = [];
    const silent = new Set(relays);
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      clearTimeout(grace);
      const timedOut = [...silent].map((from): PublishOutcome => ({ ok: false, from, message: PUBLISH_TIMED_OUT }));
      resolve({ accepted, failed: [...failed, ...timedOut] });
    };
    const startGrace = () => {
      grace ??= setTimeout(finish, OWN_RELAY_GRACE_MS);
    };
    const cap = setTimeout(finish, PUBLISH_TIMEOUT_MS);

    if (silent.size === 0) finish();
    else if (!relays.some(isHub)) startGrace();

    for (const relay of relays) {
      transport()
        .publish(relay, event, PUBLISH_TIMEOUT_MS)
        .catch((err: unknown) => thrownBy(relay, err))
        .then((outcome) => {
          const refusal = outcome.ok ? null : { ...outcome, from: relay, message: wordsOf(outcome) };
          reportAnswer(relay, refusal);
          if (done) return;
          silent.delete(relay);
          if (refusal) failed.push(refusal);
          else accepted.push(relay);
          if (silent.size === 0) finish();
          else if (isHub(relay)) startGrace();
        });
    }
  });
}

/**
 * Send an event that is already signed to the list relay and the author's own
 * `writeRelays`, and report what each said. Resolves once the list relay has
 * answered and the author's relays have had `OWN_RELAY_GRACE_MS` more (at once
 * when every relay has answered), or when `PUBLISH_TIMEOUT_MS` has passed.
 * Never rejects: a relay that fails or is still silent is in `failed`.
 */
export async function publishEvent(event: NostrEvent, writeRelays: string[]): Promise<PublishResult> {
  const { accepted, failed } = await sendTo(event, publishRelays(writeRelays));
  return resultOf(event, accepted, failed);
}

/**
 * Sign the template as the connected account and publish it. The author's
 * relays are read while the person is in their signer, so the read doesn't add
 * to the wait. Rejects with the `SignerError` when signing fails, and then
 * nothing is sent anywhere.
 */
export async function signAndPublish(template: EventTemplate): Promise<PublishResult> {
  const pubkey = activeSigner()?.pubkey;
  const ownRelays = pubkey ? writeRelaysOf(pubkey) : Promise.resolve<string[]>([]);
  const event = await signTemplate(template);
  return publishEvent(event, await ownRelays);
}

/**
 * Send the same signed event again to the relays that didn't take it, waiting
 * as `publishEvent` does, and report the whole write: relays that accepted it
 * before keep their place in `accepted` and are not asked again. The event is
 * never signed again.
 */
export async function retryPublish(result: PublishResult): Promise<PublishResult> {
  if (result.failed.length === 0) return result;
  const again = await sendTo(
    result.event,
    result.failed.map((outcome) => outcome.from),
  );
  return resultOf(result.event, [...result.accepted, ...again.accepted], again.failed);
}
