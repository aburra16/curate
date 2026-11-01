// @vitest-environment jsdom
/** The header's Connect and identity, the session it brings back on load, and a signer's approval link. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { onRemoteAuth, restoreRemote } from "@/services/remoteSigner";
import { disconnect, SignerError } from "@/services/signer";
import { useApprovalLink } from "@/stores/approval-link";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";

const CURATOR = "c".repeat(64);
const APPROVAL = "https://signer.example.test/approve?request=1";

/** Where the page hears the signer's approval links, once the header is listening. */
let hear: (url: string) => void;
const stopListening = vi.fn();

beforeEach(() => {
  vi.mocked(restoreRemote).mockReset();
  vi.mocked(restoreRemote).mockResolvedValue(null);
  vi.mocked(disconnect).mockReset();
  vi.mocked(disconnect).mockResolvedValue();
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
