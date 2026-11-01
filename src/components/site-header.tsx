"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ApprovalNotice } from "@/components/approval-notice";
import { ConnectDialog } from "@/components/connect-dialog";
import { ShowEverything } from "@/components/show-everything";
import { useConnectSigner, useRestoreRemote } from "@/hooks/use-connect-signer";
import { useProfile } from "@/hooks/use-profile";
import { profileDisplayName } from "@/lib/format";
import { onRemoteAuth } from "@/services/remoteSigner";
import { useApprovalLink } from "@/stores/approval-link";
import { useConnectDialog } from "@/stores/connect-dialog";

/**
 * The page's top bar: where to go, whether a signer is connected, and, as
 * the one place that is always on the page, the Connect chooser and a
 * signer's approval link, whenever one asks.
 */
export function SiteHeader() {
  const { status, pubkey, disconnect } = useConnectSigner();
  const profile = useProfile(status === "connected" ? pubkey ?? undefined : undefined);
  const chooserOpen = useConnectDialog((s) => s.open);
  const showChooser = useConnectDialog((s) => s.show);
  const hideChooser = useConnectDialog((s) => s.hide);
  const showApproval = useApprovalLink((s) => s.show);
  const dismissApproval = useApprovalLink((s) => s.dismiss);

  useRestoreRemote();

  // A signer can ask for approval at any time, while connecting or on a later signature.
  useEffect(() => onRemoteAuth(showApproval), [showApproval]);

  // A link is for the request that sent it: once connecting is over, it is no use.
  useEffect(() => {
    if (status !== "connecting") dismissApproval();
  }, [status, dismissApproval]);

  const displayName = pubkey ? profileDisplayName(profile, pubkey) : "";
  const picture = profile?.picture;

  return (
    <>
      <header className="border-b border-rule bg-surface/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-[1100px] px-8 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <Link
            href="/"
            className="flex items-center gap-2.5"
          >
            <span className="inline-block w-2 h-2 bg-accent" style={{ borderRadius: "1px" }} />
            <span className="font-serif text-[20px] font-semibold tracking-[-0.01em] text-ink">
              Curate
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <Link
              href="/"
              className="text-ink-soft hover:text-ink transition-colors duration-150"
            >
              Discover
            </Link>
            <Link
              href="/create"
              className="text-ink-soft hover:text-ink transition-colors duration-150"
            >
              Create
            </Link>
            <Link
              href="/guide"
              className="text-ink-soft hover:text-ink transition-colors duration-150"
            >
              Guide
            </Link>
            <Link
              href="/settings"
              className="text-ink-soft hover:text-ink transition-colors duration-150"
            >
              Settings
            </Link>

            <span className="w-px h-4 bg-rule" />

            <ShowEverything />

            <span className="w-px h-4 bg-rule" />

            {status === "connected" && pubkey ? (
              <>
                <span
                  className="flex items-center gap-2 px-2.5 py-1 bg-surface-raised text-ink-soft border border-rule"
                  style={{ borderRadius: "var(--radius-input)" }}
                >
                  {picture ? (
                    <img
                      src={picture}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-rule flex items-center justify-center text-[10px] text-mute">
                      {displayName[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="text-[12px] max-w-[120px] truncate">{displayName}</span>
                </span>
                <button
                  type="button"
                  onClick={disconnect}
                  className="text-[12px] text-mute hover:text-ink transition-colors duration-150"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={showChooser}
                disabled={status === "connecting"}
                className="text-[12px] font-medium px-3 py-1.5 bg-accent text-ink hover:brightness-110 transition-all duration-150 disabled:opacity-50"
                style={{ borderRadius: "var(--radius-input)" }}
              >
                {status === "connecting" ? "Connecting..." : "Connect"}
              </button>
            )}
          </nav>
        </div>
      </header>
      {/* Outside the header: its blur would make the header, not the page, what these are placed against. */}
      <ConnectDialog open={chooserOpen} onClose={hideChooser} />
      {chooserOpen ? null : <ApprovalNotice floating />}
    </>
  );
}
