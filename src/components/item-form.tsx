"use client";

import type { NostrEvent } from "nostr-tools";
import { useId, useMemo, useState } from "react";
import { CheckProblems, hasBlocking, problemsFor } from "@/components/check-problems";
import { PublishOutcome } from "@/components/publish-outcome";
import { useReader } from "@/hooks/use-reader";
import { useSettled } from "@/hooks/use-settled";
import { missedHub, useWrite } from "@/hooks/use-write";
import type { ConceptDefinition } from "@/lib/conceptResolution";
import { editedItemTemplate } from "@/lib/curate/writeTemplates";
import { fieldCell, type FieldDecl } from "@/lib/dlistFields";
import type { UrlTemplate } from "@/lib/linkTemplates";
import { checkItemUnder, type Problem } from "@/lib/listCheck";
import { itemProblems, itemTemplate, randomTail, type ItemValues } from "@/lib/listItem";
import type { ItemEvent } from "@/services/concepts";
import { namesOf } from "@/services/jsonData";
import { useConnectDialog } from "@/stores/connect-dialog";

interface Props {
  /** The list's governing definition: it names the fields, and the checks read the item through it. */
  definition: ConceptDefinition;
  /** The URL templates the definition's links pin, by id (`useTemplates`). */
  templates: Map<string, UrlTemplate>;
  /** The reader's own item to change. Without it, the form adds a new one. */
  item?: ItemEvent;
  /** The list relay has the item; handed the signed event. */
  onSaved: (event: NostrEvent) => void;
  onCancel: () => void;
}

/** The input type for a field type that has its own; any other is plain text. */
const INPUT_TYPES = new Map([
  ["url", "url"],
  ["tel", "tel"],
  ["email", "email"],
]);

const REQUIREMENT_WORDS = { required: "Required", recommended: "Recommended", optional: "Optional" } as const;

/**
 * Add an item to a list, or change one of the reader's own. One input per
 * field the list declares, required first, and Brainstorm's checks run as the
 * values change: Publish waits until none would stop the item. Signed out,
 * the button invites the person to connect.
 *
 * An added item gets a `d` of its title and a random tail, chosen when the
 * form opens, so a second Publish after a refusal is the same item and not a
 * second one. A changed item keeps every tag it has; only the fields the
 * person changed are different, measured against what each field held when
 * the form opened, so a newer version of the item that arrives meanwhile keeps
 * its own changes.
 *
 * A save the list relay took closes the form at once (`onSaved`), and a
 * toast names any of the author's own relays that missed it. After a refusal,
 * Retry sends the same event again, until the person changes a field: then
 * the next Publish signs the form as it stands.
 */
export function ItemForm({ definition, templates, item, onSaved, onCancel }: Props) {
  const { pubkey } = useReader();
  const { state, busy, write, retry, reset } = useWrite();
  const settled = useSettled(onSaved);
  const headingId = useId();
  const singular = namesOf(definition.event).singular || "item";

  /** What each field held when the form opened; empty for a new item. */
  const [prefill] = useState((): ItemValues =>
    Object.fromEntries(definition.fields.map((f) => [f.name, item ? (fieldCell(item, f).value ?? "") : ""])),
  );
  const [values, setValues] = useState<ItemValues>(prefill);
  /** Problems stay quiet on a new item until the person has started. */
  const [touched, setTouched] = useState(item !== undefined);
  const [tail] = useState(randomTail);

  /**
   * The fields whose value the person changed, in the definition's order. A
   * field the form didn't have when it opened (the list began to declare it
   * since) counts as empty then.
   */
  const changes = useMemo(
    () =>
      Object.fromEntries(
        definition.fields.flatMap((f) => {
          const typed = values[f.name] ?? "";
          const was = prefill[f.name] ?? "";
          return typed === was || typed.trim() === was ? [] : [[f.name, typed.trim()]];
        }),
      ),
    [definition.fields, values, prefill],
  );
  const template = useMemo(
    () => (item ? editedItemTemplate(item, changes) : itemTemplate(definition, values, tail)),
    [item, changes, definition, values, tail],
  );
  const problems = useMemo(
    () => checkItemUnder(definition, template.tags, templates).problems,
    [definition, template, templates],
  );
  // Problems about no input of the form: the whole item, or a tag the list doesn't declare.
  const declared = new Set(definition.fields.map((f) => f.name));
  const aboutTheItem = problems.filter((problem) => problem.field === null || !declared.has(problem.field));

  const stopped = itemProblems(definition, values).length > 0 || hasBlocking(problems);
  const canPublish = pubkey !== null && !stopped && !busy;

  const publish = async () => {
    if (!canPublish) return;
    settled(await write(template));
  };
  const retryWrite = async () => {
    settled(await retry());
  };

  return (
    <form
      aria-labelledby={headingId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
      onChange={() => {
        setTouched(true);
        // A refused event no longer says what the form does: the next Publish signs it afresh.
        if (missedHub(state)) reset();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <h3 id={headingId} className="font-serif text-[18px] text-ink">
          {item ? "Edit" : "Add"} {singular}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[12px] text-mute hover:text-ink-soft transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      {definition.fields.map((field, i) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name] ?? ""}
          onChange={(value) => setValues((prev) => ({ ...prev, [field.name]: value }))}
          problems={touched ? problemsFor(problems, field.name) : []}
          first={i === 0}
        />
      ))}
      {touched ? <CheckProblems problems={aboutTheItem} /> : null}

      <div className="flex flex-col gap-3">
        <PublishOutcome state={state} busy={busy} onRetry={() => void retryWrite()} />
        <div className="flex items-center justify-end gap-3">
          {pubkey ? (
            <button
              type="submit"
              disabled={!canPublish}
              className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={inputStyle}
            >
              {busy ? "Publishing…" : "Publish"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => useConnectDialog.getState().show()}
              className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all"
              style={inputStyle}
            >
              Connect to publish
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/** One field: its name, an input of the field's type, the header's words for it, and what the checks found about it. */
function FieldInput({
  field,
  value,
  onChange,
  problems,
  first,
}: {
  field: FieldDecl;
  value: string;
  onChange: (value: string) => void;
  problems: Problem[];
  first: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] text-ink-soft">
        {field.name}
      </label>
      <input
        id={id}
        type={INPUT_TYPES.get(field.type) ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        aria-invalid={hasBlocking(problems) || undefined}
        className={inputClass}
        style={inputStyle}
        autoFocus={first}
      />
      <p id={hintId} className="text-[11px] text-mute/80">
        {REQUIREMENT_WORDS[field.requirement]}
        {field.description ? ` · ${field.description}` : ""}
      </p>
      <CheckProblems problems={problems} />
    </div>
  );
}

const inputClass =
  "w-full bg-surface text-ink placeholder:text-mute/50 border border-rule px-3 py-2 text-[14px] outline-none focus:border-rule-strong focus:bg-surface-hover transition-all duration-200";

const inputStyle = { borderRadius: "var(--radius-input)" as const };
