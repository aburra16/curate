"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { UNTITLED_LIST } from "@/app/discover-model";
import { singularOf } from "@/app/list/items-model";
import type { VersionLabel } from "@/app/list/list-model";
import type { ConceptDefinition } from "@/lib/conceptResolution";
import { distinctLinks } from "@/lib/curate/links";
import { fieldCell, httpUrl, undeclaredFields } from "@/lib/dlistFields";
import { isSpot, osmEmbedUrl, osmPageUrl } from "@/lib/geohash";
import type { ItemPresentation } from "@/lib/itemPresentation";
import { itemLinks, type UrlTemplate } from "@/lib/linkTemplates";
import { cn } from "@/lib/utils";
import { namesOf, presentCurateItem } from "@/services/jsonData";

export interface ItemHeroProps {
  /** The item's event. */
  item: NostrEvent;
  /** The definition the item is read by: the version of its list that governs. */
  definition: ConceptDefinition;
  /** The URL templates the definition pins, by event id (`fetchTemplates`); empty until they are read. */
  templates: Map<string, UrlTemplate>;
  /** Whose version of the list `definition` is, when that is known. */
  version?: VersionLabel | null;
}

/** A link out of Curate: a new tab, no referrer, no endorsement. Only http(s) URLs reach here. */
const OUT = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
// A link says so with more than its colour: it is underlined too.
const link = "text-accent underline underline-offset-2 break-all";
const ROUNDED = { borderRadius: "var(--radius-input)" } as const;

/** How the line at the foot of the page names whose version of the list it is. */
const VERSION_WORDS: Record<VersionLabel, string> = {
  yours: "your version of",
  assistant: "your Assistant’s version of",
  house: "Brainstorm’s version of",
  community: "the community’s header for",
  copy: "another account’s version of",
};

/**
 * The declared fields the page above "More fields" shows, so it doesn't list
 * them again: the title, summary and facts, the fields its links are built
 * from, and the field of each role (picture, link, media, location) whose
 * value was drawn. A value that was not (an image that isn't an http(s)
 * address, a file that isn't audio or video) is not shown, so it is listed.
 */
function shownFields(p: ItemPresentation, definition: ConceptDefinition): Set<string> {
  const shown = new Set<string | null>([p.titleField, p.summaryField, ...p.factFields]);
  for (const ref of definition.links) for (const [, field] of ref.bindings) shown.add(field);
  if (p.image) shown.add(p.imageField);
  if (p.link) shown.add(p.linkField);
  if (p.media) shown.add(p.mediaField);
  if (p.location) shown.add(p.locationField);
  shown.delete(null);
  return shown as Set<string>;
}

// -- small parts -------------------------------------------------------------------

/** A field's value, as a link where its type says it opens something and the value is one. */
function Value({ value, href }: { value: string; href: string | null }) {
  if (!href) return <span className="break-words [overflow-wrap:anywhere]">{value}</span>;
  return httpUrl(href) ? (
    <a href={href} {...OUT} className={link}>
      {value}
    </a>
  ) : (
    // A call or a mail: it opens an app, not a page.
    <a href={href} className={link}>
      {value}
    </a>
  );
}

function Extra({ count }: { count: number }) {
  return count > 0 ? <span className="ml-2 text-[11px] text-mute">+{count} more</span> : null;
}

/**
 * What leads the page: the item's own picture, round (or a portrait, as a
 * cover is); else the list's image in a tile, as a logo sits; else a plain
 * mark. A picture that can't be loaded gives way to the next.
 */
function Picture({
  image,
  listImage,
  shape,
}: {
  image: string | null;
  listImage: string | null;
  shape: "round" | "portrait";
}) {
  const [broken, setBroken] = useState<readonly string[]>([]);
  const failed = (src: string) => setBroken((all) => [...all, src]);
  const own = image && !broken.includes(image) ? image : null;
  const list = listImage && !broken.includes(listImage) ? listImage : null;

  if (own) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={own}
        alt=""
        decoding="async"
        data-picture="item"
        data-shape={shape}
        onError={() => failed(own)}
        className={cn(
          "shrink-0 border border-rule object-cover",
          shape === "portrait" ? "h-24 w-16" : "h-16 w-16 rounded-full",
        )}
        style={shape === "portrait" ? ROUNDED : undefined}
      />
    );
  }
  if (list) {
    return (
      <span
        className="flex h-16 w-16 shrink-0 items-center justify-center border border-rule bg-surface"
        style={ROUNDED}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={list}
          alt=""
          decoding="async"
          data-picture="list"
          onError={() => failed(list)}
          className="h-10 w-10 object-contain"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-picture="mark"
      className="flex h-16 w-16 shrink-0 items-center justify-center border border-rule bg-surface text-mute"
      style={ROUNDED}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M5 7h14M5 12h14M5 17h9" />
      </svg>
    </span>
  );
}

/**
 * Where the item is, on OpenStreetMap's map. Only on request: until the
 * reader asks, the page contacts no map server. A spot gets a pin; a coarser
 * geohash is framed as the area it is.
 */
function ItemMap({ location, title }: { location: NonNullable<ItemPresentation["location"]>; title: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-baseline gap-1.5 self-start border border-rule bg-surface px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
        style={ROUNDED}
      >
        {isSpot(location) ? "Show on map" : "Show area on map"}
        <span className="text-[11px] text-mute">openstreetmap.org</span>
      </button>
    );
  }
  return (
    <div>
      <iframe
        src={osmEmbedUrl(location)}
        title={`Map: ${title}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="h-64 w-full border border-rule"
        style={ROUNDED}
      />
      <a href={osmPageUrl(location)} {...OUT} className="mt-1.5 inline-block text-[11px] text-mute hover:text-accent">
        Open in OpenStreetMap <span className="text-mute/70">www.openstreetmap.org</span>
      </a>
    </div>
  );
}

/** A list of "name: value" rows, the name on the left. */
function Rows({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-4 gap-y-2 border p-3 text-[13px]",
        dashed ? "border-dashed border-rule" : "border-rule",
      )}
      style={ROUNDED}
    >
      {children}
    </dl>
  );
}

/**
 * What the page above doesn't show: the declared fields nothing shows, then
 * the tags the item carries that its list never declared, kept apart and
 * said to be outside the definition. Folded; an item the definition covers
 * whole has nothing to fold.
 */
function MoreFields({
  fields,
  outside,
}: {
  fields: { name: string; description: string | null; value: string; href: string | null; extra: number }[];
  outside: { name: string; value: string }[];
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const outsideLabel = useId();
  if (fields.length === 0 && outside.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex items-center gap-1.5 text-[12px] text-mute transition-colors hover:text-ink-soft"
      >
        <span aria-hidden className={cn("inline-block text-[10px] transition-transform", open && "rotate-90")}>
          &#9656;
        </span>
        More fields ({fields.length + outside.length})
      </button>
      <div id={panel} hidden={!open} className="mt-3 flex flex-col gap-4">
        {open && fields.length > 0 ? (
          <div role="group" aria-label="More fields">
            <Rows>
              {fields.map((f) => (
                <div key={f.name} className="contents">
                  <dt title={f.description ?? undefined} className="break-words font-mono text-[12px] text-ink [overflow-wrap:anywhere]">
                    {f.name}
                  </dt>
                  <dd className="text-ink-soft">
                    <Value value={f.value} href={f.href} />
                    <Extra count={f.extra} />
                  </dd>
                </div>
              ))}
            </Rows>
          </div>
        ) : null}
        {open && outside.length > 0 ? (
          <div role="group" aria-labelledby={outsideLabel}>
            <p id={outsideLabel} className="mb-1.5 text-[11px] leading-[1.45] text-mute">
              Outside this list&rsquo;s definition
            </p>
            <Rows dashed>
              {outside.map((x, i) => (
                <div key={`${x.name}:${i}`} className="contents">
                  <dt className="break-words font-mono text-[12px] text-mute [overflow-wrap:anywhere]">{x.name}</dt>
                  <dd className="break-words text-ink-soft [overflow-wrap:anywhere]">{x.value}</dd>
                </div>
              ))}
            </Rows>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// -- the page ------------------------------------------------------------------------

/**
 * An item on its own, read through its list's definition (tier 2) the way its
 * row reads it: the list's name leads, then the item's picture, title and
 * summary, its links (its own, and those the definition's URL templates
 * build), its facts, its audio or video, and a map of where it is, loaded
 * only when asked for. A required field the item lacks is said once. The
 * declared fields nothing above shows, and the tags outside the definition,
 * wait behind "More fields"; the last line says which version of the list
 * the item is read through. Nothing here shows anyone's rank.
 */
export function ItemHero({ item, definition, templates, version = null }: ItemHeroProps) {
  const names = namesOf(definition.event);
  const singular = singularOf(definition);
  const plural = names.plural || UNTITLED_LIST;

  const p = useMemo(() => presentCurateItem(item, definition), [item, definition]);
  const links = useMemo(
    () => distinctLinks(p.link, itemLinks(item, definition.links, templates)),
    [p, item, definition, templates],
  );
  const cells = useMemo(() => definition.fields.map((decl) => ({ decl, cell: fieldCell(item, decl) })), [item, definition]);
  const missing = cells.filter(({ cell }) => cell.missing).map(({ decl }) => decl.name);
  const more = useMemo(() => {
    const shown = shownFields(p, definition);
    return cells.flatMap(({ decl, cell }) =>
      cell.value === null || shown.has(decl.name)
        ? []
        : [{ name: decl.name, description: decl.description, value: cell.value, href: cell.href, extra: cell.extra }],
    );
  }, [p, definition, cells]);
  const outside = useMemo(() => undeclaredFields(item, definition.fields), [item, definition]);

  const title = p.title ?? `Untitled ${singular}`;
  const listName = names.plural.trim();
  const readThrough = version
    ? `Read through ${VERSION_WORDS[version]} ${listName || "this list"}.`
    : `Read through ${listName ? `the ${listName} list` : "this list"}.`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-accent">
          {singular}{" "}
          <span className="font-normal normal-case tracking-normal text-mute">in {plural}</span>
        </p>
        <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="flex min-w-[16rem] flex-1 items-center gap-4">
            <Picture image={p.image} listImage={p.listImage} shape={p.imageShape ?? "round"} />
            <div className="min-w-0 flex-1">
              <h3
                className={cn(
                  "break-words font-serif text-[24px] font-light leading-[1.2]",
                  p.title === null ? "italic text-mute" : "text-ink",
                )}
              >
                {title}
              </h3>
              {p.summary ? <p className="mt-1 break-words text-[14px] leading-[1.5] text-ink-soft">{p.summary}</p> : null}
            </div>
          </div>
          {links.length > 0 ? (
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  {...OUT}
                  className="inline-flex max-w-full items-baseline gap-1.5 border border-rule bg-surface px-3 py-1.5 text-[12px] text-ink transition-colors hover:border-rule-strong hover:text-accent"
                  style={ROUNDED}
                >
                  {l.label === l.host ? (
                    l.host
                  ) : (
                    <>
                      {l.label} <span className="text-[11px] text-mute">{l.host}</span>
                    </>
                  )}
                  <span aria-hidden className="text-[11px] text-mute">
                    &#8599;
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {p.facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[13px]">
          {p.facts.map((fact) => (
            <div key={fact.field} className="contents">
              <dt className="text-mute">{fact.label}</dt>
              <dd className="text-ink-soft">
                <Value value={fact.value} href={fact.href} />
                <Extra count={fact.extra} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {p.media?.kind === "audio" ? (
        <audio controls preload="none" src={p.media.url} aria-label={title} className="w-full" />
      ) : p.media?.kind === "video" ? (
        <video
          controls
          playsInline
          // With the item's picture to show, nothing is fetched until it is played.
          preload={p.image ? "none" : "metadata"}
          poster={p.image ?? undefined}
          src={p.media.url}
          aria-label={title}
          className="max-h-80 w-full bg-black"
          style={ROUNDED}
        />
      ) : null}

      {p.location ? <ItemMap location={p.location} title={title} /> : null}

      {missing.length > 0 ? (
        <p
          role="note"
          className="border border-rule bg-surface p-3 text-[13px] leading-[1.55] text-ink-soft"
          style={ROUNDED}
        >
          Missing {missing.join(", ")}. The list requires {missing.length === 1 ? "it" : "them"}.
        </p>
      ) : null}

      <MoreFields fields={more} outside={outside} />

      <p className="text-[11px] leading-[1.5] text-mute">{readThrough}</p>
    </div>
  );
}
