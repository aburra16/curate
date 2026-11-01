"use client";

import { memo, useCallback, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { ConfirmWrite } from "@/components/confirm-write";
import { ItemForm } from "@/components/item-form";
import { ItemRow } from "@/components/item-row";
import { TrustFold } from "@/components/trust-fold";
import { VoteButtons } from "@/components/vote-buttons";
import { useReader } from "@/hooks/use-reader";
import { useTemplates } from "@/hooks/use-templates";
import type { ConceptDefinition } from "@/lib/conceptResolution";
import { deletionTemplate } from "@/lib/curate/writeTemplates";
import { ITEM_ORDERS, type ItemOrder } from "@/lib/dictionaryItems";
import { DLIST_ITEM_KIND, DLIST_ITEM_KINDS } from "@/lib/dlistFields";
import { itemLinks, type LinkRef, type UrlTemplate } from "@/lib/linkTemplates";
import { cn } from "@/lib/utils";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { mergePages, shownItems } from "@/services/items";
import { namesOf } from "@/services/jsonData";
import type { ReactionCount } from "@/services/reactions";
import { inWebOfTrust } from "@/services/trust";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useShowEverything } from "@/stores/view";
import { itemsModel, singularOf, withoutRemoved, type RowModel } from "./items-model";
import {
  useAuthorRanks,
  useItemCount,
  useReactions,
  useSearchedItems,
  type ListItems as Loaded,
} from "./use-list-items";

interface Props {
  /** What the list's items are filed under. */
  handles: string[];
  /** The definition the page shows, which items are added and changed under; null when no header was found, and every row is untitled. */
  definition: ConceptDefinition | null;
  /** The pages and live items read so far (`useListItems`). */
  items: Loaded;
  /** Opens an item's event panel, handed the element that opened it. */
  onOpenItem?: (identity: string, opener: HTMLElement) => void;
}

const NO_LINKS: LinkRef[] = [];
/** What a row's votes are until they are read: none, and the reader's own not known. */
const NO_VOTES: ReactionCount = { up: 0, down: 0, mine: null };
/** The orders a list offers: newest, or A to Z by title. */
const ORDERS = ITEM_ORDERS.filter((o) => o.key === "newest" || o.key === "name");
/** How many rows are drawn at first, and how many more each "Show more" draws. */
const ROWS_AT_ONCE = 500;

/**
 * Rows drawn `ROWS_AT_ONCE` at a time, with "Show more" for the next lot of
 * those already loaded (relay pages are "Load more"'s). One page can bring
 * thousands: a crowded second is read whole.
 */
function RowWindow({ rows, draw }: { rows: RowModel[]; draw: (row: RowModel) => ReactNode }) {
  const [drawn, setDrawn] = useState(ROWS_AT_ONCE);
  return (
    <>
      {rows.slice(0, drawn).map(draw)}
      {rows.length > drawn ? (
        <button
          type="button"
          onClick={() => setDrawn((n) => n + ROWS_AT_ONCE)}
          className="self-center text-[13px] font-medium px-6 py-2 border border-rule text-ink-soft hover:text-ink hover:border-rule-strong bg-surface transition-all duration-150"
          style={{ borderRadius: "var(--radius-input)" }}
        >
          Show more
        </button>
      ) : null}
    </>
  );
}

/**
 * A list's items: the count, search and order, the rows, the
 * items from outside the reader's web of trust folded below them, and
 * "Load more". Rows are read through the definition the page shows, and
 * drawn 500 at a time; search, order and the fold read every row loaded.
 */
export function ListItems({ handles, definition, items, onOpenItem }: Props) {
  const reader = useReader();
  const observer = reader.pubkey ?? "house";
  const { on: showEverything } = useShowEverything();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<ItemOrder>("newest");
  const [showAddForm, setShowAddForm] = useState(false);

  // Search reads what's loaded; past that, while more pages remain, the index finds the rest.
  const found = useSearchedItems(handles, query, items.more);
  const all = useMemo(() => (found.length ? mergePages(items.held, found) : items.held), [items.held, found]);
  const visible = useMemo(() => shownItems(withoutRemoved(all, items.removed)), [all, items.removed]);
  const authors = useMemo(() => visible.map((item) => item.pubkey), [visible]);

  // The reader is ranked with the authors, so their own vote moves the count when the scorer ranks them inside
  // the line, as a read of the votes does. They have no items here to fold unless they are an author already.
  const ranked = useMemo(
    () => (reader.pubkey && authors.length ? [...authors, reader.pubkey] : authors),
    [authors, reader.pubkey],
  );
  // Anyone the scorer didn't answer for is asked again as authors or pages come in.
  const { ranks, answered, rankMore } = useAuthorRanks(ranked, observer, items.pages);
  // Votes are counted once the scorer has answered at all.
  const { counts: reactions, setCount } = useReactions(
    visible,
    answered.size ? ranks : null,
    observer,
    rankMore,
    reader.pubkey,
  );
  // A vote the reader casts moves the count only if they are one of the people it is made of.
  const readerCounts = reader.pubkey !== null && inWebOfTrust(ranks, reader.pubkey);
  const refs = definition?.links ?? NO_LINKS;
  const templates = useTemplates(refs);
  const count = useItemCount(handles);

  const searched = useDeferredValue(query);
  const model = useMemo(
    () =>
      itemsModel({ items: all, definition, ranks, answered, removed: items.removed, showEverything, query: searched, order }),
    [all, definition, ranks, answered, items.removed, showEverything, searched, order],
  );

  const names = definition ? namesOf(definition.event) : null;
  const plural = names?.plural || "items";
  const singular = names?.singular || "item";
  // A list that declares no fields gives the form nothing to fill in.
  const noFields = definition !== null && definition.fields.length === 0;
  const canAdd = definition !== null && !noFields;
  const loaded = useMemo(
    () => shownItems(withoutRemoved(items.held, items.removed)).length,
    [items.held, items.removed],
  );
  const total = count ?? (items.firstLoaded ? loaded : null);
  const searching = searched.trim() !== "";
  const matches = model.shown.length + model.folded;

  // Every prop is kept stable while its row is unchanged, so a keystroke or a page redraws only the rows it changes.
  const row = (r: RowModel) => (
    <EditableRow
      key={r.identity}
      row={r}
      refs={refs}
      templates={templates}
      reactions={reactions.get(r.identity) ?? null}
      readerCounts={readerCounts}
      onVoted={setCount}
      definition={definition}
      reader={reader.pubkey}
      onSaved={items.add}
      versionsOf={items.versionsOf}
      onRemoved={items.remove}
      onOpenItem={onOpenItem}
    />
  );

  return (
    <section aria-label="Items">
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-mute" aria-live="polite">
            {total === null ? (
              <span className="text-accent/60">loading...</span>
            ) : searching ? (
              `${matches.toLocaleString()} of ${total.toLocaleString()} ${plural}`
            ) : (
              <span title={count === null ? "Loaded so far" : "Everything filed, before the web-of-trust filter"}>
                {total.toLocaleString()} {plural}
              </span>
            )}
            {/* The index's COUNT can't filter by trust: the list says so. */}
            {count !== null ? (
              <>
                <span aria-hidden className="mx-1.5 text-rule-strong">
                  &middot;
                </span>
                <span className="text-[11px] text-mute/80">counted before the web-of-trust filter</span>
              </>
            ) : null}
          </p>

          {noFields ? (
            <p className="max-w-[28rem] text-[12px] leading-[1.5] text-mute">
              This list declares no fields, so there is nothing for Curate&apos;s form to fill in.
            </p>
          ) : canAdd && !showAddForm ? (
            <button
              type="button"
              // Signed out, it invites the reader to connect.
              onClick={() => (reader.pubkey ? setShowAddForm(true) : useConnectDialog.getState().show())}
              className="text-[12px] font-medium px-4 py-1.5 bg-accent text-ink hover:brightness-110 transition-all"
              style={{ borderRadius: "var(--radius-input)" }}
            >
              {reader.pubkey ? `+ Add ${singular}` : `Connect to add a ${singular}`}
            </button>
          ) : null}
        </div>

        {items.lost.length ? (
          <p className="text-[12px] leading-[1.5] text-mute">
            {`Some ${plural} couldn't be loaded: more were listed in one second than the relays send at once.`}
          </p>
        ) : null}

        {items.firstLoaded && (visible.length > 0 || query) ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${plural}...`}
              aria-label={`Search ${plural}`}
              className={cn(
                "w-full md:max-w-sm bg-surface text-ink placeholder:text-mute/60",
                "border border-rule px-3.5 py-2 text-[14px] outline-none",
                "focus:border-rule-strong focus:bg-surface-hover transition-all duration-200",
              )}
              style={{ borderRadius: "var(--radius-input)" }}
            />
            <div role="group" aria-label="Order" className="flex items-center gap-1 text-[12px]">
              {ORDERS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={order === o.key}
                  onClick={() => setOrder(o.key)}
                  className={cn(
                    "px-2.5 py-1 border transition-colors",
                    order === o.key ? "border-rule-strong text-ink" : "border-transparent text-mute hover:text-ink-soft",
                  )}
                  style={{ borderRadius: "var(--radius-input)" }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {showAddForm && canAdd ? (
        <div className="mb-6 border border-accent/20 bg-surface p-5" style={{ borderRadius: "var(--radius-card)" }}>
          <ItemForm
            definition={definition}
            templates={templates}
            onSaved={(event) => {
              setShowAddForm(false);
              items.add([event]);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      ) : null}

      {!items.firstLoaded ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[96px] animate-pulse border border-rule bg-surface"
              style={{ borderRadius: "var(--radius-card)", opacity: 0.5 - i * 0.12 }}
            />
          ))}
        </div>
      ) : model.shown.length === 0 && model.folded === 0 ? (
        <div className="py-12 text-center">
          <p className="font-serif text-[18px] text-ink-soft italic">
            {searching ? "No items match your search." : "No items yet."}
          </p>
          <p className="mt-2 text-[13px] text-mute">
            {searching ? "Try a different search term." : canAdd ? "Be the first to add something to this list." : null}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <RowWindow rows={model.shown} draw={row} />
        </div>
      )}

      <TrustFold count={model.folded}>{() => <RowWindow rows={model.foldedRows} draw={row} />}</TrustFold>

      {items.stalled ? (
        <p className="mt-6 text-center text-[12px] text-mute">A relay didn&apos;t answer. Load more asks it again.</p>
      ) : null}
      {items.more ? (
        <div className={cn("flex justify-center", items.stalled ? "mt-2" : "mt-6")}>
          <button
            type="button"
            onClick={items.loadMore}
            disabled={items.loadingMore}
            className="text-[13px] font-medium px-6 py-2 border border-rule text-ink-soft hover:text-ink hover:border-rule-strong bg-surface transition-all duration-150 disabled:opacity-60"
            style={{ borderRadius: "var(--radius-input)" }}
          >
            {items.loadingMore ? "Loading..." : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The ids a deletion of `item` names: every version of it the page holds that
 * its author made, and the item as shown (a search result is not held). Another
 * author's copy of the item is not named: a deletion removes only its author's
 * own events.
 */
function versionsToName(item: ItemEvent, versionsOf: (identity: string, author?: string) => string[]): string[] {
  const held = versionsOf(itemIdentity(item), item.pubkey);
  return held.includes(item.id) ? held : [item.id, ...held];
}

/**
 * A row, and its Edit while the reader is the author of an addressable item
 * (a kind 9999 can't be replaced) under a list that declares fields to change.
 * Edit keeps every tag the item has, so any such item can be changed. Delete
 * is offered to the same author on a 9999 as well, under the same lists, and
 * asks first. Drawn again only when a prop changes.
 */
const EditableRow = memo(function EditableRow({
  row,
  refs,
  templates,
  reactions,
  readerCounts,
  onVoted,
  definition,
  reader,
  onSaved,
  versionsOf,
  onRemoved,
  onOpenItem,
}: {
  row: RowModel;
  refs: LinkRef[];
  templates: Map<string, UrlTemplate>;
  /** The votes read for the item; null until they are. */
  reactions: ReactionCount | null;
  /** The reader is one of the people the votes are counted from. */
  readerCounts: boolean;
  /** Shows the count a vote the list relay took leaves. */
  onVoted: (identity: string, count: ReactionCount) => void;
  /** The definition the page shows; null when no header was found, and nothing can be changed. */
  definition: ConceptDefinition | null;
  reader: string | null;
  /** Merges what an edit published into the list. */
  onSaved: (events: ItemEvent[]) => void;
  /** The ids of an item's versions the page holds, an author's own only, for a deletion to name. */
  versionsOf: (identity: string, author?: string) => string[];
  /** Takes the item out of the list from now on, once its deletion is saved. */
  onRemoved: (identity: string, at: number) => void;
  onOpenItem?: (identity: string, opener: HTMLElement) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { identity } = row;
  const onOpen = useMemo(
    () => (onOpenItem ? (opener: HTMLElement) => onOpenItem(identity, opener) : undefined),
    [onOpenItem, identity],
  );
  const onCounted = useCallback((count: ReactionCount) => onVoted(identity, count), [onVoted, identity]);
  // Items come off a relay signed; ItemEvent only leaves out what the readers never use.
  const event = row.item as NostrEvent;
  const own = !!definition && definition.fields.length > 0 && !!reader && reader === event.pubkey;
  const editable = own && event.kind === DLIST_ITEM_KIND;
  const deletable = own && (DLIST_ITEM_KINDS as readonly number[]).includes(event.kind);
  const links = useMemo(() => itemLinks(event, refs, templates), [event, refs, templates]);

  if (editing && editable && definition) {
    return (
      <div className="border border-accent/20 bg-surface px-5 py-4" style={{ borderRadius: "var(--radius-card)" }}>
        <ItemForm
          definition={definition}
          templates={templates}
          item={row.item}
          onSaved={(saved) => {
            setEditing(false);
            onSaved([saved]);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <ItemRow
      row={row}
      links={links}
      onOpen={onOpen}
      actions={
        <>
          {editable && !deleting ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-mute hover:text-accent transition-colors"
            >
              Edit
            </button>
          ) : null}
          {deletable && !deleting ? (
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="text-[11px] text-mute hover:text-accent transition-colors"
            >
              Delete
            </button>
          ) : null}
          <VoteButtons item={row.item} count={reactions ?? NO_VOTES} readerCounts={readerCounts} onVoted={onCounted} />
        </>
      }
      asking={
        deleting && deletable ? (
          <ConfirmWrite
            question={`Delete this ${singularOf(definition)}? Relays that honour deletions will drop it.`}
            confirmLabel="Delete"
            busyLabel="Deleting…"
            template={() => deletionTemplate(event, versionsToName(event, versionsOf))}
            // The row leaves even if the item is dated after the deletion was signed.
            onDone={(deletion) => onRemoved(identity, Math.max(deletion.created_at, event.created_at))}
            onCancel={() => setDeleting(false)}
          />
        ) : undefined
      }
    />
  );
});
