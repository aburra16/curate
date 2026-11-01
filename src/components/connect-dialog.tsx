"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApprovalNotice } from "@/components/approval-notice";
import { useConnectSigner, type BunkerAttempt, type Pairing } from "@/hooks/use-connect-signer";
import { useDialog } from "@/hooks/use-dialog";
import { cn } from "@/lib/utils";

const inputStyle = { borderRadius: "var(--radius-input)" as const };

const optionClass =
  "w-full px-4 py-2.5 text-left text-[13px] font-medium bg-surface border border-rule text-ink hover:border-rule-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-rule";

const smallButtonClass =
  "px-3 py-1 text-[12px] bg-surface border border-rule text-ink-soft hover:text-ink transition-colors disabled:opacity-40";

/** Which way the person chose to connect; an error is shown beside it. */
type Way = "extension" | "pairing" | "bunker";

/** Whether the browser has a Nostr signer extension (`window.nostr`). */
const hasExtension = (): boolean => typeof window !== "undefined" && Boolean((window as { nostr?: unknown }).nostr);

/** What a failed connect said, in place beside the way that failed. */
function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12px] leading-[1.5] text-red-400">
      {children}
    </p>
  );
}

/** The code a signer app scans, its link to open a signer app on this device or to copy, and a Cancel that stops waiting. */
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
        <QRCodeSVG value={uri} size={240} title="Code for your signer to scan" className="h-auto max-w-full" />
      </div>
      <p className="text-[12px] leading-[1.5] text-ink-soft">Scan this code with your signer app.</p>
      {/* On a phone the signer app may be on the same device: the person taps to open it. */}
      <a href={uri} className="text-[13px] text-accent underline underline-offset-2 hover:text-ink transition-colors">
        Open in a signer app on this device
      </a>
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
  // What is waiting for a signer: a pairing, or a bunker. One that has ended (connected, failed or cancelled) is left here, and isn't shown.
  const [attempt, setAttempt] = useState<Pairing | BunkerAttempt | null>(null);
  const [link, setLink] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const extensionNoteId = useId();
  const linkId = useId();
  const remoteId = useId();

  const busy = status === "connecting";
  const code = busy && way === "pairing" && attempt && "uri" in attempt ? attempt.uri : null;
  const problem = status === "error" && error ? error : null;
  const extension = hasExtension();

  // Focus goes back to what opened the chooser. It is noted before the dialog takes focus.
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  // The control that had focus can go with a change of view (the button that was pressed is replaced or disabled): focus comes back into the dialog.
  const view = [way, busy, code !== null, problem].join("|");

  // An attempt still waiting is stopped before the chooser goes, so what opened it is usable again when focus goes back to it.
  const close = () => {
    attempt?.cancel();
    onClose();
  };
  const onKeyDown = useDialog(dialog, close, () => opener.current, view);

  // Closing the dialog, or starting another attempt, stops one still waiting. One that has ended does nothing when stopped.
  useEffect(() => () => attempt?.cancel(), [attempt]);

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
    setAttempt(startPairing());
  };

  const stopWaiting = () => {
    attempt?.cancel();
    setAttempt(null);
  };

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    const pasted = link.trim();
    if (!pasted || busy) return;
    setWay("bunker");
    setAttempt(connectBunker(pasted));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={close} />
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
            onClick={close}
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
            {code ? (
              <PairingCode uri={code} onCancel={stopWaiting} />
            ) : (
              <>
                <button type="button" onClick={scan} disabled={busy} className={optionClass} style={inputStyle}>
                  Scan with your phone
                </button>
                <p className="text-[12px] leading-[1.5] text-mute">Shows a code for your signer app to scan</p>
              </>
            )}
            {way === "pairing" && !code && problem ? <Problem>{problem}</Problem> : null}
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
                  // 16px, so a phone doesn't zoom into the field.
                  "min-w-0 flex-1 border border-rule bg-surface px-3 py-2 font-mono text-[16px] text-ink placeholder:text-mute",
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
              <div className="flex items-center gap-3">
                <p role="status" className="text-[12px] text-mute">
                  Waiting for your signer…
                </p>
                <button
                  type="button"
                  onClick={stopWaiting}
                  className="text-[12px] text-mute hover:text-ink-soft transition-colors"
                >
                  Cancel
                </button>
              </div>
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
 * While one is connecting the others are held; a pairing or a bunker that
 * waits can be cancelled. Closing it cancels them too, and it closes itself
 * once a signer is connected. A failure is shown beside the way that failed.
 */
export function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Chooser onClose={onClose} /> : null;
}
