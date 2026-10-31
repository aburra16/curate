"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CardModel } from "@/app/discover-model";
import { UserIdentity } from "@/components/user-identity";
import { countItems } from "@/services/items";

interface Props {
  card: CardModel;
  /**
   * What items of this concept are filed under (`conceptHandles`). Without
   * them the card asks for no count.
   */
  handles?: string[];
}

/** Where a list opens. A static site keeps the address in the query string. */
const listHref = (root: string) => `/list?c=${encodeURIComponent(root)}`;

/** Counts already fetched this visit, by handles. A card that returns (a search clearing) doesn't ask again. */
const counted = new Map<string, number>();

/** Forget the counts. Tests start each case from here. */
export function clearCountCache(): void {
  counted.clear();
}

/**
 * A concept's count, asked for once its card first scrolls into view: COUNT
 * on the index is a request per card, and most cards are never seen.
 * Null while loading and when the index doesn't answer.
 */
function useCount(handles: string[] | undefined) {
  const ref = useRef<HTMLElement>(null);
  const key = handles?.join(" ") ?? "";
  const [fetched, setFetched] = useState<{ key: string; count: number | null } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!handles || !handles.length || !element || counted.has(key)) return;
    let cancelled = false;
    const ask = () => {
      countItems(handles)
        .then((n) => {
          if (typeof n === "number") counted.set(key, n);
          if (!cancelled) setFetched({ key, count: n });
        })
        .catch(() => {
          if (!cancelled) setFetched({ key, count: null });
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      ask();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        ask();
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
    // `handles` is read through `key`: a new array with the same handles is the same question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const count = counted.get(key) ?? (fetched?.key === key ? fetched.count : null);
  return { ref, count };
}

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

/** A list's image, small. A broken one disappears. */
function Thumb({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-12 w-12 shrink-0 object-cover border border-rule"
      style={{ borderRadius: "var(--radius-input)" }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

export function ConceptCard({ card, handles }: Props) {
  const { ref, count } = useCount(handles);

  return (
    <article
      ref={ref}
      className="group relative border border-rule bg-surface transition-all duration-200 hover:border-rule-strong hover:bg-surface-hover"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <Link href={listHref(card.root)} className="relative block px-6 py-5">
        <div className="flex items-start gap-4">
          {card.image ? <Thumb src={card.image} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="font-serif text-[24px] leading-[1.15] tracking-[-0.01em] text-ink break-words">
                {card.plural}
              </h3>
              {card.label ? <Label>{card.label}</Label> : null}
            </div>
            {card.description ? (
              <p className="mt-1.5 font-serif text-[14px] leading-[1.55] text-ink-soft line-clamp-2 italic">
                {card.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex min-h-4 items-center justify-between gap-4 text-[11px] text-mute">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {card.versions > 1 ? <span className="whitespace-nowrap">{card.versions} versions</span> : null}
            {card.versions > 1 && count !== null ? (
              <span aria-hidden className="text-rule-strong">
                &middot;
              </span>
            ) : null}
            {count !== null ? (
              <>
                <span title="Everything filed, before the web-of-trust filter" className="min-w-0 truncate">
                  {count.toLocaleString()} {card.plural}
                </span>
                {/* COUNT can't filter by trust: the card says so. On a narrow card it wraps below. */}
                <span className="text-[10px] text-mute/80">counted before the web-of-trust filter</span>
              </>
            ) : null}
          </div>
          {card.author ? <UserIdentity pubkey={card.author} avatarSize={16} textClass="text-[10px]" /> : null}
        </div>
      </Link>

      {card.copies.length > 0 ? (
        <ul className="border-t border-rule px-6 py-2">
          {card.copies.map((copy) => (
            <li key={`${copy.label ?? "copy"}:${copy.root}`}>
              <Link
                href={listHref(copy.root)}
                className="flex items-center justify-between gap-4 py-1.5 text-[13px] text-ink-soft hover:text-ink transition-colors duration-150"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">{copy.plural}</span>
                  <Label>{copy.label ?? "copy"}</Label>
                </span>
                {copy.author ? <UserIdentity pubkey={copy.author} avatarSize={14} textClass="text-[10px]" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
