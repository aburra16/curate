// @vitest-environment jsdom
/** The header's Connect and identity, the session it brings back on load, and a signer's approval link. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/remoteSigner", () => ({
  startPairing: vi.fn(),
  connectBunker: vi.fn(),
  restoreRemote: vi.fn(),
  forgetRemote: vi.fn(),
  onRemoteAuth: vi.fn(),
  REQUEST_TIMEOUT_MS: 30_000,
}));
vi.mock("@/services/signer", async () => ({
  ...(await vi.importActual<typeof import("@/services/signer")>("@/services/signer")),
  connectExtension: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/hooks/use-profile", () => ({ useProfile: () => null }));

import { SiteHeader } from "@/components/site-header";
import { connectBunker, onRemoteAuth, restoreRemote, startPairing } from "@/services/remoteSigner";
import { disconnect, SignerError } from "@/services/signer";
import { useApprovalLink } from "@/stores/approval-link";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";

const CURATOR = "c".repeat(64);
const APPROVAL = "https://signer.example.test/approve?request=1";
const BUNKER = `bunker://${"b".repeat(64)}?relay=wss%3A%2F%2Frelay.example.test&secret=s`;

/** Where the page hears the signer's approval links, once the header is listening. */
let hear: (url: string) => void;
const stopListening = vi.fn();

beforeEach(() => {
  vi.mocked(restoreRemote).mockReset();
  vi.mocked(restoreRemote).mockResolvedValue(null);
  vi.mocked(disconnect).mockReset();
  vi.mocked(disconnect).mockResolvedValue();
  vi.mocked(connectBunker).mockReset();
  vi.mocked(startPairing).mockReset();
  stopListening.mockReset();
  vi.mocked(onRemoteAuth).mockReset();
  vi.mocked(onRemoteAuth).mockImplementation((listener) => {
    hear = listener;
    return stopListening;
  });
  useSigner.getState().setDisconnected();
  useConnectDialog.getState().hide();
  useApprovalLink.getState().dismiss();
});

/** Watches `window.open`, and puts it back after the test. */
let popups: { mockRestore: () => void } | null = null;
const watchPopups = () => {
  const spy = vi.spyOn(window, "open").mockReturnValue(null);
  popups = spy;
  return spy;
};
afterEach(() => popups?.mockRestore());

describe("SiteHeader", () => {
  it("offers Connect, which opens the chooser", () => {
    render(<SiteHeader />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(screen.getByRole("dialog", { name: "Connect" })).toBeTruthy();
  });

  it("closes the chooser from its Close button", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives focus back to Connect when the chooser closes, even from a pairing that was waiting", () => {
    vi.mocked(startPairing).mockReturnValue({ uri: "nostrconnect://x", done: new Promise(() => {}), cancel: vi.fn() });
    render(<SiteHeader />);
    const connect = screen.getByRole("button", { name: "Connect" });
    connect.focus();
    fireEvent.click(connect);
    fireEvent.click(screen.getByRole("button", { name: "Scan with your phone" }));
    expect((connect as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect((connect as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(connect);
  });

  it("opens the chooser when something else asks for it", () => {
    render(<SiteHeader />);

    act(() => useConnectDialog.getState().show());

    expect(screen.getByRole("dialog", { name: "Connect" })).toBeTruthy();
  });

  it("is connected again after a reload that kept a remote session", async () => {
    vi.mocked(restoreRemote).mockResolvedValue(CURATOR);
    render(<SiteHeader />);

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
  });

  it("stays disconnected when no session was kept", async () => {
    render(<SiteHeader />);

    await waitFor(() => expect(restoreRemote).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(useSigner.getState().status).toBe("disconnected");
  });

  it("stays disconnected, quietly, when the signer in use changed while the session was reopening", async () => {
    vi.mocked(restoreRemote).mockRejectedValue(new SignerError("not-connected", "The signer in use changed before this one connected."));
    render(<SiteHeader />);

    await waitFor(() => expect(restoreRemote).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useSigner.getState().status).toBe("disconnected");
  });

  it("stays disconnected when the kept session can't be reopened", async () => {
    vi.mocked(restoreRemote).mockRejectedValue(new Error("the relay is down"));
    render(<SiteHeader />);

    await waitFor(() => expect(restoreRemote).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(useSigner.getState().status).toBe("disconnected");
  });

  it("reopens the kept session once, even when React runs its effects twice", async () => {
    vi.mocked(restoreRemote).mockResolvedValue(CURATOR);
    render(
      <StrictMode>
        <SiteHeader />
      </StrictMode>,
    );

    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(restoreRemote).toHaveBeenCalledTimes(1);
  });

  it("shows who is connected, and Disconnect lets go of the signer", async () => {
    act(() => useSigner.getState().setConnected(CURATOR, "extension"));
    render(<SiteHeader />);

    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy());
    expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null });
  });

  it("shows a signer's approval link as a notice that can be dismissed", () => {
    render(<SiteHeader />);
    expect(screen.queryByText("Your signer asks you to approve Curate.")).toBeNull();

    act(() => hear(APPROVAL));

    expect(screen.getByText("Your signer asks you to approve Curate.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open the approval page" });
    expect(link.getAttribute("href")).toBe(APPROVAL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Your signer asks you to approve Curate.")).toBeNull();
  });

  describe("a bunker that is slow to answer", () => {
    /** The header's own button, not the chooser's. */
    const inHeader = (role: "button", name: string) => within(screen.getByRole("banner")).getByRole(role, { name });

    /** A bunker link sent from the chooser, and a bunker the test answers or refuses late. */
    function send() {
      let answer: (pubkey: string) => void = () => {};
      let refuse: (err: unknown) => void = () => {};
      vi.mocked(connectBunker).mockReturnValue(
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
      );
      render(<SiteHeader />);
      fireEvent.click(inHeader("button", "Connect"));
      fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Connect" }));
      return { answer: (pubkey: string) => answer(pubkey), refuse: (err: unknown) => refuse(err) };
    }

    it("waits behind a header that says so, until it is cancelled", () => {
      send();

      expect(screen.getByText("Waiting for your signer…")).toBeTruthy();
      expect((inHeader("button", "Connecting...") as HTMLButtonElement).disabled).toBe(true);
    });

    it("cancelling puts the header back on Connect, and a late answer changes nothing", async () => {
      const bunker = send();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect((inHeader("button", "Connect") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByRole("button", { name: "Connecting..." })).toBeNull();

      await act(async () => bunker.answer(CURATOR));

      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
    });

    it("cancelling hides a refusal that comes late, too", async () => {
      const bunker = send();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      await act(async () =>
        bunker.refuse(new SignerError("not-connected", "The signer in use changed before this one connected.")),
      );

      expect(screen.queryByRole("alert")).toBeNull();
      expect(useSigner.getState()).toMatchObject({ status: "disconnected", error: null });
    });

    it("closing the chooser cancels it, so the header is not left on Connecting", async () => {
      const bunker = send();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(false);

      await act(async () => bunker.answer(CURATOR));

      expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
      expect(useSigner.getState().status).toBe("disconnected");
    });
  });

  it("says which site the approval link goes to", () => {
    render(<SiteHeader />);

    act(() => hear("https://Signer.Example.test:8443/approve?request=1"));

    const notice = screen.getByRole("status");
    expect(within(notice).getByText("signer.example.test:8443")).toBeTruthy();
    expect(within(notice).getByRole("link", { name: "Open the approval page" })).toBeTruthy();
  });

  it.each([
    ["http://signer.example.test/approve"],
    ["javascript:alert(1)"],
    ["data:text/html,<p>approve</p>"],
    ["not a link"],
  ])("never shows, or opens, an approval link that isn't https: %s", (url) => {
    const open = watchPopups();
    render(<SiteHeader />);

    act(() => hear(url));

    expect(screen.queryByRole("link", { name: "Open the approval page" })).toBeNull();
    expect(screen.queryByText("Your signer asks you to approve Curate.")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("never opens an approval link by itself, even a good one", () => {
    const open = watchPopups();
    render(<SiteHeader />);

    act(() => hear(APPROVAL));

    expect(screen.getByRole("link", { name: "Open the approval page" })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
  });

  it("shows an approval link that arrives while connected, during a later signature", () => {
    act(() => useSigner.getState().setConnected(CURATOR, "remote"));
    render(<SiteHeader />);

    act(() => hear(APPROVAL));

    expect(screen.getByRole("link", { name: "Open the approval page" })).toBeTruthy();
  });

  it("drops the notice once the signer has connected", () => {
    render(<SiteHeader />);
    act(() => useSigner.getState().setConnecting());
    act(() => hear(APPROVAL));
    expect(screen.getByRole("link", { name: "Open the approval page" })).toBeTruthy();

    act(() => useSigner.getState().setConnected(CURATOR, "remote"));

    expect(screen.queryByRole("link", { name: "Open the approval page" })).toBeNull();
  });

  it("shows the approval link once while the chooser is open, inside it", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    act(() => useSigner.getState().setConnecting());

    act(() => hear(APPROVAL));

    const links = screen.getAllByRole("link", { name: "Open the approval page" });
    expect(links).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Open the approval page" })).toBe(links[0]);
  });

  it("stops listening for approval links when it goes", () => {
    const { unmount } = render(<SiteHeader />);
    expect(stopListening).not.toHaveBeenCalled();

    unmount();

    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});
