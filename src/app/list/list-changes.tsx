"use client";

import type { NostrEvent } from "nostr-tools";
import { useEffect, useMemo, useState } from "react";
import { ConfirmWrite } from "@/components/confirm-write";
import { ListForm } from "@/components/list-form";
import { PublishOutcome } from "@/components/publish-outcome";
import { useSettled } from "@/hooks/use-settled";
import { missedHub, useWrite } from "@/hooks/use-write";
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
import { loadOwnHeaders, type OwnHeaders } from "@/services/dictionary";

/** What each change is called, on its button and over its form. */
const EDIT_WORDS: Record<ListEdit["kind"], string> = {
  edit: "Edit list",
  "edit-mine": "Edit my version",
  "make-mine": "Make my own version",
};

const NOTHING = { edit: null, withdraw: null };

const buttonClass = "text-[12px] text-mute hover:text-accent transition-colors";
const smallButtonClass =
  "shrink-0 px-3 py-1 text-[12px] bg-surface-raised border border-rule text-ink-soft hover:text-ink transition-colors";
const smallButtonStyle = { borderRadius: "var(--radius-input)" as const };
const panelClass = "mt-6 border border-accent/20 bg-surface p-5";
const panelStyle = { borderRadius: "var(--radius-card)" as const };

/**
 * The form for one change to a list. It opens on the header being changed or
 * copied as it stands, runs Brainstorm's checks on the header the draft would
 * publish as the person types, and publishes it as `reader`.
 *
 * A version made is published at the community header's short name, unless
 * the reader has a list of their own by that name: then at a free one, and the
 * form says so. Publish waits until the reader's lists have been read, and
 * holds, offering to read them again, when no list relay answered. After a
 * refusal, Retry sends the same header again until the person changes the
 * form: then the next Publish signs it as it stands.
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
  const { state, busy, write, retry, reset } = useWrite();
  const [opened] = useState(() => listEditDraft(edit));
  const [draft, setDraft] = useState(opened);
  const settled = useSettled(onSaved);

  /** The reader's own list headers, read to choose a version's short name; null until then. */
  const [own, setOwn] = useState<OwnHeaders | null>(null);
  /** How many times the reader asked for their lists to be read again. */
  const [ownReads, setOwnReads] = useState(0);
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
  }, [makes, reader, ownReads]);
  const reading = makes && own === null;
  /** No list relay answered the read of the reader's lists: a short name can't be known to be free. */
  const unchecked = makes && own !== null && !own.answered;
  const readAgain = () => {
    setOwn(null);
    setOwnReads((n) => n + 1);
  };
  const shortName =
    edit.kind === "make-mine" && own?.answered ? versionShortName(edit.community, reader, own.headers) : undefined;
  const wanted = edit.kind === "make-mine" ? shortNameOf(edit.community) : null;

  const problems = useMemo(() => listEditProblems(edit, reader, draft, shortName), [edit, reader, draft, shortName]);

  return (
    <ListForm
      heading={EDIT_WORDS[edit.kind]}
      draft={opened}
      onChange={(next) => {
        setDraft(next);
        // A refused event no longer says what the form does: the next Publish signs it afresh.
        if (missedHub(state)) reset();
      }}
      onSave={(saved: CopyDraft) => void write(listEditTemplate(edit, reader, saved, shortName)).then(settled)}
      busy={busy}
      holding={reading || unchecked}
      problems={problems}
      onCancel={onCancel}
      outcome={
        <>
          {reading ? <p className="text-[12px] text-mute">Looking at your lists to choose a short name…</p> : null}
          {unchecked ? (
            <div className="flex items-center gap-3">
              <p className="text-[12px] text-ink-soft">Couldn&apos;t check your lists. Try again.</p>
              <button type="button" onClick={readAgain} className={smallButtonClass} style={smallButtonStyle}>
                Try again
              </button>
            </div>
          ) : null}
          {shortName !== undefined && shortName !== wanted ? (
            <p className="text-[12px] leading-[1.5] text-ink-soft">
              You already have a list with the short name “{wanted}”, so your version is saved as “{shortName}”.
            </p>
          ) : null}
          <PublishOutcome state={state} busy={busy} onRetry={() => void retry().then(settled)} />
        </>
      }
    />
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
        <ConfirmWrite
          question={`Withdraw your version of ${plural}? It will stop counting as a version of this concept.`}
          confirmLabel="Withdraw"
          busyLabel="Withdrawing…"
          template={() => withdrawnTemplate(definitionOf(withdraw))}
          onDone={(event) => {
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
