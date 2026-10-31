"use client";

import { useEffect, useMemo, useState } from "react";
import { discoverModel, type CardModel } from "@/app/discover-model";
import { ConceptCard } from "@/components/concept-card";
import { RelayStatusLine } from "@/components/relay-status-line";
import { useReader } from "@/hooks/use-reader";
import type { HeaderEvent } from "@/lib/conceptResolution";
import { cn } from "@/lib/utils";
import { conceptHandles, groupConcepts } from "@/services/concepts";
import {
  houseCopyAuthors,
  loadAllHeaders,
  loadDictionaryConcepts,
  resolveForReader,
} from "@/services/dictionary";
import { useShowEverything } from "@/stores/view";

interface Lists {
  headers: HeaderEvent[];
  /** The Dictionary's concepts, by root, in its order. */
  dictionary: string[];
  /** Whose copies are Brainstorm's own definitions. */
  houseAuthors: string[];
}

/**
 * Everything Discover reads, once. Each part is read on its own and none
 * rejects, so a part that can't be had (the house not found, a relay
 * refusing) leaves an empty answer and the page shows the rest.
 */
function useLists(): Lists | null {
  const [lists, setLists] = useState<Lists | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadAllHeaders().catch(() => [] as HeaderEvent[]),
      loadDictionaryConcepts().catch(() => [] as string[]),
      houseCopyAuthors().catch(() => [] as string[]),
    ]).then(([headers, dictionary, houseAuthors]) => {
      if (!cancelled) setLists({ headers, dictionary, houseAuthors });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return lists;
}

function Section({ title, cards, handles }: { title: string; cards: CardModel[]; handles: Map<string, string[]> }) {
  if (cards.length === 0) return null;
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-5 flex items-baseline gap-3">
        <h2 className="font-serif text-[22px] leading-[1.2] text-ink">{title}</h2>
        <span className="text-[12px] text-mute">
          {cards.length} {cards.length === 1 ? "list" : "lists"}
        </span>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <ConceptCard key={`${card.label ?? ""}:${card.root}`} card={card} handles={handles.get(card.root)} />
        ))}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[132px] animate-pulse border border-rule bg-surface"
          style={{ borderRadius: "var(--radius-card)", opacity: 0.3 + (i % 3) * 0.15 }}
        />
      ))}
    </div>
  );
}

export default function DiscoverPage() {
  const lists = useLists();
  const reader = useReader();
  const { on: showEverything } = useShowEverything();
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => (lists ? groupConcepts(lists.headers) : null), [lists]);

  // Each concept as this reader sees it. Signing in re-resolves to their own copy.
  const resolved = useMemo(
    () =>
      grouped && lists
        ? new Map(grouped.groups.map((g) => [g.root, resolveForReader(g, reader, lists.houseAuthors)]))
        : null,
    [grouped, lists, reader],
  );

  const handles = useMemo(() => new Map((grouped?.groups ?? []).map((g) => [g.root, conceptHandles(g)])), [grouped]);

  const model = useMemo(
    () =>
      grouped && lists && resolved
        ? discoverModel({
            groups: grouped.groups,
            blank: grouped.blank,
            dictionary: lists.dictionary,
            resolved,
            query,
            showEverything,
          })
        : null,
    [grouped, lists, resolved, query, showEverything],
  );

  const nothingFound = !!grouped && grouped.groups.length === 0 && grouped.blank.length === 0;
  const nothingShown = !!model && model.dictionary.length === 0 && model.all.length === 0;

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-12 md:py-16">
      {/* Hero */}
      <header className="max-w-2xl">
        <h1 className="font-serif text-[40px] leading-[1.08] tracking-[-0.02em] text-ink font-light">
          Lists, curated <span className="italic text-accent font-normal">together</span>.
        </h1>
        <p className="mt-4 text-[15px] leading-[1.6] text-ink-soft">
          Browse what people are collecting. Add to a list, build your own, signed to nostr and yours to take
          anywhere.
        </p>
      </header>

      {/* Search */}
      <div className="mt-10">
        <div className="relative w-full md:max-w-sm">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists..."
            aria-label="Search lists"
            className={cn(
              "w-full bg-surface text-ink placeholder:text-mute/60",
              "border border-rule px-3.5 py-2 text-[14px] outline-none",
              "focus:border-rule-strong focus:bg-surface-hover transition-all duration-200",
            )}
            style={{ borderRadius: "var(--radius-input)" }}
          />
        </div>
        <RelayStatusLine />
      </div>

      <div className="mt-10 border-t border-rule pt-8">
        {!model ? (
          <Skeleton />
        ) : nothingShown ? (
          <div className="py-16 text-center">
            <p className="font-serif text-[22px] text-ink-soft italic">
              {nothingFound
                ? "No lists found yet."
                : query.trim()
                  ? "Nothing matches that search."
                  : "Nothing to show yet."}
            </p>
            <p className="mt-3 text-[13px] text-mute">
              {nothingFound
                ? "Try widening your relay set in Settings, or be the first to publish a list."
                : query.trim()
                  ? "Try clearing the search."
                  : "Turn on Show everything to see withdrawn and blank lists."}
            </p>
          </div>
        ) : (
          <>
            <Section title="Dictionary" cards={model.dictionary} handles={handles} />
            <Section title="All lists" cards={model.all} handles={handles} />
          </>
        )}
      </div>
    </div>
  );
}
