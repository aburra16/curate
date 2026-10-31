import { afterEach } from "vitest";

// Component tests opt in to jsdom with `// @vitest-environment jsdom`.
// Vitest runs without globals, so Testing Library cannot register its own
// cleanup; unmount rendered trees after each test.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
