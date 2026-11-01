// @vitest-environment jsdom
/** Connecting and disconnecting from the page: the store follows, whatever the signer does. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/remoteSigner", () => ({
  startPairing: vi.fn(),
  connectBunker: vi.fn(),
  restoreRemote: vi.fn(),
  forgetRemote: vi.fn(),
  REQUEST_TIMEOUT_MS: 30_000,
}));
vi.mock("@/services/signer", async () => ({
  ...(await vi.importActual<typeof import("@/services/signer")>("@/services/signer")),
  connectExtension: vi.fn(),
  disconnect: vi.fn(),
}));

import { useConnectSigner } from "@/hooks/use-connect-signer";
import { connectBunker, startPairing } from "@/services/remoteSigner";
import { connectExtension, disconnect, SignerError } from "@/services/signer";
import { useSigner } from "@/stores/signer";

const CURATOR = "c".repeat(64);
const CODE = `nostrconnect://${"a".repeat(64)}?relay=wss%3A%2F%2Frelay.example.test`;

/** A pairing that stays open until the test settles it. */
function pairing() {
  let pair: (pubkey: string) => void = () => {};
  let fail: (err: unknown) => void = () => {};
  const done = new Promise<string>((resolve, reject) => {
    pair = resolve;
    fail = reject;
  });
  const cancel = vi.fn();
  vi.mocked(startPairing).mockReturnValueOnce({ uri: CODE, done, cancel });
  return { cancel, pair, fail };
}

beforeEach(() => {
  vi.mocked(disconnect).mockReset();
  vi.mocked(connectExtension).mockReset();
  vi.mocked(connectBunker).mockReset();
  vi.mocked(startPairing).mockReset();
  useSigner.getState().setConnected(CURATOR, "remote");
});

describe("useConnectSigner", () => {
  it("ends disconnected", async () => {
    vi.mocked(disconnect).mockResolvedValueOnce();
    const { result } = renderHook(() => useConnectSigner());

    await act(() => result.current.disconnect());

    expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
  });

  it("ends disconnected, without failing, when the signer fails to let go", async () => {
    vi.mocked(disconnect).mockRejectedValueOnce(new Error("the signer would not close"));
    const { result } = renderHook(() => useConnectSigner());

    await act(() => result.current.disconnect());

    expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
  });

  describe("by extension", () => {
    beforeEach(() => useSigner.getState().setDisconnected());

    it("is connected by the extension once it answers", async () => {
      vi.mocked(connectExtension).mockResolvedValue(CURATOR);
      const { result } = renderHook(() => useConnectSigner());

      await act(() => result.current.connectExtension());

      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "extension" });
    });

    it("keeps the extension's words when it says no", async () => {
      vi.mocked(connectExtension).mockRejectedValue(new SignerError("no-extension", "No Nostr signer extension found in this browser."));
      const { result } = renderHook(() => useConnectSigner());

      await act(() => result.current.connectExtension());

      expect(useSigner.getState()).toMatchObject({
        status: "error",
        error: "No Nostr signer extension found in this browser.",
        pubkey: null,
      });
    });
  });

  describe("by bunker link", () => {
    beforeEach(() => {
      useSigner.getState().setDisconnected();
      vi.mocked(disconnect).mockResolvedValue();
    });

    /** A bunker that stays pending until the test answers or refuses for it. */
    function pending() {
      let answer: (pubkey: string) => void = () => {};
      let refuse: (err: unknown) => void = () => {};
      vi.mocked(connectBunker).mockReturnValue(
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
      );
      return { answer: (pubkey: string) => answer(pubkey), refuse: (err: unknown) => refuse(err) };
    }

    it("is connecting while the bunker is asked, then connected as a remote signer", async () => {
      const bunker = pending();
      const { result } = renderHook(() => useConnectSigner());

      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });
      expect(useSigner.getState().status).toBe("connecting");
      await act(async () => {
        bunker.answer(CURATOR);
        await attempt?.done;
      });

      expect(connectBunker).toHaveBeenCalledWith("bunker://link");
      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
    });

    it("keeps the service's words when the link is refused, even when they say it was not connected", async () => {
      vi.mocked(connectBunker).mockRejectedValue(new SignerError("not-connected", "That isn't a bunker:// link."));
      const { result } = renderHook(() => useConnectSigner());

      await act(() => result.current.connectBunker("nope").done);

      expect(useSigner.getState()).toMatchObject({ status: "error", error: "That isn't a bunker:// link." });
    });

    it("giving up lets go of the signer in use and puts the store back", () => {
      pending();
      const { result } = renderHook(() => useConnectSigner());
      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });

      act(() => attempt?.cancel());

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
    });

    it("ignores what a bunker says after it was given up on", async () => {
      const late = pending();
      const { result } = renderHook(() => useConnectSigner());
      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });
      act(() => attempt?.cancel());

      await act(async () => {
        late.refuse(new SignerError("not-connected", "The signer in use changed before this one connected."));
        await attempt?.done;
      });

      expect(useSigner.getState()).toMatchObject({ status: "disconnected", error: null });
    });

    it("ignores a bunker that connects after it was given up on", async () => {
      const late = pending();
      const { result } = renderHook(() => useConnectSigner());
      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });
      act(() => attempt?.cancel());

      await act(async () => {
        late.answer(CURATOR);
        await attempt?.done;
      });

      expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
    });

    it("does not let go of anything when the bunker has already answered", async () => {
      const bunker = pending();
      const { result } = renderHook(() => useConnectSigner());
      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });
      await act(async () => {
        bunker.answer(CURATOR);
        await attempt?.done;
      });

      act(() => attempt?.cancel());

      expect(disconnect).not.toHaveBeenCalled();
      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
    });

    it("gives up once however often it is asked", () => {
      pending();
      const { result } = renderHook(() => useConnectSigner());
      let attempt: ReturnType<typeof result.current.connectBunker> | undefined;
      act(() => {
        attempt = result.current.connectBunker("bunker://link");
      });

      act(() => attempt?.cancel());
      act(() => attempt?.cancel());

      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("by code", () => {
    beforeEach(() => useSigner.getState().setDisconnected());

    it("hands back the code to show, and is connecting until a signer pairs", async () => {
      const { pair } = pairing();
      const { result } = renderHook(() => useConnectSigner());

      let started: ReturnType<typeof result.current.startPairing> = null;
      act(() => {
        started = result.current.startPairing();
      });

      expect(started).toMatchObject({ uri: CODE });
      expect(useSigner.getState().status).toBe("connecting");

      await act(async () => pair(CURATOR));

      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
    });

    it("stopping it puts the store back, and stops the pairing once however often it is asked", () => {
      const { cancel } = pairing();
      const { result } = renderHook(() => useConnectSigner());
      let started: ReturnType<typeof result.current.startPairing> = null;
      act(() => {
        started = result.current.startPairing();
      });

      act(() => started?.cancel());
      act(() => started?.cancel());

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null });
    });

    it("stopping a pairing leaves another signer that connected meanwhile as it is", () => {
      const { cancel } = pairing();
      const { result } = renderHook(() => useConnectSigner());
      let started: ReturnType<typeof result.current.startPairing> = null;
      act(() => {
        started = result.current.startPairing();
      });
      act(() => useSigner.getState().setConnected(CURATOR, "extension"));

      act(() => started?.cancel());

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "extension" });
    });

    it("stopping an old pairing does not stop a newer one", () => {
      pairing();
      const newer = pairing();
      const { result } = renderHook(() => useConnectSigner());
      let first: ReturnType<typeof result.current.startPairing> = null;
      act(() => {
        first = result.current.startPairing();
      });
      act(() => first?.cancel());
      act(() => {
        result.current.startPairing();
      });

      act(() => first?.cancel());

      expect(newer.cancel).not.toHaveBeenCalled();
      expect(useSigner.getState().status).toBe("connecting");
    });

    it("does not stop a pairing that has finished", async () => {
      const { cancel, pair } = pairing();
      const { result } = renderHook(() => useConnectSigner());
      let started: ReturnType<typeof result.current.startPairing> = null;
      act(() => {
        started = result.current.startPairing();
      });
      await act(async () => pair(CURATOR));

      act(() => started?.cancel());

      expect(cancel).not.toHaveBeenCalled();
      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR });
    });

    it("keeps the signer's words when pairing fails", async () => {
      const { fail } = pairing();
      const { result } = renderHook(() => useConnectSigner());
      act(() => {
        result.current.startPairing();
      });

      await act(async () => fail(new SignerError("timeout", "No signer paired in time.")));

      expect(useSigner.getState()).toMatchObject({ status: "error", error: "No signer paired in time." });
    });

    it("leaves the store alone when a pairing ends because the signer in use changed", async () => {
      const { fail } = pairing();
      const { result } = renderHook(() => useConnectSigner());
      act(() => {
        result.current.startPairing();
      });
      act(() => useSigner.getState().setConnected(CURATOR, "extension"));

      await act(async () => fail(new SignerError("not-connected", "The signer in use changed before this one connected.")));

      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "extension" });
    });

    it("reports a pairing that could not even start", () => {
      vi.mocked(startPairing).mockImplementationOnce(() => {
        throw new Error("no crypto here");
      });
      const { result } = renderHook(() => useConnectSigner());

      let started: ReturnType<typeof result.current.startPairing> | undefined;
      act(() => {
        started = result.current.startPairing();
      });

      expect(started).toBeNull();
      expect(useSigner.getState()).toMatchObject({ status: "error", error: "no crypto here" });
    });
  });
});
