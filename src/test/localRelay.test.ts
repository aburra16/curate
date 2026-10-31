/** The local relay as a client sees it: what it keeps, what it removes, and what it sends on a subscription. */
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalRelay, type LocalRelay } from "@/test/localRelay";

const CURATOR = generateSecretKey();
const OTHER = generateSecretKey();

let relay: LocalRelay;
let sockets: WebSocket[] = [];

beforeEach(async () => {
  relay = await startLocalRelay();
});

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets = [];
  await relay.close();
});

/** A signed event as it travels, without the marks the signing library leaves on its own copy. */
const signed = (key: Uint8Array, kind: number, createdAt: number, tags: string[][] = []): NostrEvent =>
  JSON.parse(JSON.stringify(finalizeEvent({ kind, content: "", tags, created_at: createdAt }, key)));

/** A connection to the relay that hands back its messages in the order they came. */
async function connect() {
  const socket = new WebSocket(relay.url);
  sockets.push(socket);
  const inbox: unknown[][] = [];
  let wake: (() => void) | null = null;
  socket.onmessage = (message) => {
    inbox.push(JSON.parse(String(message.data)));
    wake?.();
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("the loopback socket did not open"));
  });
  return {
    send: (message: unknown[]) => socket.send(JSON.stringify(message)),
    async next(): Promise<unknown[]> {
      while (inbox.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      return inbox.shift()!;
    },
    /** Send the event and wait for the relay's answer to it. */
    async publish(event: NostrEvent): Promise<unknown[]> {
      this.send(["EVENT", event]);
      return this.next();
    },
  };
}

describe("a subscription", () => {
  it("gets what the relay holds, then EOSE, then what is kept later, until CLOSE", async () => {
    const client = await connect();
    const first = signed(CURATOR, 1, 100);
    const second = signed(CURATOR, 1, 200);
    const third = signed(CURATOR, 1, 300);

    expect(await client.publish(first)).toEqual(["OK", first.id, true, ""]);
    client.send(["REQ", "notes", { kinds: [1] }]);
    expect(await client.next()).toEqual(["EVENT", "notes", first]);
    expect(await client.next()).toEqual(["EOSE", "notes"]);

    client.send(["EVENT", second]);
    expect(await client.next()).toEqual(["EVENT", "notes", second]);
    expect(await client.next()).toEqual(["OK", second.id, true, ""]);

    client.send(["CLOSE", "notes"]);
    expect(await client.publish(third)).toEqual(["OK", third.id, true, ""]);
  });

  it("sends the newest first", async () => {
    const client = await connect();
    const older = signed(CURATOR, 1, 100);
    const newer = signed(CURATOR, 1, 200);
    await client.publish(older);
    await client.publish(newer);

    client.send(["REQ", "notes", { kinds: [1] }]);

    expect([(await client.next())[2], (await client.next())[2]]).toEqual([newer, older]);
  });
});

describe("an address", () => {
  const version = (createdAt: number) => signed(CURATOR, 39999, createdAt, [["d", "blue-door"]]);

  it("holds the newest version, whichever order they arrive in", async () => {
    const client = await connect();
    const older = version(100);
    const newer = version(200);

    await client.publish(newer);
    await client.publish(older);

    expect(relay.events().map((event) => event.id)).toEqual([newer.id]);
  });

  it("holds the lower id when two versions are as new as each other", async () => {
    const client = await connect();
    const [low, high] = [version(100), signed(CURATOR, 39999, 100, [["d", "blue-door"], ["x", "y"]])].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );

    await client.publish(high);
    await client.publish(low);

    expect(relay.events().map((event) => event.id)).toEqual([low.id]);
  });
});

describe("a deletion", () => {
  it("removes the events its author names by id, and keeps the deletion itself", async () => {
    const client = await connect();
    const note = signed(CURATOR, 1, 100);
    await client.publish(note);

    const deletion = signed(CURATOR, 5, 200, [["e", note.id]]);
    await client.publish(deletion);

    expect(relay.events().map((event) => event.id)).toEqual([deletion.id]);
  });

  it("removes the event at an address its author names", async () => {
    const client = await connect();
    const item = signed(CURATOR, 39999, 100, [["d", "blue-door"]]);
    await client.publish(item);

    await client.publish(signed(CURATOR, 5, 200, [["a", `39999:${item.pubkey}:blue-door`]]));

    expect(relay.events().map((event) => event.kind)).toEqual([5]);
  });

  it("leaves alone what another author's deletion names", async () => {
    const client = await connect();
    const item = signed(CURATOR, 39999, 100, [["d", "blue-door"]]);
    await client.publish(item);

    await client.publish(signed(OTHER, 5, 200, [["e", item.id], ["a", `39999:${item.pubkey}:blue-door`]]));

    expect(relay.events().map((event) => event.id)).toContain(item.id);
  });
});
