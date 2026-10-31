"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { RowModel } from "@/app/list/items-model";
import { UserIdentity } from "@/components/user-identity";
import { distinctLinks } from "@/lib/curate/links";
import { formatRelativeTime } from "@/lib/format";
import { isSpot, osmEmbedUrl, osmPageUrl } from "@/lib/geohash";
import type { ItemLink } from "@/lib/linkTemplates";
import { cn } from "@/lib/utils";

interface Props {
  row: RowModel;
  /** The links the definition's URL templates build for this item (lib/linkTemplates `itemLinks`). */
  links: ItemLink[];
  /** What the reader can do with the item: vote, edit, delete. */
  actions?: ReactNode;
  /** A question the reader is being asked about the item, under the row's footer. Clicking in it never opens the panel. */
  asking?: ReactNode;
  /** Opens the item's event panel. Handed the element that opened it, so focus can go back there. */
  onOpen?: (opener: HTMLElement) => void;
}

/** A link out of Curate: a new tab, no referrer, no endorsement. Only http(s) URLs reach here. */
const OUT = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

function Label({ children }: { children: string }) {
  return (
    <span
      className="shrink-0 text-[10px] tracking-[0.04em] text-mute border border-rule px-1.5 py-px"
      style={{ borderRadius: "var(--radius-input)" }}
    >
      {children}
    </span>
  );
}

/** What a click on the row leaves to the element clicked: a link, a control, a player. */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, audio, video, iframe";

/**
 * One item of a list, read through its definition (tier 2): its title,
 * summary and picture; its links, each showing where it goes; its audio or
 * video, playable in place; a map of where it is, loaded only when asked
 * for; who listed it, and the votes on it. An item from outside the
 * reader's web of trust says so. Nothing here shows anyone's rank.
 *
 * The row opens the item's event panel: by its title, which is a button for
 * a keyboard, and by a click anywhere on the row that isn't on something
 * with a click of its own (and isn't selecting text).
 */
export function ItemRow({ row, links, actions, asking, onOpen }: Props) {
  const { p, item } = row;
  const [mapOpen, setMapOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const openFromRow = (e: MouseEvent<HTMLElement>) => {
    if (!onOpen || !opener.current) return;
    if ((e.target as Element).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    onOpen(opener.current);
  };
  const shownLinks = distinctLinks(p.link, links);
  const untitled = p.title === null;
  // A video shows the item's picture as its poster, so the row doesn't show it twice.
  const thumb = p.media?.kind === "video" ? null : p.image;

  return (
    <article
      onClick={openFromRow}
      className={cn(
        "border border-rule bg-surface px-5 py-4 transition-colors duration-150 hover:border-rule-strong",
        onOpen && "cursor-pointer",
      )}
      style={{ borderRadius: "var(--radius-card)", contentVisibility: "auto", containIntrinsicSize: "auto 112px" }}
    >
      <div className="flex items-start gap-4">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "shrink-0 object-cover border border-rule",
              p.imageShape === "portrait" ? "h-16 w-12" : "h-12 w-12 rounded-full",
            )}
            style={p.imageShape === "portrait" ? { borderRadius: "var(--radius-input)" } : undefined}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3
              className={cn(
                "font-serif text-[18px] leading-[1.3] break-words",
                untitled ? "text-mute italic" : "text-ink",
              )}
            >
              {onOpen ? (
                <button
                  ref={opener}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={(e) => onOpen(e.currentTarget)}
                  className="text-left hover:text-accent focus-visible:text-accent transition-colors"
                >
                  {row.title}
                </button>
              ) : (
                row.title
              )}
            </h3>
            {row.outside ? <Label>outside your web of trust</Label> : null}
          </div>

          {p.summary ? (
            <p className="mt-1 text-[13px] leading-[1.5] text-ink-soft line-clamp-2 break-words">{p.summary}</p>
          ) : null}

          {shownLinks.length > 0 || p.location ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
              {shownLinks.map((link) => (
                <a key={link.href} href={link.href} {...OUT} className="text-accent hover:underline break-all">
                  {link.label === link.host ? (
                    link.host
                  ) : (
                    <>
                      {link.label} <span className="text-mute">{link.host}</span>
                    </>
                  )}
                </a>
              ))}
              {p.location ? (
                <button
                  type="button"
                  aria-expanded={mapOpen}
                  onClick={() => setMapOpen((open) => !open)}
                  className="text-accent hover:underline"
                >
                  {isSpot(p.location) ? "Map" : "Map of the area"}
                </button>
              ) : null}
            </div>
          ) : null}

          {p.media?.kind === "audio" ? (
            <audio controls preload="none" src={p.media.url} className="mt-3 w-full max-w-md" />
          ) : p.media?.kind === "video" ? (
            <video
              controls
              playsInline
              // With the item's picture to show, a list of videos fetches none of them until one is played.
              preload={p.image ? "none" : "metadata"}
              poster={p.image ?? undefined}
              src={p.media.url}
              className="mt-3 max-h-80 w-full max-w-md bg-black"
              style={{ borderRadius: "var(--radius-input)" }}
            />
          ) : null}

          {mapOpen && p.location ? (
            <div className="mt-3">
              <iframe
                src={osmEmbedUrl(p.location)}
                title={`Map: ${row.title}`}
                loading="lazy"
                className="h-56 w-full border border-rule"
                style={{ borderRadius: "var(--radius-input)" }}
              />
              <a href={osmPageUrl(p.location)} {...OUT} className="mt-1 inline-block text-[11px] text-mute hover:text-accent">
                Open in OpenStreetMap <span className="text-mute/70">www.openstreetmap.org</span>
              </a>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-mute">
              <span className="whitespace-nowrap">Listed by</span>
              <UserIdentity pubkey={item.pubkey} avatarSize={14} textClass="text-[11px]" className="min-w-0" />
              <span aria-hidden className="text-rule-strong">
                &middot;
              </span>
              <span className="whitespace-nowrap">{formatRelativeTime(item.created_at)}</span>
            </p>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </div>

          {asking ? (
            // Not the row's own click: a question is answered, not opened.
            <div onClick={(e) => e.stopPropagation()} className="mt-3 border-t border-rule pt-3">
              {asking}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
