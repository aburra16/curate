#!/usr/bin/env node
// Saves real events from the relays as test fixtures under src/test/fixtures/.
//
//   node scripts/save-fixtures.mjs          fetch every fixture and rewrite it
//   node scripts/save-fixtures.mjs food     only the fixtures whose name contains "food"
//
// Each fixture is a JSON array of events exactly as the relay signed them, sorted
// by id, so running this twice against an unchanged relay writes the same bytes.
// Uses Node's global WebSocket; no dependencies beyond nostr-tools (signature check).
//
// `nip.examples.json` is written by hand and is not touched here.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEvent } from "nostr-tools/pure";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "test", "fixtures");

const DCOSL = "wss://dcosl.brainstorm.world";
const TAG_HUB = "wss://tags.brainstorm.world/relay";
const TIMEOUT_MS = 15_000;

const HOUSE = "2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331";
const FOOD_AUTHOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${FOOD_AUTHOR}:food-and-drink-places`;
const TAG_AUTHOR = "a68dbf561cfe3da1b76f1e65c7d4d9cc116f79921b38a815fd75cb5460b4b599";
const TAGS = `39998:${TAG_AUTHOR}:tag`;
const BOOKS_AUTHOR = "6aca05b812da97601151776d13de04ae71afc9d86da1408f0e72cffef72ece4b";
const BOOKS = `39998:${BOOKS_AUTHOR}:books`;
const GITHUB = `39998:${FOOD_AUTHOR}:github-accounts`;
const V4V_AUTHOR = "77599c5c4a7ba08456679d812a414037f4b01c975fb4f577187df11d189f80d3";
const V4V = `39998:${V4V_AUTHOR}:b504f5a8-949f-4d31-ad14-8afcebde2b34`;
const CURATOR_TAG = `39999:${HOUSE}:dictionary-concept-curator`;
const HOUSE_NIP05 = "https://brainstorm.world/.well-known/nostr.json?name=_";

/** The house observer, as the app finds it: brainstorm.world's NIP-05 name `_`. */
async function houseObserver() {
  const res = await fetch(HOUSE_NIP05, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const pubkey = (await res.json())?.names?._;
  if (!/^[0-9a-f]{64}$/.test(pubkey ?? "")) throw new Error(`no house at ${HOUSE_NIP05}`);
  return pubkey;
}

/** Ask one relay one filter; resolve with its events at EOSE. */
function query(url, filter) {
  return new Promise((resolve, reject) => {
    const subId = `fx-${Math.random().toString(36).slice(2, 10)}`;
    const events = new Map();
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.send(JSON.stringify(["CLOSE", subId]));
      } catch {
        // socket already closing
      }
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve([...events.values()]);
    };
    const timer = setTimeout(
      () => finish(new Error(`timeout after ${TIMEOUT_MS} ms: ${url} ${JSON.stringify(filter)}`)),
      TIMEOUT_MS
    );
    ws.addEventListener("open", () => ws.send(JSON.stringify(["REQ", subId, filter])));
    ws.addEventListener("error", () => finish(new Error(`socket error: ${url}`)));
    ws.addEventListener("close", () => finish(new Error(`closed before EOSE: ${url}`)));
    ws.addEventListener("message", (m) => {
      let msg;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (msg[0] === "EVENT" && msg[1] === subId) events.set(msg[2].id, msg[2]);
      else if (msg[0] === "EOSE" && msg[1] === subId) finish();
      else if (msg[0] === "CLOSED" && msg[1] === subId)
        finish(new Error(`relay closed the request: ${msg[2]} (${url})`));
    });
  });
}

const newestFirst = (a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1);

/**
 * Each fixture: a name, and a function returning its events.
 * `pick(n, events, pinned)` drops repeats, keeps the pinned ids first, then the newest, up to n.
 */
function pick(n, events, pinned = []) {
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  const first = unique.filter((e) => pinned.includes(e.id));
  const rest = unique.filter((e) => !pinned.includes(e.id)).sort(newestFirst);
  return [...first, ...rest].slice(0, n);
}

const FIXTURES = [
  {
    name: "food.header",
    run: () =>
      query(DCOSL, { kinds: [39998], authors: [FOOD_AUTHOR], "#d": ["food-and-drink-places"] }),
  },
  {
    name: "food.copies",
    run: async () => {
      const root = await query(DCOSL, {
        kinds: [39998],
        authors: [FOOD_AUTHOR],
        "#d": ["food-and-drink-places"],
      });
      const rootIds = new Set(root.map((e) => e.id));
      const copies = (await query(DCOSL, { kinds: [39998], "#b": [FOOD] })).filter(
        (e) => !rootIds.has(e.id)
      );
      // The withdrawn copy: the house's own food-and-drink-places, carrying ["b","b-tag-deferred"].
      const withdrawn = await query(DCOSL, {
        kinds: [39998],
        authors: [HOUSE],
        "#d": ["food-and-drink-places"],
      });
      return [...copies, ...withdrawn];
    },
  },
  {
    name: "food.items",
    run: async () => pick(3, await query(DCOSL, { kinds: [39999], "#z": [FOOD], limit: 3 })),
  },
  {
    name: "tags.headers",
    run: () =>
      query(DCOSL, {
        kinds: [39998],
        authors: [
          TAG_AUTHOR,
          "919ba08af7786892093b8264332d817379662a0ba0ba1f5c791ed7b62a7ee2ff",
          "8e901369d45081cf05fe17ba802441dd731f73e000149c333daf4880a58e5fb1",
          "82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833",
        ],
        "#d": ["tag"],
      }),
  },
  {
    name: "tags.items",
    run: async () => {
      // "Classics": data in `content` JSON, tags only d/z/client. Pinned so it is always kept.
      const CLASSICS = "4d4ada496a2b3710d44d9390adbe3e9612a941e271ff3638b13c338faab569a3";
      const [byId, under] = await Promise.all([
        query(DCOSL, { ids: [CLASSICS] }),
        query(DCOSL, { kinds: [39999], "#z": [TAGS], limit: 3 }),
      ]);
      return pick(3, [...byId, ...under], [CLASSICS]);
    },
  },
  {
    name: "books.header",
    run: () => query(DCOSL, { kinds: [39998], authors: [BOOKS_AUTHOR], "#d": ["books"] }),
  },
  {
    name: "books.items",
    run: async () => pick(3, await query(DCOSL, { kinds: [39999], "#z": [BOOKS], limit: 3 })),
  },
  {
    name: "book-submissions.header",
    run: async () => {
      // Old shape: `d` plus `json`, no `names`. Keep one (the newest; ties by id).
      const all = await query(DCOSL, { kinds: [39998], "#d": ["book-submissions"] });
      return pick(1, all.filter((e) => !e.tags.some((t) => t[0] === "names")));
    },
  },
  {
    name: "github.header",
    run: () =>
      query(DCOSL, { kinds: [39998], authors: [FOOD_AUTHOR], "#d": ["github-accounts"] }),
  },
  {
    name: "github.items",
    run: async () => pick(2, await query(DCOSL, { kinds: [39999], "#z": [GITHUB], limit: 2 })),
  },
  {
    name: "github.template",
    run: async () => {
      const ids = { ids: ["f19f39daf75388ff0f19cc37dde5ae1b90124b0d60e35659160c48dc690deca4"] };
      const fromDcosl = await query(DCOSL, ids);
      return fromDcosl.length > 0 ? fromDcosl : query(TAG_HUB, ids);
    },
  },
  {
    name: "dictionary.taggings",
    // Every tagging with the Dictionary's curator tag, whoever made it: the house's say who curates,
    // anyone else's must not.
    run: () => query(DCOSL, { kinds: [39999], "#a": [CURATOR_TAG] }),
  },
  {
    name: "dictionary.headers",
    // The headers of everyone the house tagged a curator: their self-pointing ones are the Dictionary.
    run: async () => {
      const house = await houseObserver();
      const taggings = await query(DCOSL, { kinds: [39999], authors: [house], "#a": [CURATOR_TAG] });
      const curators = [
        ...new Set(taggings.map((e) => e.tags.find((t) => t[0] === "p")?.[1]).filter(Boolean)),
      ];
      return query(DCOSL, { kinds: [39998], authors: curators });
    },
  },
  {
    name: "v4v-songs.header",
    run: () =>
      query(DCOSL, {
        kinds: [39998],
        authors: [V4V_AUTHOR],
        "#d": ["b504f5a8-949f-4d31-ad14-8afcebde2b34"],
      }),
  },
  {
    name: "v4v-songs.items",
    // These items are kind 9999 (unreplaceable), so ask for both item kinds.
    run: async () =>
      pick(2, await query(DCOSL, { kinds: [9999, 39999], "#z": [V4V], limit: 2 })),
  },
];

const only = process.argv[2];
mkdirSync(OUT, { recursive: true });

let failed = false;
for (const fx of FIXTURES) {
  if (only && !fx.name.includes(only)) continue;
  try {
    const events = (await fx.run()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const unsigned = events.filter((e) => !verifyEvent(e));
    writeFileSync(join(OUT, `${fx.name}.json`), `${JSON.stringify(events, null, 2)}\n`);
    console.log(
      `${fx.name.padEnd(26)} ${String(events.length).padStart(3)} event(s)` +
        (events.length === 0 ? "  <-- EMPTY: the filter returned nothing" : "") +
        (unsigned.length ? `  <-- ${unsigned.length} failed signature check` : "")
    );
  } catch (err) {
    failed = true;
    console.error(`${fx.name.padEnd(26)} FAILED: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
