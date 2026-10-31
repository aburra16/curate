"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { UNTITLED_LIST } from "@/app/discover-model";
import { EditHeaderForm } from "@/components/edit-header-form";
import { EventPanel, type PanelCopy } from "@/components/event-panel";
import { FieldsPanel } from "@/components/fields-panel";
import { RelayStatusLine } from "@/components/relay-status-line";
import { UserIdentity } from "@/components/user-identity";
import { VersionsMenu } from "@/components/versions-menu";
import { useReader } from "@/hooks/use-reader";
import { B_DEFERRED, type HeaderEvent } from "@/lib/conceptResolution";
import { headerEditIsLossless } from "@/lib/curate/editGuard";
import { formatRelativeTime } from "@/lib/format";
import { parseListHeader } from "@/lib/nostr/parsers";
import type { ListHeader } from "@/lib/nostr/types";
import { conceptRefOf, groupConcepts, handleOf } from "@/services/concepts";
import { houseCopyAuthors, loadConceptHeaders } from "@/services/dictionary";
import { shownItems } from "@/services/items";
import { namesOf } from "@/services/jsonData";
import type { NostrEvent } from "nostr-tools/pure";
import { itemKindsOf } from "./items-model";
import { ListItems } from "./list-items";
import { listHref, listModel, type ListModel } from "./list-model";
import { panelHref } from "./panel-model";
import { useListItems } from "./use-list-items";
import { usePanelEvent } from "./use-panel-event";

/** What the page reads for one link: the list's headers and whose copies are Brainstorm's own. */
interface Loaded {
  headers: HeaderEvent[];
  houseAuthors: string[];
}

const NO_HANDLES = "[]";
const NO_KINDS = "[]";

// -- the route -------------------------------------------------------------

/**
 * A list: `/list?c=<coordinate, naddr or event id>[&version=<author>]`.
 * Curate is a static site, so what to open travels in the query string, and
 * reading it needs a Suspense boundary (Next prerenders the shell and fills
 * this in in the browser).
 *
 * The event panel's state travels beside it: `&item=<address or id>` for an
 * item (or any event a link in the panel names), `&event=header` for the
 * list's header.
 */
export default function ListPage() {
  return (
    <Suspense fallback={<Shell><TopSkeleton /></Shell>}>
      <ListRoute />
    </Suspense>
  );
}

function ListRoute() {
  const params = useSearchParams();
  const c = params.get("c")?.trim() ?? "";
  const version = params.get("version") || null;
  const item = params.get("item")?.trim() || null;
  const headerOpen = params.get("event") === "header";
  // A new list starts from nothing: nothing of the last one's state carries over.
  return c ? (
    <ListView key={c} c={c} version={version} item={item} headerOpen={headerOpen} query={params} />
  ) : (
    <Shell>
      <NotFound heading="No list chosen" detail="Open a list from Discover." />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1100px] px-8 py-12">
      <Link href="/" className="text-[13px] text-mute hover:text-ink-soft transition-colors">
        &larr; Back to Discover
      </Link>
      {children}
    </div>
  );
}

function TopSkeleton() {
  return (
    <div className="mt-8">
      <div className="h-10 w-64 bg-rule/50 animate-pulse" style={{ borderRadius: "var(--radius-input)" }} />
      <div className="mt-4 h-5 w-96 max-w-full bg-rule/30 animate-pulse" style={{ borderRadius: "var(--radius-input)" }} />
    </div>
  );
}

function NotFound({ heading, detail }: { heading: string; detail: string }) {
  return (
    <div className="mt-16 text-center">
      <p className="font-serif text-[20px] text-ink-soft italic">{heading}</p>
      <p className="mt-3 text-[13px] text-mute">{detail}</p>
      <div className="mx-auto max-w-md text-left">
        <RelayStatusLine />
      </div>
    </div>
  );
}

// -- the top of the page ---------------------------------------------------

const DIFFERS_IN: Record<string, string> = {
  names: "names",
  description: "description",
  fields: "fields",
  display: "how items look",
  links: "links",
};

const andList = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** Whose version is shown. */
function whose(model: ListModel): string {
  switch (model.source) {
    case "personal":
      return "Your version";
    case "assistant":
      return "Your Assistant\u2019s version";
    case "house":
      return "Brainstorm\u2019s version";
    case "community":
      return "The community header";
    case "version":
      return "A selected version";
  }
}

/** How the shown version relates to the community header. `chosen`: a reader picked the version, rather than it being the one that applies to them. */
function relation(model: ListModel, chosen: boolean): string {
  switch (model.agreement) {
    case "agrees":
      return "Agrees with the community header.";
    case "differs":
      return `Differs from the community header in its ${andList.format(model.differences.map((d) => DIFFERS_IN[d]))}.`;
    case "no-local-copy":
      return chosen
        ? "This is the community\u2019s own header."
        : "No one\u2019s copy applies, so the community\u2019s own header is shown.";
    case "unknown":
      return "The community header was not found, so there is nothing to compare this with.";
  }
}

/** What a link's items are filed under when nothing is known of its header: the address or id it names. */
function handleNamed(c: string): string | null {
  const ref = conceptRefOf(c);
  return ref ? ("coordinate" in ref ? ref.coordinate : ref.id) : null;
}

/** What the event panel says in place of an event it has none of. */
const PANEL_NOTICES = {
  loading: "Reading the event from the relays\u2026",
  invalid: "That link does not name an event. An event is named by its address (kind:pubkey:identifier) or by its 64-character id.",
  missing: "No relay returned that event.",
  missingHeader: "This list\u2019s header was not found, so there is no header event to show.",
} as const;

function ListView({
  c,
  version,
  item,
  headerOpen,
  query,
}: {
  c: string;
  version: string | null;
  /** `?item=`: an event the panel shows. */
  item: string | null;
  /** `?event=header`. */
  headerOpen: boolean;
  /** The page's query, to build the panel's links from. */
  query: Iterable<[string, string]>;
}) {
  const router = useRouter();
  const reader = useReader();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showEditHeader, setShowEditHeader] = useState(false);

  // The list's headers: its own, and every one that points at it. Neither read rejects.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadConceptHeaders(c).catch(() => [] as HeaderEvent[]),
      houseCopyAuthors().catch(() => [] as string[]),
    ]).then(([headers, houseAuthors]) => {
      if (!cancelled) setLoaded({ headers, houseAuthors });
    });
    return () => {
      cancelled = true;
    };
  }, [c]);

  // What the top says, as this reader sees it. Signing in or out reads it again.
  const model = useMemo(
    () => (loaded ? listModel({ c, headers: loaded.headers, reader, houseAuthors: loaded.houseAuthors, version }) : undefined),
    [c, loaded, reader, version],
  );
  const redirect = model && "redirect" in model ? model.redirect : null;
  const shown = model && "root" in model ? model : null;
  // Nothing known of the link's header or copies: the list still opens from its items.
  const orphan = model === null ? handleNamed(c) : null;

  // A copy's link opens its concept, with the copy chosen.
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  // -- the items -------------------------------------------------------------

  const handlesKey = shown ? JSON.stringify(shown.handles) : orphan ? JSON.stringify([orphan]) : NO_HANDLES;
  const handles = useMemo(() => JSON.parse(handlesKey) as string[], [handlesKey]);
  const kindsKey = shown ? JSON.stringify(itemKindsOf(shown.definition.event)) : NO_KINDS;
  const itemKinds = useMemo(() => JSON.parse(kindsKey) as number[], [kindsKey]);
  const items = useListItems(handles, itemKinds);

  // -- the event panel -------------------------------------------------------

  const headerEvent = useMemo(() => (shown ? (shown.definition.event as NostrEvent) : null), [shown]);
  const subject = usePanelEvent({
    item,
    header: headerOpen,
    headerEvent,
    handles,
    itemKinds,
    held: items.held,
    firstLoaded: items.firstLoaded,
  });
  const panelOpen = subject.status !== "closed";
  /** What opened the panel, for focus to go back to; and whether opening it added a history entry that Back undoes. */
  const opener = useRef<HTMLElement | null>(null);
  const pushed = useRef(false);
  useEffect(() => {
    if (!panelOpen) {
      opener.current = null;
      pushed.current = false;
    }
  }, [panelOpen]);

  const openPanel = useCallback(
    (change: { item?: string; header?: boolean }, from: HTMLElement) => {
      opener.current = from;
      pushed.current = true;
      router.push(panelHref(query, change), { scroll: false });
    },
    [router, query],
  );
  const closePanel = useCallback(() => {
    // Closing what a click opened is Back; closing what a link opened leaves no entry to go back to.
    if (pushed.current) {
      pushed.current = false;
      router.back();
    } else {
      router.replace(panelHref(query, {}), { scroll: false });
    }
  }, [router, query]);
  // One function for every row, so a row is drawn again only when it changes.
  const openItem = useCallback(
    (identity: string, from: HTMLElement) => openPanel({ item: identity }, from),
    [openPanel],
  );
  const eventHref = useCallback((value: string) => panelHref(query, { item: value }), [query]);
  const returnFocus = useCallback(() => opener.current, []);

  // The header's Raw can show any copy of the concept: each version's own event.
  const copies = useMemo((): PanelCopy[] => {
    if (!loaded || !shown) return [];
    return shown.versions.flatMap((v) => {
      const event = loaded.headers
        .filter((h) => handleOf(h) === v.coordinate && h.pubkey === v.author)
        .sort((a, b) => b.created_at - a.created_at)[0];
      return event ? [{ label: v.label, author: v.author, event: event as NostrEvent }] : [];
    });
  }, [loaded, shown]);

  const panel = !panelOpen ? null : (
    <EventPanel
      event={subject.status === "ready" ? subject.event : null}
      notice={
        subject.status === "ready"
          ? null
          : subject.status === "missing" && headerOpen
            ? PANEL_NOTICES.missingHeader
            : PANEL_NOTICES[subject.status]
      }
      header={subject.status === "ready" && subject.role === "header"}
      foreign={subject.status === "ready" && subject.role === "foreign"}
      definition={shown?.definition ?? null}
      copies={copies}
      eventHref={eventHref}
      onClose={closePanel}
      returnFocus={returnFocus}
    />
  );

  // -- the writing features that stay until spec 2 replaces them -----------

  // They write to the community header, as they did when a list opened at its own address; failing that,
  // to the version shown. Neither is possible for a 39999 header or one that wasn't found.
  const writeHeader = useMemo((): ListHeader | null => {
    if (!loaded || !shown) return null;
    const community = groupConcepts(loaded.headers).groups.find((g) => g.root === shown.root)?.rootHeader ?? null;
    // Headers come off a relay signed; HeaderEvent only leaves out what these readers never use.
    return parseListHeader((community ?? shown.definition.event) as NostrEvent);
  }, [loaded, shown]);

  const handleHeaderUpdated = useCallback((updated: ListHeader) => {
    // The new version joins the headers, and the top reads it from there.
    setLoaded((prev) => (prev ? { ...prev, headers: [...prev.headers, updated.raw as HeaderEvent] } : prev));
    setShowEditHeader(false);
  }, []);

  // Edit rebuilds the header from a lossy model, so offer it only where an
  // unchanged save would publish the same event.
  const canEditHeader = useMemo(
    () => (writeHeader && reader.pubkey === writeHeader.author ? headerEditIsLossless(writeHeader.raw) : false),
    [writeHeader, reader.pubkey],
  );

  // -- drawing ---------------------------------------------------------------

  if (model === undefined || redirect) {
    return (
      <Shell>
        <TopSkeleton />
      </Shell>
    );
  }

  if (!shown) {
    // A link that names no list, or one with nothing filed under it either.
    if (!orphan || (items.firstLoaded && shownItems(items.held).length === 0)) {
      return (
        <Shell>
          <NotFound heading="List not found." detail="header not found" />
        </Shell>
      );
    }
    return (
      <Shell>
        <header className="mt-8">
          <h1 className="font-serif text-[36px] leading-[1.1] tracking-[-0.015em] text-ink font-light break-words">
            {UNTITLED_LIST}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-mute">
            <span
              className="border border-rule px-1.5 py-px text-[10px] tracking-[0.04em]"
              style={{ borderRadius: "var(--radius-input)" }}
            >
              header not found
            </span>
            <span className="font-mono text-[11px] break-all">{orphan}</span>
          </div>
          <p className="mt-3 text-[12px] leading-[1.5] text-mute">
            This list&apos;s header couldn&apos;t be read, so its items are shown without it.
          </p>
          <RelayStatusLine />
        </header>
        <div className="mt-10 border-t border-rule pt-8">
          <ListItems
            handles={handles}
            definition={null}
            items={items}
            writeHeader={null}
            onOpenItem={openItem}
          />
        </div>
        {panel}
      </Shell>
    );
  }

  const { definition } = shown;
  const names = namesOf(definition.event);
  const plural = names.plural || UNTITLED_LIST;
  const image = definition.display.listImage;
  const editsShown = writeHeader?.raw.id === definition.event.id;
  // A header that opted out of the concept (`["b","b-tag-deferred"]`) is opened by a link to it, and says so.
  const withdrawn = definition.event.tags.some((t) => t[0] === "b" && t[1] === B_DEFERRED);

  return (
    <Shell>
      <header className="mt-8">
        <div className="flex items-start gap-4">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="h-16 w-16 shrink-0 object-cover border border-rule"
              style={{ borderRadius: "var(--radius-input)" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="font-serif text-[36px] leading-[1.1] tracking-[-0.015em] text-ink font-light break-words">
              {plural}
            </h1>
            {names.description ? (
              <p className="mt-3 font-serif text-[16px] leading-[1.5] text-ink-soft italic">{names.description}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-mute">
          <span>{withdrawn ? "A header on its own" : whose(shown)}</span>
          <span aria-hidden className="text-rule-strong">
            &middot;
          </span>
          <span className="inline-flex items-center gap-1">
            by <UserIdentity pubkey={definition.event.pubkey} avatarSize={18} textClass="text-[12px]" />
          </span>
          <span aria-hidden className="text-rule-strong">
            &middot;
          </span>
          <span>{formatRelativeTime(definition.event.created_at)}</span>
          {shown.headerMissing || withdrawn ? (
            <span
              className="border border-rule px-1.5 py-px text-[10px] tracking-[0.04em]"
              style={{ borderRadius: "var(--radius-input)" }}
            >
              {withdrawn ? "withdrawn" : "header not found"}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {withdrawn ? null : <p className="text-[12px] leading-[1.5] text-mute">{relation(shown, !!version)}</p>}
          {shown.versions.length > 1 ? (
            <VersionsMenu
              versions={shown.versions}
              current={definition.coordinate}
              onSelect={(v) => router.push(listHref(shown.root, v.author))}
            />
          ) : null}
          {version ? (
            <Link href={listHref(shown.root)} className="text-[12px] text-accent hover:underline">
              Show the version that applies to me
            </Link>
          ) : null}
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={(e) => openPanel({ header: true }, e.currentTarget)}
            className="border border-rule bg-surface px-2.5 py-1 text-[12px] text-ink-soft transition-colors duration-150 hover:border-rule-strong hover:text-ink"
            style={{ borderRadius: "var(--radius-input)" }}
          >
            View event
          </button>
        </div>

        <RelayStatusLine />

        {canEditHeader && !showEditHeader ? (
          <button
            type="button"
            onClick={() => setShowEditHeader(true)}
            className="mt-4 text-[12px] text-mute hover:text-accent transition-colors"
          >
            {editsShown ? "Edit list details" : "Edit the community header"}
          </button>
        ) : null}
      </header>

      {showEditHeader && writeHeader ? (
        <div className="mt-6 border border-accent/20 bg-surface p-5" style={{ borderRadius: "var(--radius-card)" }}>
          <EditHeaderForm
            header={writeHeader}
            onUpdated={handleHeaderUpdated}
            onCancel={() => setShowEditHeader(false)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <FieldsPanel fields={definition.fields} />
      </div>

      <div className="mt-10 border-t border-rule pt-8">
        <ListItems
          handles={handles}
          definition={definition}
          items={items}
          writeHeader={writeHeader}
          onOpenItem={openItem}
        />
      </div>
      {panel}
    </Shell>
  );
}
