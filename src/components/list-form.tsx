"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { CheckProblems, hasBlocking } from "@/components/check-problems";
import type { CopyDraft, DraftField } from "@/lib/conceptCopy";
import { QUICK_FIELD_TYPES } from "@/lib/curate/newList";
import type { FieldRequirement } from "@/lib/dlistFields";
import type { Problem } from "@/lib/listCheck";
import { cn } from "@/lib/utils";

interface Props {
  /** What the form opens with. */
  draft: CopyDraft;
  /** The person published this draft. */
  onSave: (draft: CopyDraft) => void;
  /** A write is in flight. */
  busy: boolean;
  /** Something the write needs hasn't arrived yet: Publish waits for it. */
  holding?: boolean;
  /** What Brainstorm's checks found about the list as the person has it now; Publish waits while any would stop it. */
  problems: Problem[];
  /** The draft, each time the person changes it, for the checks to read. */
  onChange?: (draft: CopyDraft) => void;
  /** Names the form, and heads it. */
  heading?: string;
  /** The person left without publishing. */
  onCancel?: () => void;
  /** Beside the button: how the last write went. */
  outcome?: ReactNode;
}

const REQUIREMENTS: { value: FieldRequirement; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "recommended", label: "Recommended" },
  { value: "optional", label: "Optional" },
];

/** A field row, and what its name was when the form opened (null for a row added here), to follow a rename. */
interface Row {
  id: number;
  was: string | null;
  field: DraftField;
}

interface Values {
  singular: string;
  plural: string;
  description: string;
  rows: Row[];
}

/**
 * The types a field's menu offers: the five the form speaks, and the field's
 * own when it is none of them, so choosing nothing else keeps it.
 */
function typeOptions(type: string): readonly { value: string; label: string }[] {
  return QUICK_FIELD_TYPES.some((t) => t.value === type) ? QUICK_FIELD_TYPES : [...QUICK_FIELD_TYPES, { value: type, label: type }];
}

/**
 * The draft the form holds as a whole one. Display hints, links and the list's
 * image aren't on the form and go through as they were, except that what
 * names a field follows the field when the person renames it, so a hint
 * doesn't lose its field. A field with no name yet is followed by nothing.
 */
function draftOf(opened: CopyDraft, { singular, plural, description, rows }: Values): CopyDraft {
  const renamed = new Map(
    rows.flatMap(({ was, field }) => {
      const now = field.name.trim();
      return was && now && now !== was ? [[was, now] as const] : [];
    }),
  );
  const follow = (name: string): string => renamed.get(name) ?? name;
  const { display } = opened;
  return {
    ...opened,
    singular,
    plural,
    description,
    fields: rows.map((row) => row.field),
    display: {
      ...display,
      title: display.title && follow(display.title),
      summary: display.summary && follow(display.summary),
      image: display.image && follow(display.image),
      link: display.link && follow(display.link),
      media: display.media && follow(display.media),
      location: display.location && follow(display.location),
      facts: display.facts.map((fact) => ({ ...fact, field: follow(fact.field) })),
    },
    links: opened.links.map((link) => ({
      ...link,
      bindings: link.bindings.map(([placeholder, field]) => [placeholder, follow(field)] as [string, string]),
    })),
  };
}

/**
 * A list's names and fields: what it is called, what each item holds, and a
 * type and a requirement for each field. It is a view of a list draft
 * (lib/conceptCopy), and saving it untouched hands back the draft it was given.
 *
 * The draft's display hints, links and image aren't shown; they stay with the
 * list. Brainstorm's checks are the page's to run on the draft that
 * `onChange` hands over, and come back as `problems`.
 */
export function ListForm({
  draft,
  onSave,
  busy,
  holding = false,
  problems,
  onChange,
  heading,
  onCancel,
  outcome,
}: Props) {
  const headingId = useId();
  const nextRow = useRef(draft.fields.length);
  const [values, setValues] = useState(
    (): Values => ({
      singular: draft.singular,
      plural: draft.plural,
      description: draft.description,
      rows: draft.fields.map((field, id) => ({ id, was: field.name, field })),
    }),
  );
  const canPublish = !busy && !holding && !hasBlocking(problems);

  const edit = (next: Values) => {
    setValues(next);
    onChange?.(draftOf(draft, next));
  };
  const changeRow = (id: number, patch: Partial<DraftField>) =>
    edit({
      ...values,
      rows: values.rows.map((row) => (row.id === id ? { ...row, field: { ...row.field, ...patch } } : row)),
    });
  const addRow = () =>
    edit({
      ...values,
      rows: [
        ...values.rows,
        {
          id: nextRow.current++,
          was: null,
          field: { name: "", enabled: true, requirement: "optional", origin: "custom", type: "text", description: "" },
        },
      ],
    });
  const removeRow = (id: number) => edit({ ...values, rows: values.rows.filter((row) => row.id !== id) });

  return (
    <form
      aria-labelledby={heading ? headingId : undefined}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canPublish) onSave(draftOf(draft, values));
      }}
      className="flex flex-col gap-5"
    >
      {heading || onCancel ? (
        <div className="flex items-center justify-between">
          {heading ? (
            <h3 id={headingId} className="font-serif text-[18px] text-ink">
              {heading}
            </h3>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="text-[12px] text-mute hover:text-ink-soft transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <Labelled label="Singular name" hint="What one item is called, as in “Café”.">
          {(id, hint) => (
            <input
              id={id}
              aria-describedby={hint}
              type="text"
              value={values.singular}
              onChange={(e) => edit({ ...values, singular: e.target.value })}
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
              value={values.plural}
              onChange={(e) => edit({ ...values, plural: e.target.value })}
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
              value={values.description}
              onChange={(e) => edit({ ...values, description: e.target.value })}
              rows={3}
              className={cn(inputClass, "resize-none")}
              style={inputStyle}
            />
          )}
        </Labelled>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-[12px] text-ink-soft">Fields</span>
        <ul className="flex flex-col gap-3">
          {values.rows.map(({ id, field }, i) => {
            const n = i + 1;
            return (
              <li
                key={id}
                className="border border-rule bg-surface p-3 flex flex-col gap-2"
                style={{ borderRadius: "var(--radius-card)" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Field ${n} name`}
                    value={field.name}
                    onChange={(e) => changeRow(id, { name: e.target.value })}
                          placeholder="Field name"
                    className={cn(inputClass, "min-w-[10rem] flex-1 text-[13px]")}
                    style={inputStyle}
                  />
                  <select
                    aria-label={`Field ${n} type`}
                    value={field.type ?? "text"}
                    onChange={(e) => changeRow(id, { type: e.target.value })}
                          className={selectClass}
                    style={inputStyle}
                  >
                    {typeOptions(field.type ?? "text").map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Field ${n} requirement`}
                    value={field.requirement}
                    onChange={(e) => changeRow(id, { requirement: e.target.value as FieldRequirement })}
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
                    onClick={() => removeRow(id)}
                          className="px-1 text-[18px] leading-none text-mute hover:text-accent transition-colors"
                  >
                    &times;
                  </button>
                </div>
                <input
                  type="text"
                  aria-label={`Field ${n} description`}
                  value={field.description ?? ""}
                  onChange={(e) => changeRow(id, { description: e.target.value })}
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
        <CheckProblems problems={problems} />
      </div>

      <div className="flex flex-col gap-3">
        {outcome}
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!canPublish}
            className="text-[13px] font-medium px-5 py-2 bg-accent text-ink hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={inputStyle}
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </form>
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
  children: (id: string, hintId: string) => ReactNode;
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
