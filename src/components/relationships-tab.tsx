"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { UNTITLED_LIST } from "@/app/discover-model";
import { listHref } from "@/app/list/list-model";
import { panelHref } from "@/app/list/panel-model";
import { CopyButton } from "@/components/copy-button";
import { UserIdentity } from "@/components/user-identity";
import { useReader } from "@/hooks/use-reader";
import { coordinateOf, DLIST_HEADER_KIND, DLIST_ITEM_KIND, formatCoordinate, isDListHeader, parseCoordinate } from "@/lib/dlistFields";
import { shortHex } from "@/lib/format";
import { jsonDataOf } from "@/services/jsonData";
import { loadRelationships, type Related, type Relationships, type TagSummary } from "@/services/relationships";
import { fetchAuthorRanks } from "@/services/trust";

export interface RelationshipsTabProps {
  event: NostrEvent;
  /** The reader's scorer's ranks of the people the page holds, and the ones it answered for. */
  ranks: Map<string, number>;
  answered: ReadonlySet<string>;
  /** Where a link to another event goes. */
  eventHref: (value: string) => string;
}

const HEX64 = /^[0-9a-f]{64}$/i;

const chip = "shrink-0 border border-rule px-1.5 py-px text-[10px] tracking-[0.04em] text-mute";
// A link says so with more than its colour: it is underlined too.
const link = "text-accent underline underline-offset-2 break-words [overflow-wrap:anywhere]";
const subtle = "text-[13px] leading-[1.55] text-mute";

// -- what a row is called, and where it goes ----------------------------------------

/** What a copy or a mention is called: its `name` or `title`, else the `word` of its JSON, else its `d`. */
function titleOf(ev: NostrEvent): string {
  const tagged = (name: string) => ev.tags.find((t) => t[0] === name && typeof t[1] === "string" && t[1].trim())?.[1].trim();
  const word = jsonDataOf(ev, "word");
  const inJson = [word?.title, word?.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return tagged("name") ?? tagged("title") ?? inJson?.trim() ?? tagged("d") ?? "Untitled item";
}

/** The item as a list page names it: its address, else (for an event with none) its id. */
const identityOf = (ev: NostrEvent): string => coordinateOf(ev) ?? ev.id;

/** A value as a copy button's name says it: an id, or the key in an address, cut short, so it can be heard and told apart. */
function spoken(value: string): string {
  if (HEX64.test(value)) return shortHex(value, 8, 4);
  const c = parseCoordinate(value);
  return c ? `${c.kind}:${shortHex(c.pubkey, 8, 4)}:${c.d}` : value;
}

/** Where a copy or a mention opens: the list it is on, with its panel open. Null when it names no list. */
const relatedHref = ({ event, listRef }: Related): string | null =>
  listRef ? panelHref([["c", listRef]], { item: identityOf(event) }) : null;

type Target = { kind: "person" } | { kind: "list" | "event"; href: string };

/** What a value an event names points at: a person, a list's page, or an event's panel. Anything else points nowhere. */
function targetOf(tag: "p" | "e" | "a" | "t", value: string, eventHref: (value: string) => string): Target | null {
  if (tag === "p") return HEX64.test(value) ? { kind: "person" } : null;
  if (tag === "e") return HEX64.test(value) ? { kind: "event", href: eventHref(value.toLowerCase()) } : null;
  if (tag !== "a") return null;
  const c = parseCoordinate(value);
  if (!c) return null;
  const address = formatCoordinate(c);
  if (c.kind === DLIST_HEADER_KIND) return { kind: "list", href: listHref(address) };
  return c.kind === DLIST_ITEM_KIND ? { kind: "event", href: eventHref(address) } : null;
}

const NAMED_WORDS = { p: "person", e: "event", a: "address", t: "hashtag" } as const;

// -- parts --------------------------------------------------------------------------

function Part({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
        {title}
        {count === undefined ? null : (
          <>
            {" "}
            <span className="font-normal tabular-nums">{count}</span>
          </>
        )}
      </h3>
      {children}
    </section>
  );
}

const rowClass = "flex items-start justify-between gap-3 border-t border-rule py-2 text-[13px] first:border-t-0 first:pt-0 last:pb-0";

/** A copy or a mention: its title (a link when it opens somewhere), who made it, and, if asked, the list it is on. */
function RelatedRow({ related, showList }: { related: Related; showList: boolean }) {
  const { event, listRef, listName } = related;
  const href = relatedHref(related);
  const title = titleOf(event);
  return (
    <li className={rowClass}>
      <div className="min-w-0">
        {href ? (
          <Link href={href} className={link}>
            {title}
          </Link>
        ) : (
          <span className="break-words text-ink-soft [overflow-wrap:anywhere]">{title}</span>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-mute">
          <span>by</span>
          <UserIdentity pubkey={event.pubkey} avatarSize={16} textClass="text-[12px]" />
          {showList && listRef ? (
            <>
              <span aria-hidden>&middot;</span>
              <span>on</span>
              <Link href={listHref(listRef)} className={link}>
                {listName ?? UNTITLED_LIST}
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {href ? null : (
        <CopyButton text={identityOf(event)} label={`${coordinateOf(event) ? "address" : "event id"} ${spoken(identityOf(event))}`} />
      )}
    </li>
  );
}

/** One list's mentions: the list's name as the group's heading, then its items. */
function MentionGroup({ listRef, name, rows }: { listRef: string | null; name: string | null; rows: Related[] }) {
  const headingId = useId();
  const label = name ?? (listRef ? UNTITLED_LIST : "Not on a list");
  return (
    <div role="group" aria-labelledby={headingId}>
      <h4 id={headingId} className="mb-1.5 text-[13px] font-normal text-ink">
        {listRef ? (
          <Link href={listHref(listRef)} className={link}>
            {label}
          </Link>
        ) : (
          label
        )}
      </h4>
      <ul>
        {rows.map((m) => (
          <RelatedRow key={m.event.id} related={m} showList={false} />
        ))}
      </ul>
    </div>
  );
}

/** Mentions under the list each is on, in the order they were read. */
function MentionGroups({ mentions }: { mentions: Related[] }) {
  const groups = new Map<string, { ref: string | null; name: string | null; rows: Related[] }>();
  for (const m of mentions) {
    const key = m.listRef ?? "";
    const group = groups.get(key) ?? { ref: m.listRef, name: m.listName, rows: [] };
    group.rows.push(m);
    groups.set(key, group);
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.values()].map(({ ref, name, rows }) => (
        <MentionGroup key={ref ?? ""} listRef={ref} name={name} rows={rows} />
      ))}
    </div>
  );
}

function TagChips({ tags }: { tags: TagSummary[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <li
          key={t.address}
          className="border border-rule bg-surface px-2.5 py-1 text-[12px]"
          style={{ borderRadius: "var(--radius-input)" }}
        >
          <span className="break-words text-ink [overflow-wrap:anywhere]">{t.name}</span>
          {t.applied ? (
            <>
              {" "}
              <span className="text-[11px] text-mute">applied by {t.applied}</span>
            </>
          ) : null}
          {t.disputed ? (
            <>
              {" "}
              <span className="text-[11px] text-mute">disputed by {t.disputed}</span>
            </>
          ) : null}
          {t.mine ? (
            <>
              {" "}
              <span className="text-[11px] text-accent">{t.mine === "apply" ? "you applied" : "you disputed"}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** What the event names: a person by name, a list or an item as a link, anything else as its value to copy. */
function NamedRow({ named, eventHref }: { named: Relationships["names"][number]; eventHref: (value: string) => string }) {
  const { tag, value } = named;
  const target = targetOf(tag, value, eventHref);
  return (
    <li className={rowClass}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={chip} style={{ borderRadius: "var(--radius-input)" }}>
          {NAMED_WORDS[tag]}
        </span>
        {target?.kind === "person" ? (
          <UserIdentity pubkey={value.toLowerCase()} avatarSize={16} textClass="text-[12px]" />
        ) : target ? (
          <Link
            href={target.href}
            {...(target.kind === "event" ? { replace: true, scroll: false } : {})}
            className={`${link} font-mono text-[12px]`}
          >
            {value}
          </Link>
        ) : (
          <span className="break-words text-ink-soft [overflow-wrap:anywhere]">{value}</span>
        )}
      </div>
      {target ? null : <CopyButton text={value} label={`${NAMED_WORDS[tag]} ${spoken(value)}`} />}
    </li>
  );
}

/** Copies and mentions by people the reader's scorer ranked outside the line, behind a button. */
function OutsideFold({ copies, mentions }: Relationships["folded"]) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-7">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full border border-dashed border-rule px-4 py-2.5 text-left text-[12px] text-mute transition-colors hover:border-rule-strong hover:text-ink-soft"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        From outside your web of trust ({copies.length + mentions.length})
      </button>
      {open ? (
        <div className="mt-3">
          {copies.length ? (
            <Part title="Copies" count={copies.length}>
              <ul>
                {copies.map((c) => (
                  <RelatedRow key={c.event.id} related={c} showList />
                ))}
              </ul>
            </Part>
          ) : null}
          {mentions.length ? (
            <Part title="Mentioned by" count={mentions.length}>
              <MentionGroups mentions={mentions} />
            </Part>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The tab's own page: what focus is given to when a control in it goes (Try again), and busy while it reads. */
function Page({ root, busy, children }: { root: RefObject<HTMLDivElement | null>; busy?: boolean; children: ReactNode }) {
  return (
    <div ref={root} tabIndex={-1} aria-busy={busy} className="outline-none">
      {children}
    </div>
  );
}

// -- the tab ------------------------------------------------------------------------

type Read = { status: "loading" } | { status: "failed" } | { status: "ready"; relationships: Relationships };

/**
 * What the event is connected to, read as the reader sees it: the lists an
 * item is on, its copies, the tags applied to it, the list items that
 * mention it, and what it names itself. A list header has no lists or
 * copies. Each section has a count and is hidden when it has nothing.
 *
 * It reads when it opens, and again only for another event or another
 * reader: ranks that arrive later don't ask again. Nothing here shows
 * anyone's rank; people outside the reader's web of trust sit in one fold.
 */
export function RelationshipsTab({ event, ranks, answered, eventHref }: RelationshipsTabProps) {
  const reader = useReader().pubkey;
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  // What a read uses of the page when it starts, so a later change of ranks doesn't start another.
  const page = useRef({ event, ranks, answered });
  useEffect(() => {
    page.current = { event, ranks, answered };
  });

  // The answer is kept with the question it answers, so a new event or reader shows nothing of the old one.
  const question = `${event.id}:${reader ?? ""}:${attempt}`;
  const [answer, setAnswer] = useState<{ question: string; relationships: Relationships | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const observer = reader ?? "house";
    const { event: asked, ranks: held, answered: heard } = page.current;
    loadRelationships(asked, held, heard, reader, (pubkeys) => fetchAuthorRanks(pubkeys, observer)).then(
      (relationships) => {
        if (!cancelled) setAnswer({ question, relationships });
      },
      () => {
        if (!cancelled) setAnswer({ question, relationships: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [question, reader]);

  const read: Read =
    answer?.question !== question
      ? { status: "loading" }
      : answer.relationships
        ? { status: "ready", relationships: answer.relationships }
        : { status: "failed" };

  const header = isDListHeader(event);
  const namesTitle = header ? "This list names" : "This item names";

  const tryAgain = () => {
    // The button is about to go: focus moves to the tab's own page first, so it doesn't fall to the document.
    root.current?.focus();
    setAttempt((n) => n + 1);
  };

  if (read.status === "loading") {
    const titles = header
      ? ["Tags", "Mentioned by", namesTitle]
      : ["On these lists", "Copies", "Tags", "Mentioned by", namesTitle];
    return (
      <Page root={root} busy>
        {titles.map((title) => (
          <Part key={title} title={title}>
            <p className={subtle}>Reading&hellip;</p>
          </Part>
        ))}
      </Page>
    );
  }

  if (read.status === "failed") {
    return (
      <Page root={root}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p role="alert" className={subtle}>
            Could not read what this is connected to.
          </p>
          <button
            type="button"
            onClick={tryAgain}
            className="border border-rule px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
            style={{ borderRadius: "var(--radius-input)" }}
          >
            Try again
          </button>
        </div>
      </Page>
    );
  }

  const r = read.relationships;
  // A header is on no list and has no copies, whatever was read.
  const lists = header ? [] : r.lists;
  const copies = header ? [] : r.copies;
  const folded = { copies: header ? [] : r.folded.copies, mentions: r.folded.mentions };
  const hasFolded = folded.copies.length + folded.mentions.length > 0;
  const empty = !lists.length && !copies.length && !r.tags.length && !r.mentions.length && !r.names.length && !hasFolded;

  return (
    <Page root={root}>
      {lists.length ? (
        <Part title="On these lists" count={lists.length}>
          <ul>
            {lists.map((l) => (
              <li key={l.ref} className={rowClass}>
                <Link href={listHref(l.ref)} className={l.name ? link : `${link} font-mono text-[12px]`}>
                  {l.name ?? l.ref}
                </Link>
              </li>
            ))}
          </ul>
        </Part>
      ) : null}

      {copies.length ? (
        <Part title="Copies" count={copies.length}>
          <ul>
            {copies.map((c) => (
              <RelatedRow key={c.event.id} related={c} showList />
            ))}
          </ul>
        </Part>
      ) : null}

      {r.tags.length ? (
        <Part title="Tags" count={r.tags.length}>
          <TagChips tags={r.tags} />
        </Part>
      ) : null}

      {r.mentions.length ? (
        <Part title="Mentioned by" count={r.mentions.length}>
          <MentionGroups mentions={r.mentions} />
        </Part>
      ) : null}

      {r.names.length ? (
        <Part title={namesTitle} count={r.names.length}>
          <ul>
            {r.names.map((n) => (
              <NamedRow key={`${n.tag}:${n.value}`} named={n} eventHref={eventHref} />
            ))}
          </ul>
        </Part>
      ) : null}

      {hasFolded ? <OutsideFold {...folded} /> : null}
      {empty ? (
        <p className="text-[13px] leading-[1.55] text-ink-soft">
          {/* A relay that didn't answer may hold what links here: only a full read says nothing does. */}
          {r.unread.length ? "Nothing found on the relays that answered" : "Nothing links here yet"}
        </p>
      ) : null}
      {r.unread.length ? (
        <p role="note" className="mt-7 text-[12px] leading-[1.5] text-mute">
          Didn&rsquo;t answer: {r.unread.join(", ")}. Anything only they hold is missing here.
        </p>
      ) : null}
    </Page>
  );
}
