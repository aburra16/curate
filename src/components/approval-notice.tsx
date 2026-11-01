"use client";

import { cn } from "@/lib/utils";
import { useApprovalLink } from "@/stores/approval-link";

/** Where a link goes, as the address bar would say it. The store holds only valid `https:` links. */
const hostOf = (url: string): string => new URL(url).host;

/**
 * A remote signer's request to approve Curate on its own web page: the link,
 * for the person to open, with the site it goes to, and a way to put the
 * notice away. Nothing opens by itself. Shows nothing until a signer has
 * asked. `floating` pins it to the corner of the page; otherwise it sits
 * where it is placed (inside the Connect chooser, so it is within reach while
 * that is open).
 */
export function ApprovalNotice({ floating = false }: { floating?: boolean }) {
  const url = useApprovalLink((s) => s.url);
  const dismiss = useApprovalLink((s) => s.dismiss);
  if (!url) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 border border-rule-strong bg-surface-raised px-4 py-3 text-[13px] text-ink",
        floating && "fixed bottom-6 right-6 z-[100] max-w-sm shadow-lg",
      )}
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <p>Your signer asks you to approve Curate.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          Open the approval page
        </a>
        <span className="text-[12px] text-mute break-all">{hostOf(url)}</span>
        <button type="button" onClick={dismiss} className="text-[12px] text-mute hover:text-ink-soft transition-colors">
          Dismiss
        </button>
      </div>
    </div>
  );
}
