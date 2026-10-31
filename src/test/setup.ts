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

  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
