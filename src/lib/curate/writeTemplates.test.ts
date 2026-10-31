import type { NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { DCOSL } from "@/services/relays";
import foodItems from "@/test/fixtures/food.items.json";
import tagItems from "@/test/fixtures/tags.items.json";
import {
  applyVote,
  deletionTemplate,
  editedItemTemplate,
  patchItemTags,
  voteTemplate,
  type ReactionCount,
} from "./writeTemplates";

const steak = foodItems[0] as NostrEvent;
const tag = tagItems[0] as NostrEvent;
const steakCoord = `39999:${steak.pubkey}:osm-way-91202967`;
const tagCoord = `39999:${tag.pubkey}:espresso`;

const HEX = "ab".repeat(32);
const OTHER_VERSION = "cd".repeat(32);
const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";

/** A kind 9999 item: it has no `d`. */
const plain: NostrEvent = {
  id: HEX,
  pubkey: CURATOR,
  kind: 9999,
  created_at: 1_790_000_000,
  content: "",
  tags: [["z", `39998:${CURATOR}:food-and-drink-places`], ["name", "Corner cafe"]],
  sig: "0".repeat(128),
};

describe("voteTemplate", () => {
  it("up vote on an item with a d: event, address, author and kind, all hinted at the hub", () => {
    expect(voteTemplate(steak, "+")).toEqual({
      kind: 7,
      content: "+",
      tags: [
        ["e", steak.id, DCOSL],
        ["a", steakCoord, DCOSL],
        ["p", steak.pubkey],
        ["k", "39999"],
      ],
    });
    expect(voteTemplate(tag, "+").tags).toEqual([
      ["e", tag.id, DCOSL],
      ["a", tagCoord, DCOSL],
      ["p", tag.pubkey],
      ["k", "39999"],
    ]);
  });

  it("down vote carries the same tags with content '-'", () => {
    const up = voteTemplate(steak, "+");
    const down = voteTemplate(steak, "-");
    expect(down.content).toBe("-");
    expect(down.kind).toBe(7);
    expect(down.tags).toEqual(up.tags);
  });

  it("points at the given relay instead of the hub when one is passed", () => {
    const hint = "wss://relay.example.test";
    expect(voteTemplate(steak, "+", hint).tags).toEqual([
      ["e", steak.id, hint],
      ["a", steakCoord, hint],
      ["p", steak.pubkey],
      ["k", "39999"],
    ]);
  });

  it("an item of kind 9999 is reached by its id alone", () => {
    expect(voteTemplate(plain, "+").tags).toEqual([
      ["e", HEX, DCOSL],
      ["p", CURATOR],
      ["k", "9999"],
    ]);
  });

  it("never names the list's definition", () => {
    for (const item of [steak, tag, plain]) {
      for (const vote of ["+", "-"] as const) {
        const named = voteTemplate(item, vote).tags.flat().filter((v) => v.startsWith("39998:"));
        expect(named).toEqual([]);
      }
    }
  });
});

describe("deletionTemplate", () => {
  it("two versions of an addressable item: each id, then the address, then the kind", () => {
    expect(deletionTemplate(steak, [steak.id, OTHER_VERSION])).toEqual({
      kind: 5,
      content: "",
      tags: [["e", steak.id], ["e", OTHER_VERSION], ["a", steakCoord], ["k", "39999"]],
    });
  });

  it("lists a repeated id once, in first-seen order", () => {
    expect(deletionTemplate(tag, [OTHER_VERSION, tag.id, OTHER_VERSION]).tags).toEqual([
      ["e", OTHER_VERSION],
      ["e", tag.id],
      ["a", tagCoord],
      ["k", "39999"],
    ]);
  });

  it("an item of kind 9999 has no address to name", () => {
    expect(deletionTemplate(plain, [HEX]).tags).toEqual([["e", HEX], ["k", "9999"]]);
  });
});

describe("patchItemTags", () => {
  it("replaces a field's value and keeps every other tag where it was", () => {
    const tags = [
      ["d", "cafe"],
      ["z", `39998:${CURATOR}:food-and-drink-places`],
      ["alt", "A cafe"],
      ["name", "Old name"],
      ["wifi", "yes", "from-survey"],
      ["category", "cafe"],
    ];
    expect(patchItemTags(tags, { name: "New name", category: "bakery" })).toEqual([
      ["d", "cafe"],
      ["z", `39998:${CURATOR}:food-and-drink-places`],
      ["alt", "A cafe"],
      ["name", "New name"],
      ["wifi", "yes", "from-survey"],
      ["category", "bakery"],
    ]);
  });

  it("keeps the elements after the value on the tag it replaces", () => {
    expect(patchItemTags([["website", "https://a.example", "primary"]], { website: "https://b.example" })).toEqual([
      ["website", "https://b.example", "primary"],
    ]);
  });

  it("an empty value removes that field's first tag only", () => {
    expect(patchItemTags([["d", "x"], ["name", "A"], ["note", "1"], ["note", "2"]], { note: "" })).toEqual([
      ["d", "x"],
      ["name", "A"],
      ["note", "2"],
    ]);
  });

  it("appends a field that has no tag yet", () => {
    expect(patchItemTags([["d", "x"], ["name", "A"]], { phone: "555-0100" })).toEqual([
      ["d", "x"],
      ["name", "A"],
      ["phone", "555-0100"],
    ]);
  });

  it("an empty value for a field with no tag adds nothing", () => {
    expect(patchItemTags([["d", "x"]], { phone: "" })).toEqual([["d", "x"]]);
  });

  it("changes the first of a repeated tag and leaves the rest", () => {
    expect(patchItemTags([["d", "x"], ["genre", "a"], ["genre", "b"]], { genre: "c" })).toEqual([
      ["d", "x"],
      ["genre", "c"],
      ["genre", "b"],
    ]);
  });

  it("no changes: the same tags, as new arrays", () => {
    const patched = patchItemTags(steak.tags, {});
    expect(patched).toEqual(steak.tags);
    expect(patched).not.toBe(steak.tags);
    expect(patched[0]).not.toBe(steak.tags[0]);
  });

  it("does not change the tags it is given", () => {
    const tags = [["d", "x"], ["name", "A", "extra"]];
    const before = JSON.stringify(tags);
    patchItemTags(tags, { name: "B", phone: "1" });
    expect(JSON.stringify(tags)).toBe(before);
  });
});

describe("editedItemTemplate", () => {
  it("is a 39999 with the item's content and its tags patched", () => {
    const edited = editedItemTemplate(tag, { description: "strong coffee" });
    expect(edited.kind).toBe(39999);
    expect(edited.content).toBe(tag.content);
    expect(edited.tags).toEqual([...tag.tags, ["description", "strong coffee"]]);
  });

  it("an unchanged edit republishes the same tags", () => {
    expect(editedItemTemplate(steak, {}).tags).toEqual(steak.tags);
  });

  it("changing a field keeps d, z and the tags the list does not declare", () => {
    const edited = editedItemTemplate(steak, { name: "Steak and Shake" });
    expect(edited.tags.find((t) => t[0] === "name")).toEqual(["name", "Steak and Shake"]);
    expect(edited.tags.filter((t) => t[0] !== "name")).toEqual(steak.tags.filter((t) => t[0] !== "name"));
    expect(edited.tags.map((t) => t[0])).toEqual(steak.tags.map((t) => t[0]));
  });
});

describe("applyVote", () => {
  const count: ReactionCount = { up: 4, down: 2, mine: "+" };

  it("from up to down, with the reader counted, moves the vote across", () => {
    expect(applyVote(count, "-", true)).toEqual({ up: 3, down: 3, mine: "-" });
  });

  it("the same vote again changes nothing", () => {
    expect(applyVote(count, "+", true)).toEqual(count);
    expect(applyVote(count, "+", false)).toEqual(count);
  });

  it("a first vote adds to its side", () => {
    expect(applyVote({ up: 4, down: 2, mine: null }, "+", true)).toEqual({ up: 5, down: 2, mine: "+" });
    expect(applyVote({ up: 4, down: 2, mine: null }, "-", true)).toEqual({ up: 4, down: 3, mine: "-" });
  });

  it("with the reader not counted, only the reader's own mark changes", () => {
    expect(applyVote(count, "-", false)).toEqual({ up: 4, down: 2, mine: "-" });
    expect(applyVote({ up: 4, down: 2, mine: null }, "+", false)).toEqual({ up: 4, down: 2, mine: "+" });
  });

  it("never leaves a side below zero, though the count was stale", () => {
    expect(applyVote({ up: 0, down: 2, mine: "+" }, "-", true)).toEqual({ up: 0, down: 3, mine: "-" });
    expect(applyVote({ up: 3, down: 0, mine: "-" }, "+", true)).toEqual({ up: 4, down: 0, mine: "+" });
  });

  it("does not change the count it is given", () => {
    const before = { ...count };
    applyVote(count, "-", true);
    expect(count).toEqual(before);
  });
});
