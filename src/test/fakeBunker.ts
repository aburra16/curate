import type { NostrConnectSignerOptions, PrivateKeySigner } from "applesauce-signers";
import { createBunkerURI, parseNostrConnectURI } from "applesauce-signers/helpers/nostr-connect";
import type { Filter, NostrEvent } from "nostr-tools";
import { matchFilters } from "nostr-tools/filter";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { Observable, type Subscriber } from "rxjs";

/** The kind NIP-46 requests and answers travel in. */
const NOSTR_CONNECT = 24133;

/** Where the bunker says it can be reached. Never opened: `methods` carry everything. */
const BUNKER_RELAY = "wss://bunker.example.test";

const BUNKER_SECRET = "bunker-secret";

/** What a remote signer is handed in place of a relay pool. */
export type BunkerMethods = Required<Pick<NostrConnectSignerOptions, "subscriptionMethod" | "publishMethod">>;

export interface FakeBunker {
  /** Pass these to the remote signer service so it talks to this bunker and to no relay. */
  methods: BunkerMethods;
  /** The method of every request the bunker received, in order, answered or not. */
  requests: string[];
  /** A `bunker://` link to this bunker, with its secret. */
  bunkerUri(): string;
  /**
   * Answer a `nostrconnect://` code the way a signer app does once its owner
   * scans it: with the code's secret, or with `answer` when one is given.
   */
  pair(nostrconnectUri: string, answer?: string): void;
  /**
   * Answer the next request first with `url` as an approval link (NIP-46
   * `auth_url`), then, as if its owner approved at once, with the result.
   */
  askApproval(url: string): void;
  /** Stop answering. Requests are still received and logged. */
  silence(): void;
}

type Answer = { result: string } | { error: string } | { result: "auth_url"; error: string };

/**
 * A remote signer (NIP-46) for tests, holding `userSigner` as the person's
 * key. It has a key of its own for talking to clients, as real bunkers do, and
 * answers over an in-memory relay, so no socket is opened. The relay keeps what
 * the bunker sends and hands it to each new subscription, so an answer sent
 * before the client has subscribed still reaches it.
 */
export function fakeBunker(userSigner: PrivateKeySigner): FakeBunker {
  const key = generateSecretKey();
  const remote = getPublicKey(key);
  const requests: string[] = [];
  const sent: NostrEvent[] = [];
  const listeners = new Set<{ filters: Filter[]; subscriber: Subscriber<NostrEvent> }>();
  let silent = false;
  let approval: string | null = null;

  function deliver(event: NostrEvent): void {
    sent.push(event);
    for (const { filters, subscriber } of listeners) {
      if (matchFilters(filters, event)) subscriber.next(event);
    }
  }

  /** Send `body` to `client`, encrypted to it with NIP-44. */
  function reply(client: string, body: { id: string } & Answer): void {
    const content = nip44.encrypt(JSON.stringify(body), nip44.getConversationKey(key, client));
    const created_at = Math.floor(Date.now() / 1000);
    deliver(finalizeEvent({ kind: NOSTR_CONNECT, created_at, tags: [["p", client]], content }, key));
  }

  async function answerOf(method: string, params: string[]): Promise<Answer> {
    switch (method) {
      case "connect":
        return { result: "ack" };
      case "get_public_key":
        return { result: await userSigner.getPublicKey() };
      case "sign_event":
        return { result: JSON.stringify(await userSigner.signEvent(JSON.parse(params[0]))) };
      default:
        return { error: `${method} is not supported` };
    }
  }

  async function receive(request: NostrEvent): Promise<void> {
    if (request.kind !== NOSTR_CONNECT) return;
    if (!request.tags.some((tag) => tag[0] === "p" && tag[1] === remote)) return;
    const plaintext = nip44.decrypt(request.content, nip44.getConversationKey(key, request.pubkey));
    const { id, method, params } = JSON.parse(plaintext) as { id: string; method: string; params: string[] };
    requests.push(method);
    if (silent) return;
    if (approval !== null) {
      reply(request.pubkey, { id, result: "auth_url", error: approval });
      approval = null;
    }
    reply(request.pubkey, { id, ...(await answerOf(method, params)) });
  }

  const methods: BunkerMethods = {
    subscriptionMethod: (_relays, filters) =>
      new Observable<NostrEvent>((subscriber) => {
        const listener = { filters: filters as Filter[], subscriber };
        listeners.add(listener);
        for (const event of sent) if (matchFilters(listener.filters, event)) subscriber.next(event);
        return () => listeners.delete(listener);
      }),
    publishMethod: async (_relays, event) => {
      void receive(event);
    },
  };

  return {
    methods,
    requests,
    bunkerUri: () => createBunkerURI({ remote, relays: [BUNKER_RELAY], secret: BUNKER_SECRET }),
    pair(nostrconnectUri, answer) {
      const { client, secret } = parseNostrConnectURI(nostrconnectUri);
      reply(client, { id: "pairing", result: answer ?? secret });
    },
    askApproval(url) {
      approval = url;
    },
    silence() {
      silent = true;
    },
  };
}
