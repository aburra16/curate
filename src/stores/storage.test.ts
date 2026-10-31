// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PUBKEY = "ab".repeat(32);

/** localStorage as a browser with storage blocked or full gives it: present, and every call throws. */
function throwingStorage() {
  const fail = () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ["the signer store", () => import("@/stores/signer").then((m) => m.useSigner)],
  ["the settings store", () => import("@/stores/settings").then((m) => m.useSettings)],
])("%s without working storage", (_name, load) => {
  it("loads when every localStorage call throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());

    const store = await load();

    expect(store.getState()).toBeDefined();
  });

  it("loads when merely reaching localStorage throws", async () => {
    // Safari with all cookies blocked refuses the property itself.
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    const store = await load();

    expect(store.getState()).toBeDefined();
  });
});

describe("the signer store without working storage", () => {
  it("still connects and disconnects when saving throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const { useSigner } = await import("@/stores/signer");

    expect(() => useSigner.getState().setConnected(PUBKEY, "extension")).not.toThrow();
    expect(useSigner.getState()).toMatchObject({ pubkey: PUBKEY, status: "connected" });

    expect(() => useSigner.getState().setDisconnected()).not.toThrow();
    expect(useSigner.getState()).toMatchObject({ pubkey: null, status: "disconnected" });
  });

  it("still connects when the property itself refuses", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const { useSigner } = await import("@/stores/signer");

    expect(() => useSigner.getState().setConnected(PUBKEY, "extension")).not.toThrow();
    expect(useSigner.getState().pubkey).toBe(PUBKEY);
  });

  it("remembers the last pubkey in working storage", async () => {
    const { useSigner } = await import("@/stores/signer");

    useSigner.getState().setConnected(PUBKEY, "extension");

    expect(JSON.parse(localStorage.getItem("curate-signer") ?? "{}")).toMatchObject({ state: { pubkey: PUBKEY } });
  });

  it("does not remember how the signer signed", async () => {
    const { useSigner } = await import("@/stores/signer");

    useSigner.getState().setConnected(PUBKEY, "extension");

    expect(JSON.parse(localStorage.getItem("curate-signer") ?? "{}").state).not.toHaveProperty("method");
  });
});

describe("the settings store without working storage", () => {
  it("still adds a relay when saving throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const { useSettings } = await import("@/stores/settings");

    expect(() => useSettings.getState().addRelay("wss://mine.example.test")).not.toThrow();
    expect(useSettings.getState().relays).toContain("wss://mine.example.test");
  });
});
