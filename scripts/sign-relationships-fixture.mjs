#!/usr/bin/env node
// Writes src/test/fixtures/relationships.json: an item and what it is connected to,
// signed with fixed test keys, for src/services/relationships.test.ts.
//
//   node scripts/sign-relationships-fixture.mjs
//
// The relays hold almost no item taggings or copies yet, so these events are built
// by hand in the shapes Brainstorm-UI's event-tagging builders write (tag elements,
// per-tag tagging headers, taggings) and signed here. Each role's secret key is one
// byte repeated 32 times. The fixture is an object keyed by each event's name.
// Ids are the same on every run; BIP-340 signatures carry fresh randomness, so a
// rerun rewrites every `sig`. Uses nostr-tools only.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "test",
  "fixtures",
  "relationships.json"
);

/** A role's keys: its secret key is `byte` repeated 32 times. */
function role(byte) {
  const sk = hexToBytes(byte.repeat(32));
  return { sk, pk: getPublicKey(sk) };
}

const OWNER = role("11");
const CURATOR = role("22");
const TAG_AUTHOR = role("33");
const TAGGER = role("44");
const DISPUTER = role("55");
const MENTIONER = role("66");
const STRANGER = role("77");
const ROGUE = role("88");
const PROPRIETOR = role("99");

/** The namespaces Curate honours taggings under (src/config/tagging.ts). */
const HONOURED = [
  "82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833",
  "a68dbf561cfe3da1b76f1e65c7d4d9cc116f79921b38a815fd75cb5460b4b599",
];
const HUB = "wss://dcosl.brainstorm.world";
const T = 1_792_000_000;

const sign = (who, kind, tags, created_at, content = "") =>
  finalizeEvent({ kind, created_at, content, tags }, who.sk);
const coord = (ev) => `${ev.kind}:${ev.pubkey}:${ev.tags.find((t) => t[0] === "d")[1]}`;

const out = {};

// Lists and items on the hub.
out.ownerList = sign(OWNER, 39998, [["d", "coffee-places"], ["names", "Coffee place", "Coffee places"]], T);
out.otherItem = sign(
  OWNER,
  39999,
  [["d", "other-cafe"], ["z", coord(out.ownerList)], ["name", "Other Cafe"]],
  T + 1
);
out.item = sign(
  OWNER,
  39999,
  [
    ["d", "blue-door-cafe"],
    ["z", coord(out.ownerList)],
    ["z", `39998:${OWNER.pk}:closed-places`],
    ["name", "Blue Door Cafe"],
    ["p", PROPRIETOR.pk],
    ["t", "coffee"],
    ["t", "coffee"],
    ["e", out.otherItem.id],
    ["a", coord(out.otherItem)],
  ],
  T + 2
);
const ITEM = coord(out.item);

// A curation copy of the item, one of another item, and the curator's list.
out.curatorList = sign(
  CURATOR,
  39998,
  [["d", "favourite-cafes"], ["names", "Favourite cafe", "Favourite cafes"]],
  T + 3
);
out.copy = sign(
  CURATOR,
  39999,
  [
    ["d", "copy-blue-door-cafe"],
    ["z", coord(out.curatorList)],
    ["q", out.item.id, HUB, OWNER.pk],
    ["q", ITEM, HUB],
    ["a", ITEM],
    ["name", "Blue Door Cafe"],
  ],
  T + 4
);
out.otherCopy = sign(
  CURATOR,
  39999,
  [
    ["d", "copy-other-cafe"],
    ["z", coord(out.curatorList)],
    ["q", out.otherItem.id, HUB, OWNER.pk],
    ["q", coord(out.otherItem), HUB],
  ],
  T + 4
);

// Items on another list that name the item, one quoting it without being a copy, and a reaction.
out.mentionList = sign(
  MENTIONER,
  39998,
  [["d", "cafes-worth-the-walk"], ["names", "Cafe worth the walk", "Cafes worth the walk"]],
  T + 5
);
out.mention = sign(
  MENTIONER,
  39999,
  [["d", "walk-1"], ["z", coord(out.mentionList)], ["a", ITEM], ["name", "Start here"]],
  T + 6
);
out.quoting = sign(
  MENTIONER,
  39999,
  [["d", "walk-2"], ["z", coord(out.mentionList)], ["q", ITEM], ["name", "Quoted"]],
  T + 6
);
out.strangerMention = sign(
  STRANGER,
  9999,
  [["z", coord(out.mentionList)], ["e", out.item.id], ["name", "Also good"]],
  T + 7
);
out.reaction = sign(
  MENTIONER,
  7,
  [["e", out.item.id], ["a", ITEM], ["p", OWNER.pk], ["k", "39999"]],
  T + 8,
  "+"
);

// A 9998 list with an item filed under it by `e`, and a list of lists that names it.
out.smallList = sign(OWNER, 9998, [["names", "Corner shop", "Corner shops"]], T + 9);
out.cornerItem = sign(OWNER, 9999, [["e", out.smallList.id], ["name", "Corner Shop"]], T + 10);
out.listOfLists = sign(
  MENTIONER,
  39999,
  [["d", "lists-i-follow-1"], ["z", `39998:${MENTIONER.pk}:lists-i-follow`], ["e", out.smallList.id]],
  T + 11
);

/** A tag element, as Brainstorm writes one: its name in the content's JSON. */
const element = (who, slug, name, extra = []) =>
  sign(
    who,
    39999,
    [
      ["d", slug],
      ...HONOURED.map((pk) => ["z", `39998:${pk}:tag`]),
      ["z", "tag-for-nostr-event"],
      ["client", "Brainstorm"],
      ...extra,
    ],
    T + 20,
    JSON.stringify({ tag: { slug, name, description: "" } })
  );

/** A per-tag tagging header, joining the namespaces of `authorities`. */
const header = (who, tagAuthor, slug, display, authorities) =>
  sign(
    who,
    39999,
    [
      ["d", `tagging:${slug}-tagging`],
      ["names", `Tagging of an event as ${display}`, `Taggings of events as ${display}`],
      ["description", `Applies the ${display} tag to an event.`],
      ...authorities.map((pk) => ["z", `39998:${pk}:tagging-with-specific-tag`]),
      ["a", `39999:${tagAuthor.pk}:${slug}`],
    ],
    T + 21
  );

/** A tagging of a target, by `a` or by `e`, as Brainstorm's builder writes one. */
const tagging = (who, headerAuthor, slug, polarity, [letter, value], created_at) => {
  const target8 = letter === "e" ? value.slice(0, 8) : value.split(":")[1].slice(0, 8);
  return sign(
    who,
    39999,
    [
      ["d", `event-tag-${slug}-${target8}-${who.pk.slice(0, 8)}`],
      [letter, value],
      ...HONOURED.map((pk) => ["z", `39998:${pk}:nostr-event-tag`]),
      ["z", `39999:${headerAuthor.pk}:tagging:${slug}-tagging`],
      ["polarity", String(polarity)],
    ],
    created_at
  );
};

// Tags: three under honoured headers (one with no element), one under a header nobody honours.
out.cosyElement = element(TAG_AUTHOR, "cosy", "Cosy");
out.quietElement = element(TAG_AUTHOR, "quiet", "Quiet", [["name", "Quiet corner"]]);
out.overpricedElement = element(ROGUE, "overpriced", "Overpriced");

out.cosyHeader = header(TAG_AUTHOR, TAG_AUTHOR, "cosy", "Cosy", HONOURED);
out.quietHeader = header(TAG_AUTHOR, TAG_AUTHOR, "quiet", "Quiet", HONOURED);
out.goodWifiHeader = header(TAG_AUTHOR, TAG_AUTHOR, "good-wifi", "Good Wifi", HONOURED);
out.overpricedHeader = header(ROGUE, ROGUE, "overpriced", "Overpriced", [ROGUE.pk]);

out.cosyByTagger = tagging(TAGGER, TAG_AUTHOR, "cosy", 1, ["a", ITEM], T + 30);
out.cosyByDisputer = tagging(DISPUTER, TAG_AUTHOR, "cosy", -1, ["a", ITEM], T + 31);
out.cosyByStranger = tagging(STRANGER, TAG_AUTHOR, "cosy", 1, ["a", ITEM], T + 32);
out.quietByMentioner = tagging(MENTIONER, TAG_AUTHOR, "quiet", 1, ["e", out.item.id], T + 33);
out.goodWifiByTagger = tagging(TAGGER, TAG_AUTHOR, "good-wifi", 1, ["a", ITEM], T + 34);
out.cosyOnOtherItem = tagging(MENTIONER, TAG_AUTHOR, "cosy", 1, ["a", coord(out.otherItem)], T + 36);
out.overpricedByTagger = tagging(TAGGER, ROGUE, "overpriced", 1, ["a", ITEM], T + 35);

const events = Object.fromEntries(
  Object.entries(out).map(([name, ev]) => [
    name,
    {
      id: ev.id,
      pubkey: ev.pubkey,
      created_at: ev.created_at,
      kind: ev.kind,
      tags: ev.tags,
      content: ev.content,
      sig: ev.sig,
    },
  ])
);
const unsigned = Object.entries(events).filter(([, ev]) => !verifyEvent(ev));
if (unsigned.length) {
  console.error(`failed signature check: ${unsigned.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
writeFileSync(OUT, `${JSON.stringify(events, null, 2)}\n`);
console.log(`relationships ${Object.keys(events).length} event(s)`);
