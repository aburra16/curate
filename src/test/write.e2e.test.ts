// @vitest-environment jsdom
/**
 * The write path from the signer to the relay and back: a list, an item, an
 * edit, a vote and a deletion, signed by a page extension, sent through the
 * real pool transport to a relay on loopback, and read back from it. The
 * guard in `src/test/setup.ts` keeps every other socket closed.
 */
import { PrivateKeySigner } from "applesauce-signers";
import type { EventTemplate as StampedTemplate, Filter, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventTemplate } from "@/lib/conceptCopy";
import { definitionOf } from "@/lib/conceptResolution";
import { newListTemplate, type QuickList } from "@/lib/curate/newList";
import { deletionTemplate, editedItemTemplate, voteTemplate } from "@/lib/curate/writeTemplates";
import { checkHeader, checkItemUnder, type Problem } from "@/lib/listCheck";
import { itemTemplate } from "@/lib/listItem";
import { getPool } from "@/lib/nostr/ndk";
import { readRelays } from "@/services/nostr";
import { publishEvent, signAndPublish, type PublishResult } from "@/services/publish";
import { INDEX, TAG_HUB } from "@/services/relays";
import { activeSigner, connectExtension, disconnect } from "@/services/signer";
import { transport } from "@/services/transport";

// The relay starts before the mock below is built, so the services see its
// address as the list relay from the first import.
const relay = await vi.hoisted(async () => {
  const { startLocalRelay } = await import("@/test/localRelay");
  return startLocalRelay();
});

vi.mock("@/services/relays", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/relays")>();
  return { ...original, DCOSL: relay.url, PROFILE_RELAYS: [relay.url], listRelays: () => [relay.url] };
});

const CURATOR_KEY = generateSecretKey();
const CURATOR = new PrivateKeySigner(CURATOR_KEY);

const CAFES: QuickList = {
  singular: "Café",
  plural: "Cafés",
  description: "Places for a coffee",
  fields: [
    { name: "name", type: "text", requirement: "required", description: "What it is called" },
    { name: "website", type: "url", requirement: "recommended", description: "" },
  ],
};

const SHORT_NAME = "cafes";
const MENU = "https://bluedoor.example.test/menu";

type Page = { nostr?: unknown };

/** What a signer extension puts on the page, signing as the curator. */
function installExtension(): void {
  (window as unknown as Page).nostr = {
    getPublicKey: () => CURATOR.getPublicKey(),
    signEvent: (template: StampedTemplate) => CURATOR.signEvent(template),
  };
}

/** Move the clock on a second: events signed in the same second share a time, and the relay then keeps the lowest id. */
function nextSecond(): void {
  vi.setSystemTime(Date.now() + 1000);
}

const read = (filter: Filter): Promise<NostrEvent[]> => readRelays([relay.url], [filter]);

/** The ids of what the relay returns for the filter. */
const idsRead = async (filter: Filter): Promise<string[]> => (await read(filter)).map((event) => event.id);

const tagsNamed = (event: NostrEvent, name: string): string[][] => event.tags.filter((tag) => tag[0] === name);

/**
 * What the checks say about a written event, apart from the `client` tag: the
 * form never sets it, so a check of the tags notes it, and only notes it.
 */
const problemsBesidesClient = (problems: Problem[]): Problem[] =>
  problems.filter((problem) => !(problem.code === "dropped-tag" && problem.message.startsWith('["client","Curate"]')));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  installExtension();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as Page).nostr;
  await disconnect();
});

afterAll(async () => {
  const pool = getPool();
  pool.remove(pool.relay(relay.url));
  await relay.close();
});

describe("the loopback guard", () => {
  it("refuses a socket to a public relay", () => {
    expect(() => new WebSocket("wss://dcosl.brainstorm.world")).toThrow(
      "tests may only open loopback sockets: wss://dcosl.brainstorm.world",
    );
    expect(() => new WebSocket(INDEX)).toThrow("tests may only open loopback sockets");
    expect(() => new WebSocket(TAG_HUB)).toThrow("tests may only open loopback sockets");
  });
});

describe("writing to a relay on loopback", () => {
  it("makes a list, adds an item, edits it, votes on it and deletes it", async () => {
    const reached = [
      vi.spyOn(transport(), "req"),
      vi.spyOn(transport(), "count"),
      vi.spyOn(transport(), "live"),
      vi.spyOn(transport(), "publish"),
    ];
    const results: PublishResult[] = [];
    const write = async (template: EventTemplate): Promise<NostrEvent> => {
      const result = await signAndPublish(template);
      results.push(result);
      return result.event;
    };

    const pubkey = await connectExtension();
    expect(pubkey).toBe(getPublicKey(CURATOR_KEY));
    expect(activeSigner()).toEqual({ method: "extension", pubkey });

    // The list, read back from the relay, is the definition the item is made under.
    const published = await write(newListTemplate(CAFES, SHORT_NAME, pubkey));
    const [header] = await read({ kinds: [39998], authors: [pubkey], "#d": [SHORT_NAME] });
    expect(header.id).toBe(published.id);
    const list = definitionOf(header);
    expect([list.singular, list.plural]).toEqual(["Café", "Cafés"]);
    expect(list.fields.map((field) => field.name)).toEqual(["name", "website"]);

    // An item under it.
    nextSecond();
    const item = await write(itemTemplate(list, { name: "Blue Door", website: "https://bluedoor.example.test" }, "0a1b2c3d"));
    expect(await idsRead({ kinds: [39999], authors: [pubkey] })).toEqual([item.id]);

    // Its edit replaces it at the same address.
    nextSecond();
    const edit = await write(editedItemTemplate(item, { website: MENU }));
    const held = await read({ kinds: [39999], authors: [pubkey] });
    expect(held.map((event) => event.id)).toEqual([edit.id]);
    expect(tagsNamed(held[0], "website")).toEqual([["website", MENU]]);

    // A vote on the edit.
    nextSecond();
    const vote = await write(voteTemplate(edit, "+"));
    expect(await idsRead({ kinds: [7], "#e": [edit.id] })).toEqual([vote.id]);

    // Everything held so far carries Curate's tag once, and passes the checks the lists are held to.
    const heldNow = relay.events();
    expect(heldNow.map((event) => event.id).sort()).toEqual([header.id, edit.id, vote.id].sort());
    for (const event of heldNow) expect(tagsNamed(event, "client")).toEqual([["client", "Curate"]]);
    expect(problemsBesidesClient(checkHeader(header.tags).problems)).toEqual([]);
    expect(problemsBesidesClient(checkItemUnder(list, edit.tags, new Map()).problems)).toEqual([]);

    // Deleting the item takes every version of it from the relay.
    nextSecond();
    const deletion = await write(deletionTemplate(edit, [item.id, edit.id]));
    expect(await idsRead({ kinds: [39999] })).toEqual([]);
    expect(await idsRead({ ids: [item.id, edit.id] })).toEqual([]);
    expect(relay.events().map((event) => event.id).sort()).toEqual([header.id, vote.id, deletion.id].sort());
    for (const event of relay.events()) expect(tagsNamed(event, "client")).toEqual([["client", "Curate"]]);

    // Each write was saved on the list relay, and only the local relay was ever asked.
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.onHub).toBe(true);
      expect(result.hubMessage).toBeNull();
      expect(result.failed).toEqual([]);
      expect(result.accepted).toEqual([relay.url]);
    }
    const asked = new Set(reached.flatMap((spy) => spy.mock.calls.map(([url]) => url)));
    expect([...asked]).toEqual([relay.url]);
    expect(asked.has(INDEX)).toBe(false);
    expect(asked.has(TAG_HUB)).toBe(false);
  });

  it("tells the person in the relay's words when it refuses an event", async () => {
    const forged = finalizeEvent(
      { kind: 1, content: "hello", tags: [["client", "Curate"]], created_at: 1_792_000_000 },
      CURATOR_KEY,
    );
    const tampered: NostrEvent = { ...forged, content: "changed after signing" };

    const result = await publishEvent(tampered, []);

    expect(result.onHub).toBe(false);
    expect(result.hubMessage).toBe("invalid: bad signature");
    expect(relay.events().map((event) => event.id)).not.toContain(tampered.id);
  });
});
