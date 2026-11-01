"use client";

import { QRCodeSVG } from "qrcode.react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ApprovalNotice } from "@/components/approval-notice";
import { useConnectSigner, type Pairing } from "@/hooks/use-connect-signer";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const inputStyle = { borderRadius: "var(--radius-input)" as const };

const optionClass =
  "w-full px-4 py-2.5 text-left text-[13px] font-medium bg-surface border border-rule text-ink hover:border-rule-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-rule";

const smallButtonClass =
  "px-3 py-1 text-[12px] bg-surface border border-rule text-ink-soft hover:text-ink transition-colors disabled:opacity-40";

/** Which way the person chose to connect; an error is shown beside it. */
type Way = "extension" | "pairing" | "bunker";

/** Whether the browser has a Nostr signer extension (`window.nostr`). */
const hasExtension = (): boolean => typeof window !== "undefined" && Boolean((window as { nostr?: unknown }).nostr);

/**
 * A modal dialog's behaviour: focus moves into it when it opens and returns
 * to what had it when it closes; Tab stays inside it; Escape closes it; the
 * page behind it doesn't scroll. Returns the dialog's key handler (Tab).
 */
function useModal(dialog: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.stopPropagation();
      latest.current();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [dialog]);

  return (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!focusable.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** What a failed connect said, in place beside the way that failed. */
function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12px] leading-[1.5] text-red-400">
      {children}
    </p>
  );
}

/** The code a signer app scans, to copy as a link too, and a Cancel that stops waiting. */
function PairingCode({ uri, onCancel }: { uri: string; onCancel: () => void }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 1800);
    return () => clearTimeout(timer);
  }, [copy]);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="bg-white p-3" style={{ borderRadius: "var(--radius-card)" }}>
        <QRCodeSVG value={uri} size={176} title="Code for your signer to scan" />
      </div>
      <p className="text-[12px] leading-[1.5] text-ink-soft">Scan this code with your signer app.</p>
      <p role="status" className="text-[12px] text-mute">
        Waiting for your signer…
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(uri);
              setCopy("copied");
            } catch {
              setCopy("failed");
            }
          }}
          className={smallButtonClass}
          style={inputStyle}
        >
          {copy === "copied" ? "Copied" : copy === "failed" ? "Couldn't copy" : "Copy link"}
        </button>
        <button type="button" onClick={onCancel} className="text-[12px] text-mute hover:text-ink-soft transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The chooser's contents; mounted only while it is open, so each opening starts fresh. */
function Chooser({ onClose }: { onClose: () => void }) {
  const { status, error, connectExtension, connectBunker, startPairing } = useConnectSigner();
  const [way, setWay] = useState<Way | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [link, setLink] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const extensionNoteId = useId();
  const linkId = useId();
  const remoteId = useId();
  const onKeyDown = useModal(dialog, onClose);

  const busy = status === "connecting";
  // A pairing that has ended (paired, failed or cancelled) is left in state; it isn't shown.
  const waiting = busy && way === "pairing" ? pairing : null;
  const problem = status === "error" && error ? error : null;
  const extension = hasExtension();

  // Closing the dialog, or starting another pairing, stops one still waiting. One that has ended does nothing when stopped.
  useEffect(() => () => pairing?.cancel(), [pairing]);

  // Once a signer is connected, by whichever way, the chooser has done its job.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });
  useEffect(() => {
    if (status === "connected") latestClose.current();
  }, [status]);

  const scan = () => {
    setWay("pairing");
    setPairing(startPairing());
  };

  const stopScanning = () => {
    pairing?.cancel();
    setPairing(null);
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    const pasted = link.trim();
    if (!pasted || busy) return;
    setWay("bunker");
    void connectBunker(pasted);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-full w-full max-w-[440px] flex-col gap-5 overflow-y-auto border border-rule-strong bg-surface-raised p-5 text-ink shadow-2xl outline-none"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif text-[22px] font-light leading-[1.2] text-ink">
              Connect
            </h2>
            <p className="mt-1 text-[12px] leading-[1.5] text-mute">
              Curate asks your signer to sign what you write. Your private key stays with your signer.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-rule px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
            style={inputStyle}
          >
            Close
          </button>
        </div>

        <ApprovalNotice />

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              setWay("extension");
              void connectExtension();
            }}
            disabled={!extension || busy}
            aria-describedby={extensionNoteId}
            className={optionClass}
            style={inputStyle}
          >
            Browser extension
          </button>
          <p id={extensionNoteId} className="text-[12px] leading-[1.5] text-mute">
            {extension ? "Use the signer extension in this browser" : "No extension found in this browser"}
          </p>
          {busy && way === "extension" ? (
            <p role="status" className="text-[12px] text-mute">
              Waiting for your extension…
            </p>
          ) : null}
          {way === "extension" && problem ? <Problem>{problem}</Problem> : null}
        </div>

        <div role="group" aria-labelledby={remoteId} className="flex flex-col gap-4">
          <h3 id={remoteId} className="text-[13px] font-medium text-ink">
            Remote signer
          </h3>

          <div className="flex flex-col gap-1.5">
            {waiting ? (
              <PairingCode uri={waiting.uri} onCancel={stopScanning} />
            ) : (
              <>
                <button type="button" onClick={scan} disabled={busy} className={optionClass} style={inputStyle}>
                  Scan with your phone
                </button>
                <p className="text-[12px] leading-[1.5] text-mute">Shows a code for your signer app to scan</p>
              </>
            )}
            {way === "pairing" && !waiting && problem ? <Problem>{problem}</Problem> : null}
          </div>

          <form onSubmit={submitLink} className="flex flex-col gap-1.5">
            <label htmlFor={linkId} className="text-[12px] text-ink-soft">
              Paste a bunker link
            </label>
            <div className="flex items-center gap-2">
              <input
                id={linkId}
                type="text"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                disabled={busy}
                placeholder="bunker://…"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className={cn(
                  "min-w-0 flex-1 border border-rule bg-surface px-3 py-2 font-mono text-[12px] text-ink placeholder:text-mute",
                  "focus:border-rule-strong focus:outline-none disabled:opacity-50",
                )}
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={busy || !link.trim()}
                className="shrink-0 bg-accent px-4 py-2 text-[12px] font-medium text-ink transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                style={inputStyle}
              >
                Connect
              </button>
            </div>
            {busy && way === "bunker" ? (
              <p role="status" className="text-[12px] text-mute">
                Waiting for your signer…
              </p>
            ) : null}
            {way === "bunker" && problem ? <Problem>{problem}</Problem> : null}
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * The Connect chooser: connect the browser's signer extension, or a remote
 * signer, by scanning a code with a phone or by pasting a `bunker://` link.
 * While one is connecting the others are held. Closing it stops a pairing
 * still waiting for a signer, and it closes itself once a signer is connected.
 * A failure is shown beside the way that failed.
 */
export function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Chooser onClose={onClose} /> : null;
}
