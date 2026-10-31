"use client";

import type { NostrEvent } from "nostr-tools";
import { useEffect, useId, useMemo, useState } from "react";
import { ListForm } from "@/components/list-form";
import { PublishOutcome } from "@/components/publish-outcome";
import { useWrite } from "@/hooks/use-write";
import { withdrawnTemplate, type CopyDraft } from "@/lib/conceptCopy";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import {
  listActionsFor,
  listEditDraft,
  listEditHeader,
  listEditProblems,
  listEditTemplate,
  shortNameOf,
  versionShortName,
  type ListEdit,
} from "@/lib/curate/listActions";
import type { ConceptGroup } from "@/services/concepts";
import { loadOwnHeaders } from "@/services/dictionary";
import type { PublishResult } from "@/services/publish";

/** What each change is called, on its button and over its form. */
const EDIT_WORDS: Record<ListEdit["kind"], string> = {
  edit: "Edit list",
  "edit-mine": "Edit my version",
  "make-mine": "Make my own version",
};

const NOTHING = { edit: null, withdraw: null };

const buttonClass = "text-[12px] text-mute hover:text-accent transition-colors";
const panelClass = "mt-6 border border-accent/20 bg-surface p-5";
const panelStyle = { borderRadius: "var(--radius-card)" as const };
const inputStyle = { borderRadius: "var(--radius-input)" as const };

/**
 * What happens once a write has been answered. A write the list relay took
 * is handed on at once, unless one of the author's own relays missed it: then
 * it waits, so the person reads which one, and is handed on when they are done.
 */
function useSettled(onSaved: (event: NostrEvent) => void): {
  waiting: NostrEvent | null;
  settled: (result: PublishResult | null) => void;
} {
  const [waiting, setWaiting] = useState<NostrEvent | null>(null);
  const settled = (result: PublishResult | null) => {
    if (!result?.onHub) return;
    if (result.failed.length === 0) onSaved(result.event);
    else setWaiting(result.event);
  };
  return { waiting, settled };
}

/**
 * The form for one change to a list. It opens on the header being changed or
 * copied as it stands, runs Brainstorm's checks on the header the draft would
 * publish as the person types, and publishes it as `reader`.
 *
 * A version made is published at the community header's short name, unless
 * the reader has a list of their own by that name: then at a free one, and the
 * form says so. Publish waits until the reader's lists have been read.
 */
function ListEditor({
  edit,
  reader,
  onSaved,
  onCancel,
}: {
  edit: ListEdit;
  reader: string;
  onSaved: (event: NostrEvent) => void;
  onCancel: () => void;
}) {
  const { state, busy, write, retry } = useWrite();
  const [opened] = useState(() => listEditDraft(edit));
  const [draft, setDraft] = useState(opened);
  const { waiting, settled } = useSettled(onSaved);

  /** The reader's own list headers, read to choose a version's short name; null until then. */
  const [own, setOwn] = useState<HeaderEvent[] | null>(null);
  const makes = edit.kind === "make-mine";
  useEffect(() => {
    if (!makes) return;
    let cancelled = false;
    loadOwnHeaders(reader).then((found) => {
      if (!cancelled) setOwn(found);
    });
    return () => {
      cancelled = true;
    };
  }, [makes, reader]);
  const reading = makes && own === null;
  const shortName = edit.kind === "make-mine" && own ? versionShortName(edit.community, reader, own) : undefined;
  const wanted = edit.kind === "make-mine" ? shortNameOf(edit.community) : null;

  const problems = useMemo(() => listEditProblems(edit, reader, draft, shortName), [edit, reader, draft, shortName]);

  return (
    <ListForm
      heading={EDIT_WORDS[edit.kind]}
      draft={opened}
      onChange={setDraft}
      onSave={(saved: CopyDraft) => void write(listEditTemplate(edit, reader, saved, shortName)).then(settled)}
      busy={busy}
      holding={reading}
      problems={problems}
      onCancel={onCancel}
      outcome={
        <>
          {reading ? <p className="text-[12px] text-mute">Looking at your lists to choose a short name…</p> : null}
          {shortName !== undefined && shortName !== wanted ? (
            <p className="text-[12px] leading-[1.5] text-ink-soft">
              You already have a list with the short name “{wanted}”, so your version is saved as “{shortName}”.
            </p>
          ) : null}
          <PublishOutcome state={state} busy={busy} onRetry={() => void retry().then(settled)} />
        </>
      }
      onDone={waiting ? () => onSaved(waiting) : undefined}
    />
  );
}

/**
 * Asks before the reader's version of the concept is withdrawn, then
 * publishes it withdrawn. Until the list relay has taken it the version stays
 * as it was; a refusal says so, and Retry sends the same event again.
 */
function WithdrawConfirm({
  copy,
  plural,
  onWithdrawn,
  onCancel,
}: {
  copy: HeaderEvent;
  plural: string;
  onWithdrawn: (event: NostrEvent) => void;
  onCancel: () => void;
}) {
  const { state, busy, write, retry } = useWrite();
  const { waiting, settled } = useSettled(onWithdrawn);
  const askedId = useId();

  return (
    <div role="group" aria-labelledby={askedId} className="flex flex-col gap-4">
      <p id={askedId} className="text-[14px] text-ink">
        Withdraw your version of {plural}? It will stop counting as a version of this concept.
      </p>
      <PublishOutcome state={state} busy={busy} onRetry={() => void retry().then(settled)} />
      <div className="flex items-center justify-end gap-3">
        {waiting ? (
          <button
            type="button"
            onClick={() => onWithdrawn(waiting)}
            className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all"
            style={inputStyle}
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="text-[12px] text-mute hover:text-ink-soft transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void write(withdrawnTemplate(definitionOf(copy))).then(settled)}
              disabled={busy}
              className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={inputStyle}
            >
              {busy ? "Withdrawing…" : "Withdraw"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface Props {
  /** Who is reading; null when signed out, and nothing is offered. */
  reader: string | null;
  /** The concept the page shows, as it groups the headers read. */
  group: ConceptGroup | null;
  /** The header the page shows. */
  shown: HeaderEvent;
  /** The shown list's plural, for the question that asks before a withdrawal. */
  plural: string;
  /** The address asked for the form (`edit=mine`): it opens once the reader and the headers are known. */
  openAtLoad: boolean;
  /** The list relay has the change: the header written, for the page to read from. */
  onSaved: (edit: ListEdit, header: NostrEvent) => void;
  /** The list relay has the withdrawal. */
  onWithdrawn: (header: NostrEvent) => void;
  /** The form closed without a change. */
  onClosed: () => void;
}

/**
 * What the reader can do to the list shown: the buttons for it, and under
 * them the form or the question a button opened. Nothing is drawn for a
 * reader who is signed out, or who has nothing to do here. What opened for one
 * reader does not stay open for the next.
 */
export function ListChanges({ reader, group, shown, plural, openAtLoad, onSaved, onWithdrawn, onClosed }: Props) {
  const { edit, withdraw } = useMemo(() => (group ? listActionsFor(reader, group, shown) : NOTHING), [reader, group, shown]);
  /** Who chose a button, so a reader who signs out and another who signs in find them closed. */
  const [editedBy, setEditedBy] = useState<string | null>(null);
  const [withdrawnBy, setWithdrawnBy] = useState<string | null>(null);
  /** The form `openAtLoad` opened was closed. */
  const [declined, setDeclined] = useState(false);

  const editing = reader !== null && edit !== null && (editedBy === reader || (openAtLoad && !declined));
  const withdrawing = reader !== null && withdraw !== null && withdrawnBy === reader && !editing;

  const closeEditor = () => {
    setEditedBy(null);
    setDeclined(true);
    onClosed();
  };

  if (editing) {
    return (
      <div className={panelClass} style={panelStyle}>
        <ListEditor
          key={`${reader}:${edit.kind}:${listEditHeader(edit).id}`}
          edit={edit}
          reader={reader}
          onSaved={(event) => {
            setEditedBy(null);
            setDeclined(true);
            onSaved(edit, event);
          }}
          onCancel={closeEditor}
        />
      </div>
    );
  }

  if (withdrawing) {
    return (
      <div className={panelClass} style={panelStyle}>
        <WithdrawConfirm
          copy={withdraw}
          plural={plural}
          onWithdrawn={(event) => {
            setWithdrawnBy(null);
            onWithdrawn(event);
          }}
          onCancel={() => setWithdrawnBy(null)}
        />
      </div>
    );
  }

  if (!reader || (!edit && !withdraw)) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      {edit ? (
        <button type="button" onClick={() => setEditedBy(reader)} className={buttonClass}>
          {EDIT_WORDS[edit.kind]}
        </button>
      ) : null}
      {withdraw ? (
        <button type="button" onClick={() => setWithdrawnBy(reader)} className={buttonClass}>
          Withdraw my version
        </button>
      ) : null}
    </div>
  );
}
