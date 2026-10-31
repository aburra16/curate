import { describe, expect, it } from "vitest";
import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { buildListHeaderEvent, buildListItemEvent } from "@/lib/nostr/events";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagHeaders from "@/test/fixtures/tags.headers.json";
import tagItems from "@/test/fixtures/tags.items.json";
import booksHeaders from "@/test/fixtures/books.header.json";
import bookSubmissionHeaders from "@/test/fixtures/book-submissions.header.json";
import githubHeaders from "@/test/fixtures/github.header.json";
import githubItems from "@/test/fixtures/github.items.json";
import v4vHeaders from "@/test/fixtures/v4v-songs.header.json";
import v4vItems from "@/test/fixtures/v4v-songs.items.json";
import nipExamples from "@/test/fixtures/nip.examples.json";
import { headerEditIsLossless, itemEditIsLossless } from "./editGuard";

const AUTHOR = "ab".repeat(32);

/** Dress an unsigned template as an event, as it would come back from a relay. */
function signed(template: EventTemplate, id: string): NostrEvent {
  return { ...template, id, pubkey: AUTHOR, sig: "00".repeat(64) };
}

const coffeeHeader = signed(
  buildListHeaderEvent({
    namePlural: "Coffee Shops",
    nameSingular: "Coffee Shop",
    schema: [{ name: "name", type: "text", presence: "required" }],
  }),
  "c1".repeat(32)
);
const coffeeUuid = `39998:${AUTHOR}:coffee-shops`;

function coffeeItem(extra: Partial<Parameters<typeof buildListItemEvent>[0]> = {}) {
  return signed(
    buildListItemEvent({
      parentListUuid: coffeeUuid,
      fields: {},
      name: "Joe's",
      dTag: "joes",
      ...extra,
    }),
    "c2".repeat(32)
  );
}

// The Tag concept header by a68dbf56…, which the tag items are filed under.
const tagHeader = (tagHeaders as NostrEvent[]).find((e) => e.pubkey.startsWith("a68dbf56"))!;

describe("headerEditIsLossless", () => {
  it("is false for the Food and Drink Places header (display hints, b, recommended)", () => {
    expect(headerEditIsLossless((foodHeaders as NostrEvent[])[0])).toBe(false);
  });

  it("is true for a header Curate's own builder made", () => {
    expect(headerEditIsLossless(coffeeHeader)).toBe(true);
  });

  it("is false when the header carries a tag the form never rewrites", () => {
    const withB = { ...coffeeHeader, tags: [...coffeeHeader.tags, ["b", "39998:x:y", "pointer"]] };
    expect(headerEditIsLossless(withB)).toBe(false);
    const withDisplay = { ...coffeeHeader, tags: [...coffeeHeader.tags, ["display", "title", "name"]] };
    expect(headerEditIsLossless(withDisplay)).toBe(false);
  });

  it("is false when a field is `recommended`, which the form saves as `allowed`", () => {
    const recommended = signed(
      buildListHeaderEvent({
        namePlural: "Coffee Shops",
        nameSingular: "Coffee Shop",
        schema: [
          { name: "name", type: "text", presence: "required" },
          { name: "roaster", type: "text", presence: "recommended" },
        ],
      }),
      "c3".repeat(32)
    );
    expect(headerEditIsLossless(recommended)).toBe(false);
  });

  it("is false for a header with no declared fields, which the form fills with a `name` field", () => {
    expect(headerEditIsLossless((bookSubmissionHeaders as NostrEvent[])[0])).toBe(false);
  });

  it("is false for the books and GitHub accounts headers", () => {
    expect(headerEditIsLossless((booksHeaders as NostrEvent[])[0])).toBe(false);
    expect(headerEditIsLossless((githubHeaders as NostrEvent[])[0])).toBe(false);
  });

  it("is false for a kind 9998 header, which saving would turn into a new 39998", () => {
    const nipExample3 = (nipExamples as NostrEvent[]).find((e) => e.kind === 9998)!;
    expect(headerEditIsLossless(nipExample3)).toBe(false);
  });

  it("is false for something that is not a list header", () => {
    expect(headerEditIsLossless(coffeeItem())).toBe(false);
  });

  it("is false when the header has content the form would blank", () => {
    expect(headerEditIsLossless({ ...coffeeHeader, content: "notes" })).toBe(false);
  });

  it("is false when the form would trim a value", () => {
    const untrimmed = {
      ...coffeeHeader,
      tags: coffeeHeader.tags.map((t) => (t[0] === "names" ? ["names", "Coffee Shop ", "Coffee Shops"] : t)),
    };
    expect(headerEditIsLossless(untrimmed)).toBe(false);
  });

  it("does not care about tag order or created_at", () => {
    const reordered = {
      ...coffeeHeader,
      created_at: coffeeHeader.created_at - 5000,
      tags: [...coffeeHeader.tags].reverse(),
    };
    expect(headerEditIsLossless(reordered)).toBe(true);
  });
});

describe("itemEditIsLossless", () => {
  it("is false for a tag item whose data sits in content JSON (and carries `client`)", () => {
    const classics = (tagItems as NostrEvent[]).find(
      (e) => e.id === "4d4ada496a2b3710d44d9390adbe3e9612a941e271ff3638b13c338faab569a3"
    )!;
    expect(classics.content).not.toBe("");
    expect(itemEditIsLossless(classics, tagHeader)).toBe(false);
  });

  it("is false for an item with two `z`, because the form keeps only the first", () => {
    const twoZ = coffeeItem();
    twoZ.tags.push(["z", `39998:${AUTHOR}:tea-houses`]);
    expect(itemEditIsLossless(twoZ, coffeeHeader)).toBe(false);
  });

  it("is true for an item Curate's own builder made under the Coffee Shops header", () => {
    expect(itemEditIsLossless(coffeeItem(), coffeeHeader)).toBe(true);
  });

  it("is true when the schema covers every tag, wherever the form puts it", () => {
    const header = signed(
      buildListHeaderEvent({
        namePlural: "Coffee Shops",
        nameSingular: "Coffee Shop",
        schema: [
          { name: "name", type: "text", presence: "required" },
          { name: "roaster", type: "text", presence: "allowed" },
        ],
      }),
      "c4".repeat(32)
    );
    const item = coffeeItem({ fields: { roaster: "Onyx" }, description: "Third wave" });
    expect(itemEditIsLossless(item, header)).toBe(true);
  });

  it("is false when the item has a tag the header never declared", () => {
    expect(itemEditIsLossless(coffeeItem({ fields: { wifi: "yes" } }), coffeeHeader)).toBe(false);
  });

  it("is false when the item carries tags the form has no field for", () => {
    expect(itemEditIsLossless(coffeeItem({ title: "A title" }), coffeeHeader)).toBe(false);
    expect(itemEditIsLossless(coffeeItem({ topics: ["espresso"] }), coffeeHeader)).toBe(false);
    expect(itemEditIsLossless(coffeeItem({ pubkeys: ["cd".repeat(32)] }), coffeeHeader)).toBe(false);
    expect(itemEditIsLossless(coffeeItem({ comments: "Closed Sundays" }), coffeeHeader)).toBe(false);
  });

  it("is false for the Food items, which carry phone, hours, geohashes and repeated tags", () => {
    for (const item of foodItems as NostrEvent[]) {
      expect(itemEditIsLossless(item, (foodHeaders as NostrEvent[])[0])).toBe(false);
    }
  });

  it("is false for a kind 9999 item, which saving would turn into a new 39999", () => {
    for (const item of v4vItems as NostrEvent[]) {
      expect(item.kind).toBe(9999);
      expect(itemEditIsLossless(item, (v4vHeaders as NostrEvent[])[0])).toBe(false);
    }
  });

  it("is false when the NIP's `t` value sits where the form has no field for it", () => {
    const [, , dogsHeader, dogItem] = nipExamples as NostrEvent[];
    expect(itemEditIsLossless(dogItem, dogsHeader)).toBe(false);
  });

  it("is true for a GitHub account item, whose tags the header's schema all covers", () => {
    for (const item of githubItems as NostrEvent[]) {
      expect(itemEditIsLossless(item, (githubHeaders as NostrEvent[])[0])).toBe(true);
    }
  });

  it("is false for something that is not a list item, or a header that is not one", () => {
    expect(itemEditIsLossless(coffeeHeader, coffeeHeader)).toBe(false);
    expect(itemEditIsLossless(coffeeItem(), coffeeItem())).toBe(false);
  });

  it("is false when the item has content the form would blank", () => {
    expect(itemEditIsLossless({ ...coffeeItem(), content: "{}" }, coffeeHeader)).toBe(false);
  });
});
