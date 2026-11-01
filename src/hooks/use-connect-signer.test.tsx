// @vitest-environment jsdom
/** Connecting and disconnecting from the page: the store follows, whatever the signer does. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/signer", () => ({ connectExtension: vi.fn(), disconnect: vi.fn() }));

import { useConnectSigner } from "@/hooks/use-connect-signer";
import { disconnect } from "@/services/signer";
import { useSigner } from "@/stores/signer";

const CURATOR = "c".repeat(64);

beforeEach(() => {
  vi.mocked(disconnect).mockReset();
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
});
