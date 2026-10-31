import type { AddressInfo } from "node:net";
import type { Filter, NostrEvent } from "nostr-tools";
import { matchFilters } from "nostr-tools/filter";
import { verifyEvent } from "nostr-tools/pure";
import { WebSocketServer, type WebSocket } from "ws";

/** A relay on loopback, for the tests that run the write path end to end. */
export interface LocalRelay {
  /** Where to reach it: `ws://127.0.0.1:` and the port it was given. */
  url: string;
  /** The events it holds now, in the order it took them. */
  events(): NostrEvent[];
  /** Close every connection and stop listening. */
  close(): Promise<void>;
}

/** Kinds a relay keeps one of per author and `d`: the newest. */
const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;

/** What the relay says to a signature that doesn't check out. */
const BAD_SIGNATURE = "invalid: bad signature";

/** An event's address: its kind, author and `d`. */
const addressOf = (event: NostrEvent): string =>
  `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === "d")?.[1] ?? ""}`;

/** Whether `a` replaces `b` at the same address: it is newer, or as new and has the lower id. */
const supersedes = (a: NostrEvent, b: NostrEvent): boolean =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

/** Whether the event's id and signature are right. One too malformed to check doesn't pass. */
function checks(event: NostrEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

/**
 * Start a relay on `127.0.0.1` at a port it is given. It speaks just enough of
 * the protocol to take a write and give it back:
 *
 *  - EVENT: an event whose signature fails is refused, "invalid: bad signature".
 *    Any other is kept (a kind 30000 to 39999 replaces the older event at its
 *    address) and accepted. A kind 5 also removes the events its author names
 *    in its `e` and `a` tags.
 *  - REQ: the events that match, newest first, then EOSE. The subscription
 *    stays open and gets what is kept later, until CLOSE.
 *
 * It holds events in memory and answers nothing else.
 */
export async function startLocalRelay(): Promise<LocalRelay> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const held = new Map<string, NostrEvent>();
  const open = new Map<WebSocket, Map<string, Filter[]>>();

  const send = (socket: WebSocket, message: unknown[]) => socket.send(JSON.stringify(message));

  /** The held events that match, newest first. */
  const matching = (filters: Filter[]): NostrEvent[] =>
    [...held.values()]
      .filter((event) => matchFilters(filters, event))
      .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));

  /** Remove what the deletion names, if it is the author's own. */
  function applyDeletion(deletion: NostrEvent): void {
    for (const tag of deletion.tags) {
      for (const event of [...held.values()]) {
        if (event.pubkey !== deletion.pubkey) continue;
        if ((tag[0] === "e" && event.id === tag[1]) || (tag[0] === "a" && addressOf(event) === tag[1])) {
          held.delete(event.id);
        }
      }
    }
  }

  /** Keep the event, and hand it to the subscriptions it matches. */
  function keep(event: NostrEvent): void {
    if (held.has(event.id)) return;
    if (isAddressable(event.kind)) {
      const older = [...held.values()].find((other) => other.kind === event.kind && addressOf(other) === addressOf(event));
      if (older && !supersedes(event, older)) return;
      if (older) held.delete(older.id);
    }
    held.set(event.id, event);
    if (event.kind === 5) applyDeletion(event);

    for (const [socket, subs] of open) {
      for (const [subId, filters] of subs) {
        if (matchFilters(filters, event)) send(socket, ["EVENT", subId, event]);
      }
    }
  }

  server.on("connection", (socket) => {
    const subs = new Map<string, Filter[]>();
    open.set(socket, subs);
    socket.on("close", () => open.delete(socket));

    socket.on("message", (data) => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;
      const [type, ...rest] = message;

      if (type === "EVENT") {
        const event = rest[0] as NostrEvent;
        if (!checks(event)) {
          send(socket, ["OK", event?.id ?? "", false, BAD_SIGNATURE]);
          return;
        }
        keep(event);
        send(socket, ["OK", event.id, true, ""]);
      } else if (type === "REQ") {
        const [subId, ...filters] = rest as [string, ...Filter[]];
        subs.set(subId, filters);
        for (const event of matching(filters)) send(socket, ["EVENT", subId, event]);
        send(socket, ["EOSE", subId]);
      } else if (type === "CLOSE") {
        subs.delete(rest[0] as string);
      }
    });
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    events: () => [...held.values()],
    close: async () => {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
