import { afterEach } from "vitest";

// Component tests opt in to jsdom with `// @vitest-environment jsdom`.
// Vitest runs without globals, so Testing Library cannot register its own
// cleanup; unmount rendered trees after each test.
if (typeof document !== "undefined") {
  // The signing library keeps its own, older copy of the hashing code, which
  // checks `instanceof Uint8Array`. jsdom's `Uint8Array` is not the one
  // `TextEncoder` makes, so under jsdom it rejects what it hashes. A browser has
  // one `Uint8Array`, so only the tests need this.
  const Encoder = globalThis.TextEncoder;
  globalThis.TextEncoder = class extends Encoder {
    encode(input?: string) {
      return new Uint8Array(super.encode(input));
    }
  };

  // jsdom's `WebSocket` cannot open under the test runner: the socket builds
  // its events from the global `Event`, which here is jsdom's, and dispatches
  // them on a Node `EventTarget`, which refuses them. The `ws` client keeps its
  // own event classes, so a page test that reaches a relay on loopback uses it
  // as the page's `WebSocket`.
  const { WebSocket: LoopbackClient } = await import("ws");
  globalThis.WebSocket = LoopbackClient as unknown as typeof WebSocket;

  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}

// A test never reaches a public relay. Whichever `WebSocket` this environment
// has is wrapped so that a socket to any host but loopback throws before it
// opens. A test that needs a relay starts one on `127.0.0.1`
// (`src/test/localRelay.ts`).
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The host of a socket address, or null when it isn't an address at all. */
function hostOf(url: string | URL): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const OpenSocket = globalThis.WebSocket;
if (OpenSocket) {
  globalThis.WebSocket = class LoopbackSocket extends OpenSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const host = hostOf(url);
      if (host === null || !LOOPBACK_HOSTS.has(host)) {
        throw new Error(`tests may only open loopback sockets: ${url}`);
      }
      super(url, protocols);
    }
  };
}
