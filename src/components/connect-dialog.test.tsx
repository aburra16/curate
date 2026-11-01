// @vitest-environment jsdom
/** The Connect chooser: a browser extension, or a remote signer by code or by link. */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/remoteSigner", () => ({
  startPairing: vi.fn(),
  connectBunker: vi.fn(),
  restoreRemote: vi.fn(),
  forgetRemote: vi.fn(),
  onRemoteAuth: vi.fn(() => () => {}),
  REQUEST_TIMEOUT_MS: 30_000,
}));
vi.mock("@/services/signer", async () => ({
  ...(await vi.importActual<typeof import("@/services/signer")>("@/services/signer")),
  connectExtension: vi.fn(),
  disconnect: vi.fn(),
}));
// The code's picture carries no text; this stand-in shows what it was asked to encode.
vi.mock("qrcode.react", async () => {
  const { createElement } = await import("react");
  return {
    QRCodeSVG: ({ value, size }: { value: string; size: number }) =>
      createElement("svg", { "data-testid": "pairing-code", "data-value": value, "data-size": size }),
  };
});

import { ConnectDialog } from "@/components/connect-dialog";
import { connectBunker, startPairing } from "@/services/remoteSigner";
import { connectExtension, disconnect, SignerError } from "@/services/signer";
import { useApprovalLink } from "@/stores/approval-link";
import { useSigner } from "@/stores/signer";

const CURATOR = "c".repeat(64);
const CODE = `nostrconnect://${"a".repeat(64)}?relay=wss%3A%2F%2Frelay.example.test&secret=s&name=Curate`;
const BUNKER = `bunker://${"b".repeat(64)}?relay=wss%3A%2F%2Frelay.example.test&secret=s`;
const APPROVAL = "https://signer.example.test/approve?request=1";

const nostr = (present: boolean) => {
  if (present) (window as { nostr?: unknown }).nostr = {};
  else delete (window as { nostr?: unknown }).nostr;
};

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

/** A dialog that closes the way the page closes it: its owner stops rendering it. */
function Page({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "dialog open" : "dialog closed"}</p>
      <ConnectDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
    </>
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(disconnect).mockReset();
  vi.mocked(disconnect).mockResolvedValue();
  vi.mocked(connectExtension).mockReset();
  vi.mocked(connectBunker).mockReset();
  vi.mocked(startPairing).mockReset();
  useSigner.getState().setDisconnected();
  useApprovalLink.getState().dismiss();
  nostr(false);
});

afterEach(() => nostr(false));

describe("ConnectDialog", () => {
  it("shows nothing while closed", () => {
    const { container } = render(<ConnectDialog open={false} onClose={() => {}} />);

    expect(container.textContent).toBe("");
  });

  it("has the extension button disabled, and says why, when the browser has no extension", () => {
    render(<ConnectDialog open onClose={() => {}} />);

    expect(button("Browser extension").disabled).toBe(true);
    expect(screen.getByText("No extension found in this browser")).toBeTruthy();

    fireEvent.click(button("Browser extension"));
    expect(connectExtension).not.toHaveBeenCalled();
  });

  it("connects the extension and closes", async () => {
    nostr(true);
    vi.mocked(connectExtension).mockResolvedValue(CURATOR);
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);

    expect(button("Browser extension").disabled).toBe(false);
    expect(screen.queryByText("No extension found in this browser")).toBeNull();
    fireEvent.click(button("Browser extension"));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "extension" });
  });

  it("says in place what the extension answered when it says no, and stays open", async () => {
    nostr(true);
    vi.mocked(connectExtension).mockRejectedValue(new SignerError("refused", "The signer didn't connect: User rejected"));
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);

    fireEvent.click(button("Browser extension"));

    expect((await screen.findByRole("alert")).textContent).toBe("The signer didn't connect: User rejected");
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Browser extension").disabled).toBe(false);
  });

  it("shows the refusal of a pasted link that isn't a bunker link", async () => {
    const actual = await vi.importActual<typeof import("@/services/remoteSigner")>("@/services/remoteSigner");
    vi.mocked(connectBunker).mockImplementation(actual.connectBunker);
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: "https://example.test/not-a-bunker" } });
    fireEvent.click(button("Connect"));

    expect((await screen.findByRole("alert")).textContent).toBe("That isn't a bunker:// link.");
    expect(onClose).not.toHaveBeenCalled();
    expect(useSigner.getState().status).toBe("error");
  });

  it("connects the bunker a pasted link names, and closes", async () => {
    vi.mocked(connectBunker).mockResolvedValue(CURATOR);
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);

    expect(button("Connect").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: ` ${BUNKER} ` } });
    fireEvent.click(button("Connect"));

    expect(await screen.findByText("Waiting for your signer…")).toBeTruthy();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(connectBunker).toHaveBeenCalledWith(BUNKER);
    expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
  });

  it("shows a bunker that doesn't answer in place", async () => {
    vi.mocked(connectBunker).mockRejectedValue(new SignerError("timeout", "The signer didn't answer in time."));
    render(<ConnectDialog open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });
    fireEvent.click(button("Connect"));

    expect((await screen.findByRole("alert")).textContent).toBe("The signer didn't answer in time.");
    expect(button("Connect").disabled).toBe(false);
  });

  it("shows a code for the phone to scan, with Copy link and Cancel, and no more than one pairing", () => {
    pairing();
    render(<ConnectDialog open onClose={() => {}} />);

    fireEvent.click(button("Scan with your phone"));

    const code = screen.getByTestId("pairing-code");
    expect(code.getAttribute("data-value")).toBe(CODE);
    expect(code.getAttribute("data-value")).toMatch(/^nostrconnect:\/\//);
    expect(code.getAttribute("data-size")).toBe("240");
    expect(screen.getByText("Waiting for your signer…")).toBeTruthy();
    expect(button("Copy link")).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan with your phone" })).toBeNull();
    expect(startPairing).toHaveBeenCalledTimes(1);
    expect(useSigner.getState().status).toBe("connecting");
  });

  it("starts no pairing until the person asks for one", () => {
    render(<ConnectDialog open onClose={() => {}} />);

    expect(startPairing).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pairing-code")).toBeNull();
  });

  it("holds the other ways to connect while a pairing waits", () => {
    nostr(true);
    pairing();
    render(<ConnectDialog open onClose={() => {}} />);

    fireEvent.click(button("Scan with your phone"));

    expect(button("Browser extension").disabled).toBe(true);
    expect((screen.getByLabelText("Paste a bunker link") as HTMLInputElement).disabled).toBe(true);
    expect(button("Connect").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
  });

  it("holds the other ways to connect while a bunker waits", () => {
    nostr(true);
    vi.mocked(connectBunker).mockReturnValue(new Promise(() => {}));
    render(<ConnectDialog open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });
    fireEvent.click(button("Connect"));

    expect(button("Browser extension").disabled).toBe(true);
    expect(button("Scan with your phone").disabled).toBe(true);
  });

  it("Cancel stops the pairing and offers the choices again", () => {
    const { cancel } = pairing();
    render(<ConnectDialog open onClose={() => {}} />);
    fireEvent.click(button("Scan with your phone"));

    fireEvent.click(button("Cancel"));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("pairing-code")).toBeNull();
    expect(button("Scan with your phone").disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(useSigner.getState().status).toBe("disconnected");
  });

  it("closing the dialog during a pairing stops it", () => {
    const { cancel } = pairing();
    render(<Page />);
    fireEvent.click(button("Scan with your phone"));

    fireEvent.click(button("Close"));

    expect(screen.getByText("dialog closed")).toBeTruthy();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useSigner.getState().status).toBe("disconnected");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("connects when the signer pairs, and closes without stopping the pairing it just finished", async () => {
    const { cancel, pair } = pairing();
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    fireEvent.click(button("Scan with your phone"));

    await act(async () => pair(CURATOR));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("says in place when no signer paired in time, and offers the choices again", async () => {
    const { fail } = pairing();
    const onClose = vi.fn();
    render(<ConnectDialog open onClose={onClose} />);
    fireEvent.click(button("Scan with your phone"));

    await act(async () => fail(new SignerError("timeout", "No signer paired in time.")));

    expect((await screen.findByRole("alert")).textContent).toBe("No signer paired in time.");
    expect(screen.queryByTestId("pairing-code")).toBeNull();
    expect(button("Scan with your phone").disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not bring back the code of a pairing that ended when a bunker is asked next", async () => {
    const { fail } = pairing();
    vi.mocked(connectBunker).mockReturnValue(new Promise(() => {}));
    render(<ConnectDialog open onClose={() => {}} />);
    fireEvent.click(button("Scan with your phone"));
    await act(async () => fail(new SignerError("timeout", "No signer paired in time.")));

    fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });
    fireEvent.click(button("Connect"));

    expect(screen.getByText("Waiting for your signer…")).toBeTruthy();
    expect(screen.queryByTestId("pairing-code")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing when a pairing ends because another signer took over", async () => {
    const { fail } = pairing();
    render(<ConnectDialog open onClose={() => {}} />);
    fireEvent.click(button("Scan with your phone"));
    act(() => useSigner.getState().setConnected(CURATOR, "extension"));

    await act(async () => fail(new SignerError("not-connected", "The signer in use changed before this one connected.")));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "extension" });
  });

  it("copies the code's link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    pairing();
    render(<ConnectDialog open onClose={() => {}} />);
    fireEvent.click(button("Scan with your phone"));

    fireEvent.click(button("Copy link"));

    await waitFor(() => expect(button("Copied")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it("says when the link could not be copied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    pairing();
    render(<ConnectDialog open onClose={() => {}} />);
    fireEvent.click(button("Scan with your phone"));

    fireEvent.click(button("Copy link"));

    await waitFor(() => expect(button("Couldn't copy")).toBeTruthy());
  });

  it("starts one pairing, and keeps it, when React runs its effects twice", () => {
    const { cancel } = pairing();
    render(
      <StrictMode>
        <ConnectDialog open onClose={() => {}} />
      </StrictMode>,
    );

    fireEvent.click(button("Scan with your phone"));

    expect(startPairing).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("pairing-code")).toBeTruthy();
  });

  it("shows a signer's approval link inside the dialog, where Tab can reach it", () => {
    render(<ConnectDialog open onClose={() => {}} />);

    act(() => useApprovalLink.getState().show(APPROVAL));

    const dialog = screen.getByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "Open the approval page" });
    expect(link.getAttribute("href")).toBe(APPROVAL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  describe("keyboard focus", () => {
    const dialog = () => screen.getByRole("dialog");
    const typeLink = () =>
      fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });

    it("starts on the dialog", () => {
      render(<ConnectDialog open onClose={() => {}} />);

      expect(document.activeElement).toBe(dialog());
    });

    it("comes back to the dialog when the code replaces the button that was pressed", () => {
      pairing();
      render(<ConnectDialog open onClose={() => {}} />);
      button("Scan with your phone").focus();

      fireEvent.click(button("Scan with your phone"));

      expect(screen.queryByRole("button", { name: "Scan with your phone" })).toBeNull();
      expect(document.activeElement).toBe(dialog());
    });

    it("comes back to the dialog when Cancel takes itself away", () => {
      pairing();
      render(<ConnectDialog open onClose={() => {}} />);
      fireEvent.click(button("Scan with your phone"));
      button("Cancel").focus();

      fireEvent.click(button("Cancel"));

      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(document.activeElement).toBe(dialog());
    });

    it("comes back to the dialog when a bunker link is sent and its field and button are held", () => {
      vi.mocked(connectBunker).mockReturnValue(new Promise(() => {}));
      render(<ConnectDialog open onClose={() => {}} />);
      typeLink();
      screen.getByLabelText("Paste a bunker link").focus();

      fireEvent.submit(screen.getByLabelText("Paste a bunker link"));

      expect((screen.getByLabelText("Paste a bunker link") as HTMLInputElement).disabled).toBe(true);
      expect(document.activeElement).toBe(dialog());
    });

    it("comes back to the dialog when the extension button is pressed and held", () => {
      nostr(true);
      vi.mocked(connectExtension).mockReturnValue(new Promise(() => {}));
      render(<ConnectDialog open onClose={() => {}} />);
      button("Browser extension").focus();

      fireEvent.click(button("Browser extension"));

      expect(button("Browser extension").disabled).toBe(true);
      expect(document.activeElement).toBe(dialog());
    });

    it("leaves focus where it is when the view changes and the focused control is still there", async () => {
      vi.mocked(connectBunker).mockRejectedValue(new SignerError("timeout", "The signer didn't answer in time."));
      render(<ConnectDialog open onClose={() => {}} />);
      typeLink();
      button("Close").focus();

      fireEvent.click(button("Connect"));
      await screen.findByRole("alert");

      expect(document.activeElement).toBe(button("Close"));
    });

    it("keeps Tab inside, at both ends", () => {
      render(<ConnectDialog open onClose={() => {}} />);
      typeLink();
      const focusable = [...dialog().querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      expect(first).toBe(button("Close"));
      expect(last).toBe(button("Connect"));

      last.focus();
      fireEvent.keyDown(last, { key: "Tab" });
      expect(document.activeElement).toBe(first);

      first.focus();
      fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it("keeps Tab inside after the code has replaced the button that had focus", () => {
      pairing();
      render(<ConnectDialog open onClose={() => {}} />);
      button("Scan with your phone").focus();
      fireEvent.click(button("Scan with your phone"));

      // Focus is on the dialog, so the key reaches its handler and wraps from the front to the last control.
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: true });

      expect(document.activeElement).toBe(button("Cancel"));
    });

    it("gives focus back to what opened it", () => {
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      const { unmount } = render(<ConnectDialog open onClose={() => {}} />);
      expect(document.activeElement).toBe(dialog());

      unmount();

      expect(document.activeElement).toBe(opener);
      opener.remove();
    });
  });

  describe("a bunker that is slow to answer", () => {
    const typeLink = () =>
      fireEvent.change(screen.getByLabelText("Paste a bunker link"), { target: { value: BUNKER } });

    it("can be cancelled: the signer in use is let go and the choices are back", () => {
      vi.mocked(connectBunker).mockReturnValue(new Promise(() => {}));
      render(<ConnectDialog open onClose={() => {}} />);
      typeLink();
      fireEvent.click(button("Connect"));
      expect(screen.getByText("Waiting for your signer…")).toBeTruthy();

      fireEvent.click(button("Cancel"));

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(useSigner.getState().status).toBe("disconnected");
      expect(screen.queryByText("Waiting for your signer…")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(button("Connect").disabled).toBe(false);
      expect(button("Scan with your phone").disabled).toBe(false);
    });

    it("is cancelled by closing the dialog", () => {
      vi.mocked(connectBunker).mockReturnValue(new Promise(() => {}));
      render(<Page />);
      typeLink();
      fireEvent.click(button("Connect"));

      fireEvent.click(button("Close"));

      expect(screen.getByText("dialog closed")).toBeTruthy();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(useSigner.getState().status).toBe("disconnected");
    });

    it("is not cancelled by the dialog closing once it has connected", async () => {
      vi.mocked(connectBunker).mockResolvedValue(CURATOR);
      render(<Page />);
      typeLink();

      fireEvent.click(button("Connect"));

      await waitFor(() => expect(screen.getByText("dialog closed")).toBeTruthy());
      expect(disconnect).not.toHaveBeenCalled();
      expect(useSigner.getState()).toMatchObject({ status: "connected", pubkey: CURATOR, method: "remote" });
    });
  });
});
