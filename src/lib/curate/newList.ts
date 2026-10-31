/**
 * A list made from the quick form: its names, a description and a few typed
 * fields, published as a shared concept of the author's own (a `b` pointing at
 * itself). The form is a view of Brainstorm's list draft (lib/listDraft,
 * lib/conceptCopy), so what it publishes is what Brainstorm's checks read.
 *
 * Nothing here reads a relay: the page hands in the headers it has read.
 */
import { isBlankEvent } from "@/lib/blankEvent";
import { draftProblems, type CopyDraft, type DraftField, type EventTemplate } from "@/lib/conceptCopy";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import type { FieldRequirement } from "@/lib/dlistFields";
import { listHeaderTemplate, listProblems, newListDraft, slugOf } from "@/lib/listDraft";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { groupConcepts, type ConceptGroup } from "@/services/concepts";

/** What a field holds: words, a web address, a phone number, an email address, or the address of another event. */
export type QuickFieldType = "text" | "url" | "tel" | "email" | "address";

/** The types the form offers, in the words the person sees. */
export const QUICK_FIELD_TYPES: readonly { value: QuickFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "url", label: "Link" },
  { value: "tel", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "address", label: "Address" },
];

export interface QuickField {
  name: string;
  type: QuickFieldType;
  requirement: FieldRequirement;
  description: string;
}

export interface QuickList {
  singular: string;
  plural: string;
  description: string;
  fields: QuickField[];
}

/** The form as a list draft: every field on and the person's own, with its type and words carried. */
export function draftOfQuickList(q: QuickList): CopyDraft {
  return {
    ...newListDraft(),
    singular: q.singular,
    plural: q.plural,
    description: q.description,
    fields: q.fields.map(
      (f): DraftField => ({
        name: f.name,
        enabled: true,
        requirement: f.requirement,
        origin: "custom",
        type: f.type,
        description: f.description,
      }),
    ),
  };
}

/**
 * The shared concepts the list's names would repeat: those whose header calls
 * itself, singular or plural, what either typed name makes a short name of
 * ("Cafés" and "cafes" are one). Newest first, as `groupConcepts` orders them.
 * A header that has withdrawn from every concept is a header on its own, not
 * one to join.
 */
export function sameConcept(headers: HeaderEvent[], q: Pick<QuickList, "singular" | "plural">): ConceptGroup[] {
  const typed = new Set([q.singular, q.plural].map(slugOf).filter(Boolean));
  if (typed.size === 0) return [];
  return groupConcepts(headers).groups.filter(({ rootHeader, withdrawn }) => {
    if (!rootHeader || withdrawn.includes(rootHeader)) return false;
    const { singular, plural } = definitionOf(rootHeader);
    return [singular, plural].some((name) => typed.has(slugOf(name)));
  });
}

/** `base` if no list of the person's has it, else `base-2`, `base-3`, … the first that is free. Empty stays empty. */
export function freeShortName(base: string, taken: ReadonlySet<string>): string {
  if (!base) return base;
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}-${n}`;
  return name;
}

/** The short name of every list `author` has: the newest header at each address, a blanked one not counted. */
export function ownShortNames(headers: HeaderEvent[], author: string | null): Set<string> {
  if (!author) return new Set();
  const names = newestPerAddress(headers)
    .filter((h) => h.kind === 39998 && h.pubkey === author && !isBlankEvent(h))
    .map((h) => h.tags.find((t) => t[0] === "d")?.[1])
    .filter((d): d is string => d != null);
  return new Set(names);
}

/** The new list's header, ready to sign: a shared concept of `author`'s at the short name `d`. */
export function newListTemplate(q: QuickList, d: string, author: string): EventTemplate {
  return listHeaderTemplate(draftOfQuickList(q), { d, author, selfPointer: true });
}

/** What stops the short name: none given, or one the person's own list already has, which publishing would replace. */
export function shortNameProblems(d: string, taken: ReadonlySet<string>): string[] {
  return [
    ...listProblems(d),
    ...(taken.has(d) ? [`You already have a list with the short name "${d}". Publishing would replace it.`] : []),
  ];
}

/**
 * What stops the list from publishing, in words; empty when it can go.
 * Brainstorm's own checks of a draft (names, field names, repeats), then the
 * short name's. `taken` holds the short names of the person's own lists.
 */
export function createProblems(q: QuickList, d: string, taken: ReadonlySet<string>): string[] {
  return [...draftProblems(draftOfQuickList(q)), ...shortNameProblems(d, taken)];
}
