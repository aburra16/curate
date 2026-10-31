"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { UNTITLED_LIST } from "@/app/discover-model";
import { singularOf } from "@/app/list/items-model";
import { listHref, type VersionLabel } from "@/app/list/list-model";
import { UserIdentity } from "@/components/user-identity";
import { B_DEFERRED, bLinksOf, type ConceptDefinition } from "@/lib/conceptResolution";
import {
  classifyTags,
  eventIdentity,
  itemView,
  jsonOf,
  type EventIdentity,
  type TagRole,
  type TagRow,
} from "@/lib/curate/eventView";
import { coordinateOf, isDListHeader, parseFieldDecls } from "@/lib/dlistFields";
import { formatRelativeTime, shortNpub } from "@/lib/format";
import { parseLinkRefs, templateSite, type UrlTemplate } from "@/lib/linkTemplates";
import { cn } from "@/lib/utils";
import { namesOf, presentCurateItem } from "@/services/jsonData";
import { seenOn } from "@/services/nostr";
import { fetchTemplates } from "@/services/templates";

export type PanelTab = "item" | "pretty" | "raw";

/** One copy of the list's concept, for the header's Raw to switch between. */
export interface PanelCopy {
  label: VersionLabel;
  author: string;
  event: NostrEvent;
}

export interface EventPanelProps {
  /** The event to show; null while it is being read or when it can't be, and `notice` says which. */
  event: NostrEvent | null;
  notice?: string | null;
  /** This is the list's own header: it has Pretty and Raw only, and the extras only a header has. */
  header: boolean;
  /** The event isn't one of this list's items (a link led here from another list): the list's definition doesn't describe it. */
  foreign?: boolean;
  /** The definition the list's items are read by; null when no header was found (the Item tab says so). */
  definition: ConceptDefinition | null;
  /** The tab to open on: Item for an item, else Pretty. */
  tab?: PanelTab;
  /** The concept's copies, newest first; the header's Raw can show any of them. */
  copies?: PanelCopy[];
  /** Where a link to another event goes. */
  eventHref: (value: string) => string;
  onClose: () => void;
  /** What had focus before the panel opened; focus goes back to it when the panel closes. */
  returnFocus?: () => HTMLElement | null;
}

const TAB_NAMES: Record<PanelTab, string> = { item: "Item", pretty: "Pretty", raw: "Raw" };

/** A link out of Curate: a new tab, no referrer, no endorsement. Only http(s) URLs reach here. */
const OUT = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

const chip = "shrink-0 border border-rule px-1.5 py-px text-[10px] tracking-[0.04em] text-mute";
// A link says so with more than its colour: it is underlined too.
const link = "text-accent underline underline-offset-2 break-all";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// -- the dialog ------------------------------------------------------------------

/**
 * A modal dialog's behaviour: focus moves into it when it opens and returns
 * to what opened it when it closes; Tab stays inside it; Escape closes it,
 * wherever focus has fallen; the page behind it doesn't scroll. Returns the
 * dialog's key handler (Tab).
 *
 * `shown` is what the dialog shows now (an event's id, or null while there
 * is none). When it changes, what was focused may be gone with the old
 * content (a link followed in the panel unmounts the link): focus is
 * brought back into the dialog, or Escape and the Tab wrap would have
 * nothing to hear them.
 */
function useDialog(
  dialog: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  returnFocus: (() => HTMLElement | null) | undefined,
  shown: string | null,
) {
  const latest = useRef({ onClose, returnFocus });
  useEffect(() => {
    latest.current = { onClose, returnFocus };
  });

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.focus();
    // Focus that lands outside (a screen reader's virtual cursor, a stray Tab) comes back.
    const keepIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !node.contains(e.target)) node.focus();
    };
    document.addEventListener("focusin", keepIn);
    // Escape closes the dialog wherever focus is: on the page's body, once what had it has been unmounted.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.stopPropagation();
      latest.current.onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("focusin", keepIn);
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = overflow;
      const back = latest.current.returnFocus?.();
      if (back?.isConnected) back.focus();
    };
  }, [dialog]);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.contains(document.activeElement)) node.focus();
  }, [dialog, shown]);

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

// -- small parts -------------------------------------------------------------------

/** A copy button: the text goes to the clipboard, and the button says so. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <span className="shrink-0">
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
        }}
        className="border border-rule px-2 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
        style={{ borderRadius: "var(--radius-input)" }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {state === "copied" ? `Copied ${label}` : state === "failed" ? `Could not copy ${label}` : ""}
      </span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{title}</h3>
      {children}
    </section>
  );
}

/** A block of text, kept as it is. A long one scrolls with the panel, not the page. */
function Block({ text, label }: { text: string; label: string }) {
  return (
    <pre
      role="group"
      aria-label={label}
      className="whitespace-pre-wrap break-words border border-rule bg-surface p-3 font-mono text-[12px] leading-[1.55] text-ink-soft"
      style={{ borderRadius: "var(--radius-input)" }}
    >
      {text}
    </pre>
  );
}

/** A date that a hostile `created_at` can't break. */
function WhenText({ seconds }: { seconds: number }) {
  const when = new Date(seconds * 1000);
  if (!Number.isFinite(when.getTime())) return <span>an unreadable date</span>;
  return (
    <span>
      <time dateTime={when.toISOString()}>{when.toLocaleString()}</time>{" "}
      <span className="text-mute">({formatRelativeTime(seconds)})</span>
    </span>
  );
}

// -- Pretty ------------------------------------------------------------------------

const ROLE_WORDS: Record<TagRole, string> = {
  field: "field",
  protocol: "protocol",
  metadata: "metadata",
  undeclared: "undeclared",
};

/** The value of a tag, as a link where it points somewhere, and plain text everywhere else. */
function TagValue({ row, eventHref }: { row: TagRow; eventHref: (value: string) => string }) {
  const value = typeof row.tag[1] === "string" ? row.tag[1] : "";
  const rest = row.tag.slice(2).filter((v): v is string => typeof v === "string" && v !== "");
  const target = row.target;

  let main: ReactNode;
  if (!value) main = <span className="text-mute">(no value)</span>;
  else if (!target) main = <span className="break-words [overflow-wrap:anywhere]">{value}</span>;
  else if (target.kind === "list") {
    main = (
      <Link href={listHref(target.value)} className={link}>
        {value}
      </Link>
    );
  } else if (target.kind === "event") {
    main = (
      <Link href={eventHref(target.value)} replace scroll={false} className={link}>
        {value}
      </Link>
    );
  } else if (target.kind === "profile") {
    main = <UserIdentity pubkey={target.value} avatarSize={16} textClass="text-[12px]" />;
  } else {
    main = (
      <a href={target.value} {...OUT} className={link}>
        {value}
      </a>
    );
  }

  return (
    <>
      {main}
      {rest.length ? (
        <span className="ml-2 break-words text-mute [overflow-wrap:anywhere]">{rest.join(" · ")}</span>
      ) : null}
      {row.label ? <p className="mt-0.5 text-[11px] leading-[1.45] text-mute">{row.label}</p> : null}
    </>
  );
}

function TagTable({
  event,
  definition,
  eventHref,
}: {
  event: NostrEvent;
  definition: ConceptDefinition | null;
  eventHref: (value: string) => string;
}) {
  const rows = useMemo(() => classifyTags(event, definition), [event, definition]);
  // A list's own tags (its names, fields, display and links) are what define it, not strays outside a definition.
  const undeclared = isDListHeader(event) ? "list tag" : ROLE_WORDS.undeclared;
  if (!rows.length) return <p className="text-[13px] text-mute">This event has no tags.</p>;

  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <thead className="sr-only">
        <tr>
          <th scope="col">Tag</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-rule align-top first:border-t-0">
            <th scope="row" className="w-[34%] py-2 pr-3 text-left font-normal">
              <span className="block break-words font-mono text-[12px] text-ink [overflow-wrap:anywhere]">
                {String(row.tag[0] ?? "")}
              </span>
              <span className={cn(chip, "mt-1 inline-block")} style={{ borderRadius: "var(--radius-input)" }}>
                {row.role === "undeclared" ? undeclared : ROLE_WORDS[row.role]}
              </span>
            </th>
            <td className="py-2 text-ink-soft">
              <TagValue row={row} eventHref={eventHref} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IdentityRows({ identity }: { identity: EventIdentity }) {
  const rows: [label: string, value: string][] = [["Event id", identity.id]];
  if (identity.coordinate) rows.push(["Coordinate", identity.coordinate]);
  rows.push([identity.bech32.startsWith("naddr") ? "naddr" : "nevent", identity.bech32]);
  return (
    <dl className="flex flex-col gap-2.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <dt className="text-[11px] text-mute">{label}</dt>
            <dd className="break-all font-mono text-[11px] leading-[1.5] text-ink-soft">{value}</dd>
          </div>
          <CopyButton text={value} label={label.toLowerCase()} />
        </div>
      ))}
    </dl>
  );
}

function Provenance({ event }: { event: NostrEvent }) {
  const relays = seenOn(event.id);
  return (
    <dl className="flex flex-col gap-2.5 text-[13px] text-ink-soft">
      <div>
        <dt className="text-[11px] text-mute">Author</dt>
        <dd className="mt-0.5">
          <UserIdentity pubkey={event.pubkey} avatarSize={18} textClass="text-[13px]" />
        </dd>
      </div>
      <div>
        <dt className="text-[11px] text-mute">Date</dt>
        <dd>
          <WhenText seconds={event.created_at} />
        </dd>
      </div>
      <div>
        <dt className="text-[11px] text-mute">Seen on</dt>
        <dd>
          {relays.length ? (
            <ul className="font-mono text-[12px]">
              {relays.map((relay) => (
                <li key={relay} className="break-all">
                  {relay}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-mute">No relay is recorded for this visit.</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The concept a header belongs to: itself when it points at its own address, else the list its `b` names. */
function ConceptLinks({ event }: { event: NostrEvent }) {
  const own = coordinateOf(event);
  const links = bLinksOf(event);
  const deferred = event.tags.some((t) => t[0] === "b" && t[1] === B_DEFERRED);
  if (!links.length) {
    return (
      <p className="text-[13px] text-mute">
        {deferred ? "Withdrawn: this header opted out of any concept." : "This header is not part of a concept."}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {links.map((b) => (
        <li key={`${b.target}:${b.type}`} className="flex flex-wrap items-baseline gap-x-2">
          {b.target === own ? (
            <span className="text-ink-soft">Itself (canonical)</span>
          ) : (
            <Link href={listHref(b.target)} className={link}>
              {b.target}
            </Link>
          )}
          <span className="text-[11px] text-mute">{b.type}</span>
        </li>
      ))}
    </ul>
  );
}

/** The URL templates a header pins, by name. */
function PinnedTemplates({ event }: { event: NostrEvent }) {
  const refs = useMemo(
    () =>
      parseLinkRefs(
        event,
        parseFieldDecls(event).map((f) => f.name),
      ),
    [event],
  );
  const key = refs.map((r) => r.templateId).join(",");
  const [found, setFound] = useState<{ key: string; templates: Map<string, UrlTemplate> } | null>(null);

  useEffect(() => {
    if (!refs.length) return;
    let cancelled = false;
    fetchTemplates(refs)
      .catch(() => new Map<string, UrlTemplate>())
      .then((templates) => {
        if (!cancelled) setFound({ key, templates });
      });
    return () => {
      cancelled = true;
    };
  }, [key, refs]);

  if (!refs.length) return null;
  const templates = found && found.key === key ? found.templates : null;
  return (
    <Section title="URL templates">
      <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
        {refs.map((ref) => {
          const tpl = templates?.get(ref.templateId);
          return (
            <li key={ref.templateId} className="flex flex-wrap items-baseline gap-x-2">
              {tpl ? (
                <>
                  <span>{tpl.name}</span>
                  <span className="text-[11px] text-mute">{templateSite(tpl.template)}</span>
                </>
              ) : templates ? (
                <span className="text-mute">Template {ref.templateId.slice(0, 8)}&hellip; was not found</span>
              ) : (
                <span className="text-mute">Loading&hellip;</span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Pretty({
  event,
  definition,
  header,
  eventHref,
}: {
  event: NostrEvent;
  definition: ConceptDefinition | null;
  header: boolean;
  eventHref: (value: string) => string;
}) {
  const json = useMemo(() => jsonOf(event), [event]);
  const identity = useMemo((): EventIdentity | null => {
    try {
      return eventIdentity(event);
    } catch {
      // An id or key that isn't hex can't be encoded; the event is still shown.
      return null;
    }
  }, [event]);
  const isHeader = header || isDListHeader(event);
  const content = event.content;
  // The content is shown as what it is unless it was the JSON just printed.
  const showContent = typeof content === "string" && content.trim() !== "" && json?.source !== "content";

  return (
    <div>
      <Section title="Tags">
        <TagTable event={event} definition={definition} eventHref={eventHref} />
      </Section>

      {isHeader ? (
        <>
          <Section title="Concept">
            <ConceptLinks event={event} />
          </Section>
          <PinnedTemplates event={event} />
        </>
      ) : null}

      {json ? (
        <Section title={json.source === "json" ? "JSON (the json tag)" : "JSON (content)"}>
          <Block text={json.text} label="JSON" />
        </Section>
      ) : null}
      {showContent ? (
        <Section title="Content">
          <Block text={content} label="Content" />
        </Section>
      ) : null}

      {identity ? (
        <Section title="Identity">
          <IdentityRows identity={identity} />
        </Section>
      ) : null}

      <Section title="Provenance">
        <Provenance event={event} />
      </Section>
    </div>
  );
}

// -- Item --------------------------------------------------------------------------

function Value({ value, href }: { value: string; href: string | null }) {
  if (!href) return <span className="break-words [overflow-wrap:anywhere]">{value}</span>;
  return /^https?:/i.test(href) ? (
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

function ItemTab({ event, definition }: { event: NostrEvent; definition: ConceptDefinition | null }) {
  const view = useMemo(() => itemView(event, definition), [event, definition]);

  return (
    <div>
      {view.notice ? (
        <p
          role="note"
          className="border border-rule bg-surface p-3 text-[13px] leading-[1.55] text-ink-soft"
          style={{ borderRadius: "var(--radius-input)" }}
        >
          {view.notice}
        </p>
      ) : null}

      {view.facts.length ? (
        <Section title="Facts">
          <dl className="flex flex-col gap-2">
            {view.facts.map((fact) => (
              <div key={fact.field}>
                <dt className="text-[11px] text-mute">{fact.label}</dt>
                <dd className="text-[13px] text-ink-soft">
                  <Value value={fact.value} href={fact.href} />
                  {fact.extra ? <span className="ml-2 text-[11px] text-mute">+{fact.extra} more</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {definition && !view.notice ? (
        <Section title="Fields">
          {view.fields.length ? (
            <dl className="flex flex-col gap-3">
              {view.fields.map(({ decl, cell }) => (
                <div key={decl.name}>
                  <dt className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-mute">
                    <span className="font-mono text-[12px] text-ink">{decl.name}</span>
                    <span>{decl.requirement}</span>
                    {cell.missing ? <span className="text-accent">missing required field</span> : null}
                  </dt>
                  {decl.description ? (
                    <dd className="text-[11px] leading-[1.45] text-mute">{decl.description}</dd>
                  ) : null}
                  <dd className="mt-0.5 text-[13px] text-ink-soft">
                    {cell.value !== null ? (
                      <>
                        <Value value={cell.value} href={cell.href} />
                        {cell.extra ? <span className="ml-2 text-[11px] text-mute">+{cell.extra} more</span> : null}
                      </>
                    ) : (
                      <span className="text-mute">&mdash;</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] leading-[1.55] text-mute">
              This list declares no fields. What the item says is in its tags and JSON: see Pretty.
            </p>
          )}
        </Section>
      ) : null}

      {view.more.length ? (
        <Section title="More fields">
          <p className="mb-2 text-[11px] leading-[1.45] text-mute">
            Tags this list&apos;s header does not declare. They are outside its definition.
          </p>
          <dl className="flex flex-col gap-2">
            {view.more.map((m, i) => (
              <div key={`${m.name}:${i}`}>
                <dt className="font-mono text-[12px] text-ink">{m.name}</dt>
                <dd className="break-words text-[13px] text-ink-soft [overflow-wrap:anywhere]">{m.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
    </div>
  );
}

// -- Raw ---------------------------------------------------------------------------

const COPY_WORDS: Record<VersionLabel, string> = {
  community: "Community header",
  yours: "Yours",
  assistant: "Your Assistant’s",
  house: "Brainstorm’s",
  copy: "Copy",
};

function Raw({ event, copies }: { event: NostrEvent; copies: PanelCopy[] }) {
  // The header shown is one of the copies, or, when it isn't (a header on its own), the first choice.
  const options = useMemo(
    (): { label: VersionLabel | null; author: string; event: NostrEvent }[] =>
      copies.some((c) => c.event.id === event.id) ? copies : [{ label: null, author: event.pubkey, event }, ...copies],
    [copies, event],
  );
  const [picked, setPicked] = useState(event.id);
  const shown = options.find((o) => o.event.id === picked)?.event ?? event;
  const text = useMemo(() => JSON.stringify(shown, null, 2), [shown]);
  const selectId = useId();

  return (
    <div>
      {options.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label htmlFor={selectId} className="text-[12px] text-mute">
            Copy of the concept
          </label>
          <select
            id={selectId}
            value={shown.id}
            onChange={(e) => setPicked(e.target.value)}
            className="max-w-full border border-rule bg-surface px-2 py-1 text-[12px] text-ink-soft"
            style={{ borderRadius: "var(--radius-input)" }}
          >
            {options.map((o) => (
              <option key={o.event.id} value={o.event.id}>
                {o.label ? COPY_WORDS[o.label] : "This header"} &middot; {shortNpub(o.author)}
              </option>
            ))}
          </select>
          <UserIdentity pubkey={shown.pubkey} avatarSize={16} textClass="text-[12px]" />
        </div>
      ) : null}
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-mute">The event exactly as it was signed.</p>
        <CopyButton text={text} label="event" />
      </div>
      <Block text={text} label="Raw event" />
    </div>
  );
}

// -- the panel ---------------------------------------------------------------------

type Role = "header" | "item" | "foreign";

/** What the panel calls the event. */
function titleOf(event: NostrEvent, role: Role, definition: ConceptDefinition | null): string {
  if (role === "item") {
    const title = definition ? presentCurateItem(event, definition).title : null;
    return title ?? `Untitled ${singularOf(definition)}`;
  }
  return role === "header" || isDListHeader(event) ? namesOf(event).plural || UNTITLED_LIST : "Event";
}

/**
 * The event panel: any list header or item, opened from a click
 * and shareable by its URL. A side sheet from 768 px up, the whole screen
 * below. Tabs: Item (a list's items only: its fields as the header declares
 * them), Pretty (every tag, labelled, with its identity and where it came
 * from) and Raw (the event exactly as signed). Nothing here shows anyone's
 * rank.
 */
export function EventPanel({
  event,
  notice = null,
  header,
  foreign = false,
  definition,
  tab,
  copies = [],
  eventHref,
  onClose,
  returnFocus,
}: EventPanelProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialog(dialog, onClose, returnFocus, event?.id ?? null);
  const titleId = useId();
  const panelId = useId();

  const hasItemTab = !!event && !header && !foreign;
  const tabs: PanelTab[] = hasItemTab ? ["item", "pretty", "raw"] : ["pretty", "raw"];
  // A tab the reader chose belongs to the event they chose it on; another event opens on the first.
  const [chosen, setChosen] = useState<{ id: string; tab: PanelTab } | null>(null);
  const picked = chosen && chosen.id === event?.id && tabs.includes(chosen.tab) ? chosen.tab : null;
  const current = picked ?? (tab && tabs.includes(tab) ? tab : tabs[0]);
  const tabRefs = useRef(new Map<PanelTab, HTMLButtonElement>());

  const role: Role = header ? "header" : foreign ? "foreign" : "item";
  const title = event ? titleOf(event, role, definition) : "Event";
  const kindWord = !event
    ? ""
    : role === "item"
      ? "Item"
      : role === "header" || isDListHeader(event)
        ? "List header"
        : "Event";
  // The list's definition describes its own items; a header or a stranger's event isn't read by it.
  const classifiedBy = hasItemTab ? definition : null;

  const choose = (t: PanelTab) => {
    if (event) setChosen({ id: event.id, tab: t });
  };
  const moveTab = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.indexOf(current);
    const next =
      e.key === "ArrowRight"
        ? tabs[(at + 1) % tabs.length]
        : e.key === "ArrowLeft"
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : e.key === "Home"
            ? tabs[0]
            : e.key === "End"
              ? tabs[tabs.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    choose(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div aria-hidden className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface-raised text-ink shadow-2xl outline-none md:w-[640px] md:max-w-[92vw] md:border-l md:border-rule-strong"
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words font-serif text-[22px] font-light leading-[1.2] text-ink">
              {title}
            </h2>
            {event ? (
              <p className="mt-1 text-[12px] text-mute">
                {kindWord} &middot; kind {event.kind}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-rule px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
            style={{ borderRadius: "var(--radius-input)" }}
          >
            Close
          </button>
        </div>

        {event ? (
          <>
            <div role="tablist" aria-label="Views of this event" className="flex gap-1 border-b border-rule px-4 pt-2">
              {tabs.map((t) => (
                <button
                  key={t}
                  ref={(el) => {
                    if (el) tabRefs.current.set(t, el);
                    else tabRefs.current.delete(t);
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${t}`}
                  aria-selected={current === t}
                  aria-controls={`${panelId}-panel`}
                  tabIndex={current === t ? 0 : -1}
                  onClick={() => choose(t)}
                  onKeyDown={moveTab}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
                    current === t ? "border-accent text-ink" : "border-transparent text-mute hover:text-ink-soft",
                  )}
                >
                  {TAB_NAMES[t]}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${panelId}-panel`}
              aria-labelledby={`${panelId}-tab-${current}`}
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5 outline-none"
            >
              {/* The event is the key: a link to another event starts that event's views afresh. */}
              <div key={event.id}>
                {current === "item" ? <ItemTab event={event} definition={definition} /> : null}
                {current === "pretty" ? (
                  <Pretty event={event} definition={classifiedBy} header={header} eventHref={eventHref} />
                ) : null}
                {current === "raw" ? <Raw event={event} copies={header ? copies : []} /> : null}
              </div>
            </div>
          </>
        ) : (
          <p className="px-5 py-6 text-[13px] leading-[1.55] text-ink-soft" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
