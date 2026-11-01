/**
 * Whose scores decide who counts, and where those scores live. Mirrors
 * Brainstorm-UI's `services/trustSource.ts` and `services/wotRanks.ts`.
 *
 * The chain is:
 *
 *   observer pubkey -> their kind 10040 -> ["30382:rank", <TA>, <relay>] -> ranks
 *
 * An observer names its own scorer (a Trusted Assistant, "TA") in its 10040.
 * An observer with none falls back to the house, never to "everyone": a missing
 * declaration is not a reason to trust strangers. The house is not in the code.
 * Its pubkey is found at run time from brainstorm.world's NIP-05.
 *
 * A list item shows when its author ranks at or above the verified line,
 * `VERIFIED_RANK`. This module computes ranks. Nothing here, or anywhere,
 * shows one.
 */

import type { NostrEvent } from "nostr-tools";
import { isValidRelayUrl, normalizeRelayUrl } from "@/lib/curate/relayUrls";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { readRelays, readRelaysReporting } from "@/services/nostr";
import { PROFILE_RELAYS } from "@/services/relays";

/** The line, on the 30382 0-100 scale: Brainstorm's "verified" (influence 0.02). */
export const VERIFIED_RANK = 2;

/** A resolved place to read kind-30382 rank assertions from. */
export interface TrustSourceRef {
  /** The Trusted Assistant whose assertions count: the 10040's `30382:rank` target. */
  taPubkey: string;
  /** Where that TA publishes them. */
  relay: string;
}

/** "house" for the Brainstorm Perspective, else the observer's own pubkey. */
export type RankObserver = "house" | string;

export interface AuthorRanks {
  /** Rank per author the scorer has assessed. An author it hasn't assessed is absent. */
  ranks: Map<string, number>;
  /** Whose scorer answered: the observer's own, the house's (a fallback), or nobody's. */
  source: "observer" | "house" | null;
  /** The relay the ranks were read from, when there was a scorer. */
  relay?: string;
  /**
   * The authors the scorer answered for, when there was a scorer: those whose
   * read ended (EOSE). One of them absent from `ranks` is unranked; an author
   * not here is unknown, since a read that fails ranks nobody.
   */
  answered?: Set<string>;
}

const HOUSE_NIP05 = "https://brainstorm.world/.well-known/nostr.json?name=_";
/** Where this tab keeps the house it found, so a reload doesn't ask again. */
const HOUSE_KEY = "curate.house";
const TIMEOUT_MS = 8000;
/** A pubkey filter takes at most this many `#d` values per request. */
const CHUNK = 100;
/** How long "nothing found" is believed, so a relay that was down isn't taken for "never published". */
const MISS_TTL_MS = 60_000;

const HEX64 = /^[0-9a-f]{64}$/i;

/** The pubkey in lowercase, or null when it isn't 64 hex. */
function asPubkey(value: unknown): string | null {
  return typeof value === "string" && HEX64.test(value) ? value.toLowerCase() : null;
}

/**
 * Remember an answer per key. A found answer is kept for the visit; a null
 * answer only for `MISS_TTL_MS`. Callers that ask while an answer is on its way
 * share it.
 */
function remembered<V>(ask: (key: string) => Promise<V | null>) {
  interface Entry {
    answer: Promise<V | null>;
    missedAt?: number;
  }
  const held = new Map<string, Entry>();
  return {
    get(key: string): Promise<V | null> {
      const entry = held.get(key);
      if (entry && (entry.missedAt === undefined || Date.now() - entry.missedAt < MISS_TTL_MS)) {
        return entry.answer;
      }
      const fresh: Entry = { answer: ask(key).catch(() => null) };
      held.set(key, fresh);
      void fresh.answer.then((value) => {
        if (value === null) fresh.missedAt = Date.now();
      });
      return fresh.answer;
    },
    clear: () => held.clear(),
  };
}

// --- The house -------------------------------------------------------------

function heldHouse(): string | null {
  try {
    return asPubkey(sessionStorage.getItem(HOUSE_KEY));
  } catch {
    return null;
  }
}

function holdHouse(pubkey: string): void {
  try {
    sessionStorage.setItem(HOUSE_KEY, pubkey);
  } catch {
    /* no storage, or a private window: it is a convenience */
  }
}

async function discoverHouse(): Promise<string | null> {
  const held = heldHouse();
  if (held) return held;
  try {
    const res = await fetch(HOUSE_NIP05, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const doc = (await res.json()) as { names?: Record<string, unknown> } | null;
    const pubkey = asPubkey(doc?.names?._);
    if (pubkey) holdHouse(pubkey);
    return pubkey;
  } catch {
    return null;
  }
}

const houses = remembered<string>(() => discoverHouse());

/**
 * The house observer's pubkey, found rather than configured: brainstorm.world
 * serves it under the reserved NIP-05 name `_`. null when it can't be found.
 */
export function resolveHouseObserver(): Promise<string | null> {
  return houses.get("house");
}

// --- An observer's 10040 ---------------------------------------------------

/** The newest kind 10040 the observer published, from the profile relays. */
async function readDeclaration(pubkey: string): Promise<NostrEvent | null> {
  const events = await readRelays([...PROFILE_RELAYS], [{ kinds: [10040], authors: [pubkey], limit: 5 }], TIMEOUT_MS);
  // A relay may send an event the filter didn't ask for. Only the observer's own declaration counts.
  const theirs = events.filter((ev) => ev.kind === 10040 && ev.pubkey === pubkey);
  return newestPerAddress(theirs)[0] ?? null;
}

const declarations = remembered<NostrEvent>(readDeclaration);

function declarationOf(pubkey: string): Promise<NostrEvent | null> {
  const key = asPubkey(pubkey);
  return key ? declarations.get(key) : Promise.resolve(null);
}

/** The pubkey of the first row named `name` that carries a valid one. */
function providerOf(event: NostrEvent, name: string): string | null {
  for (const row of event.tags) {
    if (row[0] !== name) continue;
    const pubkey = asPubkey(row[1]);
    if (pubkey) return pubkey;
  }
  return null;
}

/**
 * Where `observer`'s rank scores live, from the `30382:rank` row of their
 * newest kind 10040. null when they never published one, or published one
 * that names no scorer: a real state, not an error.
 */
export async function resolveTrustSource(observer: string): Promise<TrustSourceRef | null> {
  const event = await declarationOf(observer);
  if (!event) return null;
  // NIP-85 keys the pointer per metric. The line is drawn on rank, so rank decides.
  for (const row of event.tags) {
    if (row[0] !== "30382:rank") continue;
    const taPubkey = asPubkey(row[1]);
    const relay = typeof row[2] === "string" && isValidRelayUrl(row[2]) ? normalizeRelayUrl(row[2]) : null;
    if (taPubkey && relay) return { taPubkey, relay };
  }
  return null;
}

/**
 * The Assistant a person has designated, from their newest kind 10040: the
 * `39998:dlist-header` row, else a bare `39998` row, else the `30382:rank`
 * provider. null when they name none.
 */
export async function readerAssistant(pubkey: string): Promise<string | null> {
  const event = await declarationOf(pubkey);
  if (!event) return null;
  return providerOf(event, "39998:dlist-header") ?? providerOf(event, "39998") ?? providerOf(event, "30382:rank");
}

// --- Ranks -----------------------------------------------------------------

async function sourceFor(
  observer: RankObserver,
): Promise<{ ref: TrustSourceRef; source: "observer" | "house" } | null> {
  if (observer !== "house") {
    const own = await resolveTrustSource(observer);
    if (own) return { ref: own, source: "observer" };
  }
  const house = await resolveHouseObserver();
  const ref = house ? await resolveTrustSource(house) : null;
  return ref ? { ref, source: "house" } : null;
}

/** The rank an assertion carries, or null when it carries none a number can be read from. */
function rankOf(event: NostrEvent): number | null {
  const raw = event.tags.find((t) => t[0] === "rank")?.[1];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const rank = Number(raw);
  return Number.isFinite(rank) ? rank : null;
}

/**
 * Each author's rank from `observer`'s scorer, falling back to the house's
 * when the observer has none. Authors are asked 100 at a time on the scorer's
 * relay. The newest assertion about an author is the one that stands; an
 * author it has no usable rank for is absent from `ranks`. A relay that fails
 * ranks nobody, so `answered` says which chunks' reads ended. It never throws.
 */
export async function fetchAuthorRanks(pubkeys: string[], observer: RankObserver): Promise<AuthorRanks> {
  const authors = [...new Set(pubkeys.filter((pk) => HEX64.test(pk)))];
  const resolved = await sourceFor(observer);
  if (!resolved) return { ranks: new Map(), source: null };
  const { ref, source } = resolved;

  const asked = new Set(authors);
  const ranks = new Map<string, number>();
  const answered = new Set<string>();
  for (let i = 0; i < authors.length; i += CHUNK) {
    const chunk = authors.slice(i, i + CHUNK);
    const read = await readRelaysReporting(
      [ref.relay],
      [{ kinds: [30382], authors: [ref.taPubkey], "#d": chunk }],
      TIMEOUT_MS,
    );
    // Only a read that ended answered for its authors: one cut short may be missing anyone's.
    if (read.outcomes[ref.relay]?.end.state === "eose") for (const pk of chunk) answered.add(pk);
    // Only the scorer's own assertions count, whatever the relay sends.
    const theirs = read.events.filter((ev) => ev.kind === 30382 && ev.pubkey === ref.taPubkey);
    // NIP-01: the newest assertion about a subject replaces the others, even one that carries no rank.
    for (const ev of newestPerAddress(theirs)) {
      const subject = ev.tags.find((t) => t[0] === "d")?.[1];
      if (!subject || !asked.has(subject)) continue;
      const rank = rankOf(ev);
      if (rank !== null) ranks.set(subject, rank);
    }
  }
  return { ranks, source, relay: ref.relay, answered };
}

/** In the reader's web of trust: ranked, at or above the verified line. Unranked is not in it. */
export const inWebOfTrust = (ranks: Map<string, number>, pubkey: string): boolean =>
  (ranks.get(pubkey) ?? -1) >= VERIFIED_RANK;

/** Forget what was found about the house and about each observer. Tests start each case from here. */
export function clearTrustCaches(): void {
  houses.clear();
  declarations.clear();
}
