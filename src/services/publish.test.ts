/**
 * Publishing a write: the list relay and the author's own relays are asked,
 * each answer is reported, and the write counts as saved only when the list
 * relay took it.
 */
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSeenOn } from "@/services/nostr";
import { clearOutboxCache } from "@/services/outbox";
import { PUBLISH_TIMEOUT_MS, publishEvent, publishRelays, retryPublish, signAndPublish } from "@/services/publish";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import * as signerModule from "@/services/signer";
import { activate, disconnect, SignerError } from "@/services/signer";
import { setTransport, type RelayTransport } from "@/services/transport";
import { fakeTransport, type FakeRelay, type FakeTransport } from "@/test/fakeTransport";
import { useRelayStatus } from "@/stores/relay-status";

const SECRET = generateSecretKey();
const CURATOR = { sk: SECRET, pk: getPublicKey(SECRET), signer: new PrivateKeySigner(SECRET) };

const OWN_A = "wss://own-a.example.test";
const OWN_B = "wss://own-b.example.test";

const NOTE: EventTemplate = { kind: 1, content: "hello", tags: [["t", "reading"]], created_at: 0 };

const accepts: FakeRelay = { events: [], end: { state: "eose" }, accept: { ok: true } };
const refuses = (message: string): FakeRelay => ({
  events: [],
  end: { state: "eose" },
  accept: { ok: false, message },
});

/** The profile relays, all answering with the curator's own relay list. */
function profileRelays(...relays: string[]): Record<string, FakeRelay> {
  const list = finalizeEvent(
    { kind: 10002, created_at: 1_792_000_000, content: "", tags: relays.map((relay) => ["r", relay]) },
    CURATOR.sk,
  ) as NostrEvent;
  return Object.fromEntries(PROFILE_RELAYS.map((relay) => [relay, { events: [list], end: { state: "eose" } }]));
}

/** An event already signed, for the tests that publish without the signer. */
const signed = (): NostrEvent => finalizeEvent({ ...NOTE, created_at: 1_792_000_000 }, CURATOR.sk) as NostrEvent;

/** The fake transport in use, and a count of the reads that reach it. */
function watching(script: Record<string, FakeRelay>): { transport: FakeTransport; reads: () => number } {
  const inner = fakeTransport(script);
  let reads = 0;
  const transport: FakeTransport = {
    ...inner,
    req(relay, filters, onEvent, timeoutMs) {
      reads += 1;
      return inner.req(relay, filters, onEvent, timeoutMs);
    },
  };
  setTransport(transport);
  return { transport, reads: () => reads };
}

beforeEach(() => {
  useRelayStatus.getState().reset();
  clearSeenOn();
  clearOutboxCache();
  activate(CURATOR.signer, "extension", CURATOR.pk);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await disconnect();
});

describe("publishRelays", () => {
  it("names the list relay first, then the author's relays, each once", () => {
    expect(publishRelays([OWN_A, "wss://OWN-A.example.test/", OWN_B, DCOSL])).toEqual([DCOSL, OWN_A, OWN_B]);
  });

  it("is the list relay alone when the author has none of their own", () => {
    expect(publishRelays([])).toEqual([DCOSL]);
  });

  it("never names the index or the tag hub", () => {
    const relays = publishRelays([
      INDEX,
      "wss://search.brainstorm.world/",
      TAG_HUB,
      "WSS://TAGS.brainstorm.world/relay/",
      OWN_A,
    ]);

    expect(relays).toEqual([DCOSL, OWN_A]);
  });
});

describe("signAndPublish", () => {
  it("is saved when dcosl accepts, with your own relays' failures noted", async () => {
    const { transport } = watching({
      ...profileRelays(OWN_A, OWN_B),
      [DCOSL]: accepts,
      [OWN_A]: accepts,
      [OWN_B]: refuses("rate-limited: slow down"),
    });

    const result = await signAndPublish(NOTE);

    expect(result.onHub).toBe(true);
    expect(result.hubMessage).toBeNull();
    expect([...result.accepted].sort()).toEqual([DCOSL, OWN_A].sort());
    expect(result.failed).toEqual([{ ok: false, from: OWN_B, message: "rate-limited: slow down" }]);
    expect(result.event.pubkey).toBe(CURATOR.pk);
    for (const relay of [DCOSL, OWN_A, OWN_B]) {
      expect(transport.published[relay]).toEqual([result.event]);
    }
    expect(Object.keys(transport.published).sort()).toEqual([DCOSL, OWN_A, OWN_B].sort());

    const { statuses, reasons } = useRelayStatus.getState();
    expect(statuses[DCOSL]).toBe("ok");
    expect(statuses[OWN_A]).toBe("ok");
    expect(statuses[OWN_B]).toBe("closed");
    expect(reasons[OWN_B]).toBe("rate-limited: slow down");
  });

  it("is not saved when dcosl refuses, in its words", async () => {
    const { transport } = watching({
      ...profileRelays(OWN_A),
      [DCOSL]: refuses("blocked: not allowed"),
      [OWN_A]: accepts,
    });

    const result = await signAndPublish(NOTE);

    expect(result.onHub).toBe(false);
    expect(result.hubMessage).toBe("blocked: not allowed");
    expect(result.accepted).toEqual([OWN_A]);
    expect(result.failed).toEqual([{ ok: false, from: DCOSL, message: "blocked: not allowed" }]);
    expect(transport.published[OWN_A]).toEqual([result.event]);
    expect(useRelayStatus.getState().statuses[DCOSL]).toBe("closed");
    expect(useRelayStatus.getState().reasons[DCOSL]).toBe("blocked: not allowed");
  });

  it("is not saved when dcosl refuses without a reason, and says so in plain words", async () => {
    watching({ ...profileRelays(), [DCOSL]: refuses("") });

    const result = await signAndPublish(NOTE);

    expect(result.onHub).toBe(false);
    expect(result.hubMessage).toBe("no reason given");
  });

  it("asks for the author's relays while the signer is open", async () => {
    let finishSigning: () => void = () => {};
    const slow: ISigner = {
      getPublicKey: () => CURATOR.signer.getPublicKey(),
      signEvent: (template) =>
        new Promise((resolve) => {
          finishSigning = () => resolve(CURATOR.signer.signEvent(template));
        }),
    };
    activate(slow, "remote", CURATOR.pk);
    const { reads } = watching({ ...profileRelays(OWN_A), [DCOSL]: accepts, [OWN_A]: accepts });

    const pending = signAndPublish(NOTE);
    await vi.waitFor(() => expect(reads()).toBeGreaterThan(0));
    finishSigning();
    const result = await pending;

    expect(result.accepted.sort()).toEqual([DCOSL, OWN_A].sort());
  });

  it("publishes nothing when the signature is refused", async () => {
    const refusing: ISigner = {
      getPublicKey: () => CURATOR.signer.getPublicKey(),
      signEvent: () => Promise.reject(new Error("User rejected the request")),
    };
    activate(refusing, "extension", CURATOR.pk);
    const { transport } = watching({ ...profileRelays(OWN_A), [DCOSL]: accepts, [OWN_A]: accepts });

    const err = await signAndPublish(NOTE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SignerError);
    expect((err as SignerError).reason).toBe("refused");
    expect(transport.published).toEqual({});
    expect(useRelayStatus.getState().statuses[DCOSL]).toBeUndefined();
  });

  it("publishes nothing when no signer is connected", async () => {
    await disconnect();
    const { transport } = watching({ ...profileRelays(OWN_A), [DCOSL]: accepts, [OWN_A]: accepts });

    const err = await signAndPublish(NOTE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SignerError);
    expect((err as SignerError).reason).toBe("not-connected");
    expect(transport.published).toEqual({});
  });
});

describe("publishEvent", () => {
  it("is not saved when dcosl is silent, once the wait is over", async () => {
    vi.useFakeTimers();
    const { transport } = watching({
      [DCOSL]: { events: [], end: { state: "eose" }, accept: { ok: true }, delayMs: PUBLISH_TIMEOUT_MS * 4 },
      [OWN_A]: accepts,
    });
    const event = signed();
    let result: Awaited<ReturnType<typeof publishEvent>> | undefined;
    const pending = publishEvent(event, [OWN_A]).then((r) => (result = r));

    await vi.advanceTimersByTimeAsync(PUBLISH_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(result?.onHub).toBe(false);
    expect(result?.hubMessage).toBe("timed out");
    expect(result?.accepted).toEqual([OWN_A]);
    expect(transport.published[DCOSL]).toEqual([event]);
    expect(useRelayStatus.getState().statuses[DCOSL]).toBe("timeout");
    expect(useRelayStatus.getState().statuses[OWN_A]).toBe("ok");
  });

  it("sends to the list relay alone when the author has no relays of their own", async () => {
    const { transport } = watching({ [DCOSL]: accepts });
    const event = signed();

    const result = await publishEvent(event, []);

    expect(result).toEqual({ event, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] });
    expect(Object.keys(transport.published)).toEqual([DCOSL]);
  });

  it("never sends to the index or the tag hub", async () => {
    const { transport } = watching({ [DCOSL]: accepts, [OWN_A]: accepts, [INDEX]: accepts, [TAG_HUB]: accepts });

    await publishEvent(signed(), [INDEX, OWN_A, TAG_HUB]);

    expect(Object.keys(transport.published).sort()).toEqual([DCOSL, OWN_A].sort());
  });

  it("reports a relay that was unreachable as refused, in the transport's words", async () => {
    const down: RelayTransport = {
      ...fakeTransport({}),
      publish: async (relay) => ({ ok: false, from: relay, message: "the connection failed" }),
    };
    setTransport(down);

    const result = await publishEvent(signed(), []);

    expect(result.onHub).toBe(false);
    expect(result.hubMessage).toBe("the connection failed");
    expect(useRelayStatus.getState().statuses[DCOSL]).toBe("closed");
    expect(useRelayStatus.getState().reasons[DCOSL]).toBe("the connection failed");
  });
});

describe("retryPublish", () => {
  it("resends the same event to the relays that failed, without signing again", async () => {
    const signTemplate = vi.spyOn(signerModule, "signTemplate");
    const script: Record<string, FakeRelay> = {
      ...profileRelays(OWN_A),
      [DCOSL]: refuses("blocked: not allowed"),
      [OWN_A]: accepts,
    };
    const { transport } = watching(script);

    const first = await signAndPublish(NOTE);
    expect(first.onHub).toBe(false);
    script[DCOSL] = accepts;
    const second = await retryPublish(first);

    expect(signTemplate).toHaveBeenCalledTimes(1);
    expect(second.event.id).toBe(first.event.id);
    expect(second.event.sig).toBe(first.event.sig);
    expect(transport.published[DCOSL]).toHaveLength(2);
    expect(transport.published[DCOSL].map((ev) => [ev.id, ev.sig])).toEqual([
      [first.event.id, first.event.sig],
      [first.event.id, first.event.sig],
    ]);
    // The relay that took it the first time is not asked again.
    expect(transport.published[OWN_A]).toHaveLength(1);
    expect(second.onHub).toBe(true);
    expect(second.hubMessage).toBeNull();
    expect([...second.accepted].sort()).toEqual([DCOSL, OWN_A].sort());
    expect(second.failed).toEqual([]);
    expect(useRelayStatus.getState().statuses[DCOSL]).toBe("ok");
  });

  it("stays not saved, with dcosl's new words, when it refuses again", async () => {
    const script: Record<string, FakeRelay> = { [DCOSL]: refuses("blocked: not allowed") };
    watching(script);
    const first = await publishEvent(signed(), []);
    script[DCOSL] = refuses("rate-limited: slow down");

    const second = await retryPublish(first);

    expect(second.onHub).toBe(false);
    expect(second.hubMessage).toBe("rate-limited: slow down");
    expect(second.failed).toEqual([{ ok: false, from: DCOSL, message: "rate-limited: slow down" }]);
  });

  it("sends nothing when every relay already took the event", async () => {
    const { transport } = watching({ [DCOSL]: accepts, [OWN_A]: accepts });
    const first = await publishEvent(signed(), [OWN_A]);

    const second = await retryPublish(first);

    expect(second).toEqual(first);
    expect(transport.published[DCOSL]).toHaveLength(1);
    expect(transport.published[OWN_A]).toHaveLength(1);
  });
});
