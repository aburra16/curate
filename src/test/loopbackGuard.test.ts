/** The socket guard in `setup.ts`, in the default (Node) environment most tests run in. */
import { describe, expect, it } from "vitest";
import { startLocalRelay } from "@/test/localRelay";

describe("the loopback guard", () => {
  it.each([
    "wss://dcosl.brainstorm.world",
    "wss://search.brainstorm.world",
    "ws://127.0.0.1.example.test",
    "ws://localhost.example.test:8080",
    "ws://example.test/127.0.0.1",
    "not an address",
  ])("refuses a socket to %s", (url) => {
    expect(() => new WebSocket(url)).toThrow(`tests may only open loopback sockets: ${url}`);
  });

  it("lets a socket open to a relay on loopback", async () => {
    const relay = await startLocalRelay();
    try {
      const socket = new WebSocket(relay.url);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("the loopback socket did not open"));
      });
      socket.close();
    } finally {
      await relay.close();
    }
  });
});
