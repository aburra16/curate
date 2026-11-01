"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckProblems, hasBlocking, problemsFor } from "@/components/check-problems";
import { FieldsPanel } from "@/components/fields-panel";
import { PublishOutcome } from "@/components/publish-outcome";
import { useReader } from "@/hooks/use-reader";
import { useSettled } from "@/hooks/use-settled";
import { missedHub, useWrite } from "@/hooks/use-write";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import {
  QUICK_FIELD_TYPES,
  createProblems,
  freeShortName,
  newListTemplate,
  ownShortNames,
  sameConcept,
  shortNameProblems,
  type QuickField,
  type QuickFieldType,
} from "@/lib/curate/newList";
import { checkHeader, type Problem } from "@/lib/listCheck";
import { listCoordinate, previewDefinition, slugOf } from "@/lib/listDraft";
import { cn } from "@/lib/utils";
import { listHref } from "@/app/list/list-model";
import { loadAllHeaders, loadOwnHeaders, type OwnHeaders } from "@/services/dictionary";
import { useConnectDialog } from "@/stores/connect-dialog";

/** A field row on the form: the field, and an id that stays with it as rows come and go. */
type Row = QuickField & { id: number };

const FIRST_FIELD: QuickField = { name: "name", type: "text", requirement: "required", description: "" };

const REQUIREMENTS: { value: QuickField["requirement"]; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "recommended", label: "Recommended" },
  { value: "optional", label: "Optional" },
];

/** Stands in for the author while nobody is signed in: the preview and the checks need an address to point at. */
const NO_ONE = "0".repeat(64);

/** A message from the checks as a problem that stops the list, about the short name (`d`) or about no one field. */
const blockingProblem = (message: string, field: string | null): Problem => ({
  code: "unpublishable",
  field,
  message,
  blocking: true,
});

/**
 * Make a list: its names, a description, the fields each item holds and a
 * short name. Brainstorm's checks run as the person types, and Publish waits
 * until none would stop the list, and until the person's own lists have been
 * read, so a short name they already use is never published over: when no
 * list relay answered that read, Publish holds and offers to read again. When
 * a shared concept already goes by the same name, publishing offers a choice
 * first: make a version of that one, or offer a new one anyway. A list the
 * list relay took opens at once, and a toast names any of the person's own
 * relays that missed it. Signed out, the form can be filled in and the button
 * invites the person to connect.
 */
export default function CreateListPage() {
  const router = useRouter();
  const { pubkey } = useReader();
  const { state, busy, write, retry, reset } = useWrite();
  const fieldsId = useId();
  const previewId = useId();
  const choiceId = useId();

  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [description, setDescription] = useState("");
  const nextRowId = useRef(1);
  const [rows, setRows] = useState<Row[]>([{ id: 0, ...FIRST_FIELD }]);
  /** The short name as the person typed it; null while it follows the plural. */
  const [typedShortName, setTypedShortName] = useState<string | null>(null);
  /** Every list header on the list relay, for a shared concept of the same name; null until it has been read. */
  const [headers, setHeaders] = useState<HeaderEvent[] | null>(null);
  /** The reader's own list headers, for the short names they have taken, and whose they are; null until read. */
  const [own, setOwn] = useState<(OwnHeaders & { pubkey: string }) | null>(null);
  /** How many times the reader asked for their lists to be read again. */
  const [ownReads, setOwnReads] = useState(0);
  /** Problems stay quiet until the person has started. */
  const [touched, setTouched] = useState(false);
  /** The choice between a version and a new concept is on show; changing a name takes it away. */
  const [offered, setOffered] = useState(false);
  /** The names the person chose to offer anyway, so a second Publish doesn't ask again. */
  const [offeredAnywayFor, setOfferedAnywayFor] = useState<string | null>(null);
  /** The address of the list last sent, for opening it once the list relay has it. */
  const sent = useRef<string | null>(null);
  const settled = useSettled(() => {
    if (sent.current) router.push(listHref(sent.current));
  });

  useEffect(() => {
    let cancelled = false;
    loadAllHeaders().then(
      (found) => {
        if (!cancelled) setHeaders(found);
      },
      () => {
        if (!cancelled) setHeaders([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    loadOwnHeaders(pubkey).then((found) => {
      if (!cancelled) setOwn({ ...found, pubkey });
    });
    return () => {
      cancelled = true;
    };
  }, [pubkey, ownReads]);

  /** The reader's lists as read for them; null while they are being read. */
  const ownRead = own && own.pubkey === pubkey ? own : null;
  /** No list relay answered the read of the reader's lists: a short name can't be known to be free. */
  const unchecked = ownRead !== null && !ownRead.answered;
  const readAgain = () => {
    setOwn(null);
    setOwnReads((n) => n + 1);
  };

  const taken = useMemo(() => ownShortNames(ownRead?.headers ?? [], pubkey), [ownRead, pubkey]);
  const d = (typedShortName ?? freeShortName(slugOf(plural), taken)).trim();
  const list = { singular, plural, description, fields: rows };
  const template = newListTemplate(list, d, pubkey ?? NO_ONE);

  const shortNameWords = new Set(shortNameProblems(d, taken));
  const mine = createProblems(list, d, taken);
  const problems: Problem[] = [
    ...mine.map((message) => blockingProblem(message, shortNameWords.has(message) ? "d" : null)),
    ...checkHeader(template.tags).problems.filter((problem) => !mine.includes(problem.message)),
  ];

  const sharedConcept = useMemo(
    () => sameConcept(headers ?? [], { singular, plural })[0] ?? null,
    [headers, singular, plural],
  );
  const namesKey = JSON.stringify([singular, plural]);
  const mustChoose = sharedConcept !== null && offeredAnywayFor !== namesKey;
  const choosing = mustChoose && offered;

  /** The list relay has the list, and the page is on its way to it. */
  const saved = state.phase === "done" && state.result.onHub;
  const canPublish =
    pubkey !== null && headers !== null && ownRead?.answered === true && !hasBlocking(problems) && !busy && !saved;

  /** The person changed the list: a refused event no longer says what it is, and the next Publish signs it afresh. */
  const changed = () => {
    setTouched(true);
    if (missedHub(state)) reset();
  };

  const rename = (set: (name: string) => void, name: string) => {
    set(name);
    setOffered(false);
  };

  const addRow = () => {
    changed();
    setRows((prev) => [
      ...prev,
      { id: nextRowId.current++, name: "", type: "text", requirement: "optional", description: "" },
    ]);
  };
  const changeRow = (id: number, patch: Partial<QuickField>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeRow = (id: number) => {
    changed();
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  /** Sign and send the list. */
  const publish = async () => {
    if (!pubkey || !canPublish) return;
    sent.current = listCoordinate(pubkey, d);
    settled(await write(template));
  };

  const retryWrite = async () => {
    settled(await retry());
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPublish) return;
    if (mustChoose) setOffered(true);
    else void publish();
  };

  const offerAnyway = () => {
    setOfferedAnywayFor(namesKey);
    void publish();
  };

  const sharedPlural = sharedConcept?.rootHeader ? definitionOf(sharedConcept.rootHeader).plural : "";
  const typedNames = { singular: singular.trim(), plural: plural.trim(), description: description.trim() };
  const fieldProblems = touched ? problemsFor(problems, null) : [];
  const shortNameShown = touched ? problemsFor(problems, "d") : [];

  return (
    <div className="mx-auto max-w-[700px] px-8 py-12">
      <Link href="/" className="text-[13px] text-mute hover:text-ink-soft transition-colors">
        &larr; Back to Discover
      </Link>

      <h1 className="mt-8 font-serif text-[32px] leading-[1.1] tracking-[-0.015em] text-ink font-light">
        Create a new <span className="italic text-accent font-normal">list</span>
      </h1>
      <p className="mt-3 font-serif text-[16px] leading-[1.5] text-ink-soft italic">
        Name what you are collecting and say what each item holds. You add the items once the list is published.
      </p>

      <form onSubmit={onSubmit} onChange={changed} className="mt-8 flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <Labelled label="Singular name" hint="What one item is called, as in “Café”.">
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                type="text"
                value={singular}
                onChange={(e) => rename(setSingular, e.target.value)}
                className={inputClass}
                style={inputStyle}
                autoFocus
              />
            )}
          </Labelled>
          <Labelled label="Plural name" hint="What the whole list is called, as in “Cafés”.">
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                type="text"
                value={plural}
                onChange={(e) => rename(setPlural, e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            )}
          </Labelled>
          <Labelled label="Description" hint="Optional. What belongs on the list.">
            {(id, hint) => (
              <textarea
                id={id}
                aria-describedby={hint}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={cn(inputClass, "resize-none")}
                style={inputStyle}
              />
            )}
          </Labelled>
        </div>

        <section aria-labelledby={fieldsId} className="flex flex-col gap-3">
          <h2 id={fieldsId} className="font-serif text-[20px] text-ink">
            Fields
          </h2>
          <p className="text-[13px] text-ink-soft">What each item on the list holds.</p>
          <ul className="flex flex-col gap-3">
            {rows.map((row, i) => {
              const n = i + 1;
              return (
                <li
                  key={row.id}
                  className="border border-rule bg-surface p-3 flex flex-col gap-2"
                  style={{ borderRadius: "var(--radius-card)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      aria-label={`Field ${n} name`}
                      value={row.name}
                      onChange={(e) => changeRow(row.id, { name: e.target.value })}
                      placeholder="Field name"
                      className={cn(inputClass, "min-w-[10rem] flex-1 text-[13px]")}
                      style={inputStyle}
                    />
                    <select
                      aria-label={`Field ${n} type`}
                      value={row.type}
                      onChange={(e) => changeRow(row.id, { type: e.target.value as QuickFieldType })}
                      className={selectClass}
                      style={inputStyle}
                    >
                      {QUICK_FIELD_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Field ${n} requirement`}
                      value={row.requirement}
                      onChange={(e) => changeRow(row.id, { requirement: e.target.value as QuickField["requirement"] })}
                      className={selectClass}
                      style={inputStyle}
                    >
                      {REQUIREMENTS.map((requirement) => (
                        <option key={requirement.value} value={requirement.value}>
                          {requirement.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove field ${n}`}
                      onClick={() => removeRow(row.id)}
                      className="px-1 text-[18px] leading-none text-mute hover:text-accent transition-colors"
                    >
                      &times;
                    </button>
                  </div>
                  <input
                    type="text"
                    aria-label={`Field ${n} description`}
                    value={row.description}
                    onChange={(e) => changeRow(row.id, { description: e.target.value })}
                    placeholder="Short description (optional)"
                    className={cn(inputClass, "text-[12px]")}
                    style={inputStyle}
                  />
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={addRow}
            className="self-start py-1 text-[13px] text-accent hover:text-ink transition-colors"
          >
            Add a field
          </button>
          <CheckProblems problems={fieldProblems} />
        </section>

        <div>
          <Labelled
            label="Short name"
            hint="Part of the list’s address. It cannot be changed once the list is published."
          >
            {(id, hint) => (
              <input
                id={id}
                aria-describedby={hint}
                type="text"
                value={typedShortName ?? d}
                onChange={(e) => setTypedShortName(e.target.value)}
                className={cn(inputClass, "font-mono text-[13px]")}
                style={inputStyle}
                spellCheck={false}
                autoCapitalize="none"
              />
            )}
          </Labelled>
          <CheckProblems problems={shortNameShown} />
        </div>

        <section
          aria-labelledby={previewId}
          className="border border-rule bg-surface p-5"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          <h2 id={previewId} className="text-[11px] uppercase tracking-[0.1em] text-mute">
            Preview
          </h2>
          <p className="mt-3 font-serif text-[28px] leading-[1.1] tracking-[-0.015em] text-ink font-light break-words">
            {typedNames.plural || <span className="text-mute/50">Your list</span>}
          </p>
          {typedNames.description ? (
            <p className="mt-3 font-serif text-[16px] leading-[1.5] text-ink-soft italic">{typedNames.description}</p>
          ) : null}
          {typedNames.singular ? (
            <p className="mt-3 text-[12px] text-mute">
              Each item is one <span className="text-ink-soft">{typedNames.singular}</span>
            </p>
          ) : null}
          <div className="mt-4">
            <FieldsPanel fields={previewDefinition(template, pubkey).governing.fields} />
          </div>
        </section>

        {choosing && sharedConcept ? (
          <div
            role="group"
            aria-labelledby={choiceId}
            className="border border-accent/30 bg-accent-glow p-4"
            style={{ borderRadius: "var(--radius-card)" }}
          >
            <p id={choiceId} className="text-[14px] text-ink">
              A shared concept called “{sharedPlural}” already exists.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => router.push(`${listHref(sharedConcept.root)}&edit=mine`)}
                className="text-[13px] font-medium px-4 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={inputStyle}
              >
                Make my own version of {sharedPlural}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={offerAnyway}
                className="text-[13px] px-4 py-2 bg-surface-raised border border-rule text-ink-soft hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={inputStyle}
              >
                Offer a new shared concept anyway
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <PublishOutcome state={state} busy={busy} onRetry={() => void retryWrite()} />
          <div className="flex items-center justify-end gap-3">
            {pubkey && (headers === null || ownRead === null) ? (
              <p className="mr-auto text-[12px] text-mute">Looking for lists that already exist…</p>
            ) : null}
            {unchecked ? (
              <div className="mr-auto flex items-center gap-3">
                <p className="text-[12px] text-ink-soft">Couldn&apos;t check your lists. Try again.</p>
                <button
                  type="button"
                  onClick={readAgain}
                  className="shrink-0 px-3 py-1 text-[12px] bg-surface-raised border border-rule text-ink-soft hover:text-ink transition-colors"
                  style={inputStyle}
                >
                  Try again
                </button>
              </div>
            ) : null}
            {pubkey ? (
              <button
                type="submit"
                disabled={!canPublish}
                className="text-[13px] font-medium px-6 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={inputStyle}
              >
                {busy ? "Publishing…" : "Publish"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => useConnectDialog.getState().show()}
                className="text-[13px] font-medium px-6 py-2 bg-accent text-ink hover:brightness-110 transition-all"
                style={inputStyle}
              >
                Connect to publish
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

/** A labelled control with a hint beneath it. `children` is given the ids the input and its hint need. */
function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: (id: string, hintId: string) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] text-ink-soft">
        {label}
      </label>
      {children(id, hintId)}
      <p id={hintId} className="text-[11px] text-mute/80">
        {hint}
      </p>
    </div>
  );
}

const inputClass =
  "w-full bg-surface text-ink placeholder:text-mute/50 border border-rule px-3 py-2 text-[14px] outline-none focus:border-rule-strong focus:bg-surface-hover transition-all duration-200";

const selectClass = "bg-surface-raised border border-rule text-ink text-[13px] px-2 py-2 outline-none";

const inputStyle = { borderRadius: "var(--radius-input)" as const };
