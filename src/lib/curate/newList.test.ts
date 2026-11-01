/** The quick list form's grammar: the draft and header it makes, the concept it may match, and what stops it. */
import { describe, expect, it } from "vitest";
import type { HeaderEvent } from "@/lib/conceptResolution";
import { checkHeader } from "@/lib/listCheck";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import {
  QUICK_FIELD_TYPES,
  createProblems,
  draftOfQuickList,
  freeShortName,
  newListTemplate,
  ownShortNames,
  sameConcept,
  shortNameProblems,
  type QuickList,
} from "./newList";

const AUTHOR = "a".repeat(64);
const OTHER = "b".repeat(64);
const CAFES = "cafes";

const cafes: QuickList = {
  singular: "Café",
  plural: "Cafés",
  description: "Places for a coffee",
  fields: [
    { name: "name", type: "text", requirement: "required", description: "What it is called" },
    { name: "website", type: "url", requirement: "recommended", description: "" },
    { name: "phone", type: "tel", requirement: "optional", description: "Ring ahead" },
    { name: "email", type: "email", requirement: "optional", description: "" },
    { name: "series", type: "address", requirement: "optional", description: "" },
  ],
};

let seen = 0;
/** A kind 39998 header with these tags, by `author`. */
function header(author: string, tags: string[][], createdAt = 1_790_000_000): HeaderEvent {
  seen += 1;
  return { id: seen.toString(16).padStart(64, "0"), pubkey: author, kind: 39998, created_at: createdAt, tags };
}

describe("QUICK_FIELD_TYPES", () => {
  it("names the five types in plain words, text first", () => {
    expect(QUICK_FIELD_TYPES).toEqual([
      { value: "text", label: "Text" },
      { value: "url", label: "Link" },
      { value: "tel", label: "Phone" },
      { value: "email", label: "Email" },
      { value: "address", label: "Address" },
    ]);
  });
});

describe("draftOfQuickList", () => {
  it("carries the names and description, and turns every field on as the person's own", () => {
    const draft = draftOfQuickList(cafes);

    expect(draft.singular).toBe("Café");
    expect(draft.plural).toBe("Cafés");
    expect(draft.description).toBe("Places for a coffee");
    expect(draft.fields).toEqual(
      cafes.fields.map((f) => ({
        name: f.name,
        enabled: true,
        requirement: f.requirement,
        origin: "custom",
        type: f.type,
        description: f.description,
      })),
    );
  });
});

describe("newListTemplate", () => {
  const template = newListTemplate(cafes, CAFES, AUTHOR);

  it("is a kind 39998 at the short name that points at itself", () => {
    expect(template.kind).toBe(39998);
    expect(template.tags[0]).toEqual(["d", CAFES]);
    expect(template.tags).toContainEqual(["b", `39998:${AUTHOR}:${CAFES}`, "pointer"]);
  });

  it("says its names, description and each field with its requirement and words", () => {
    expect(template.tags).toContainEqual(["names", "Café", "Cafés"]);
    expect(template.tags).toContainEqual(["description", "Places for a coffee"]);
    expect(template.tags).toContainEqual(["required", "name", "What it is called"]);
    expect(template.tags).toContainEqual(["recommended", "website"]);
    expect(template.tags).toContainEqual(["optional", "phone", "Ring ahead"]);
  });

  it("types every field that isn't text, and none that is", () => {
    const typed = template.tags.filter((t) => t[0] === "field-type");

    expect(typed).toEqual([
      ["field-type", "website", "url"],
      ["field-type", "phone", "tel"],
      ["field-type", "email", "email"],
      ["field-type", "series", "address"],
    ]);
  });

  it("has nothing Brainstorm's check would stop", () => {
    const check = checkHeader(template.tags);

    expect(check.problems.filter((p) => p.blocking)).toEqual([]);
  });
});

describe("sameConcept", () => {
  it("matches Cafés to a header named cafes, whatever the case or accents", () => {
    const named = header(OTHER, [["d", "cafes"], ["names", "cafe", "cafes"]]);

    const groups = sameConcept([named], { singular: "Café", plural: "Cafés" });

    expect(groups.map((g) => g.rootHeader)).toEqual([named]);
  });

  it("matches on either name: a plural typed as the other list's singular", () => {
    const named = header(OTHER, [["d", "tag"], ["names", "tag", "tags"]]);

    expect(sameConcept([named], { singular: "Label", plural: "Tag" })).toHaveLength(1);
    expect(sameConcept([named], { singular: "Tags", plural: "Label" })).toHaveLength(1);
  });

  it("finds the real Tags concept in the headers people have published", () => {
    const groups = sameConcept(tagsHeaders as HeaderEvent[], { singular: "tag", plural: "tags" });

    expect(groups).toHaveLength(1);
    expect(groups[0].root).toBe("39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:tag");
  });

  it("matches nothing for a name no list has, or for no name at all", () => {
    const named = header(OTHER, [["d", "cafes"], ["names", "cafe", "cafes"]]);

    expect(sameConcept([named], { singular: "Bar", plural: "Bars" })).toEqual([]);
    expect(sameConcept([named], { singular: "", plural: "" })).toEqual([]);
    expect(sameConcept([named], { singular: "!!", plural: "  " })).toEqual([]);
  });

  it("leaves out a header that has withdrawn from every concept", () => {
    const withdrawn = header(OTHER, [["d", "cafes"], ["names", "cafe", "cafes"], ["b", "b-tag-deferred"]]);

    expect(sameConcept([withdrawn], { singular: "Café", plural: "Cafés" })).toEqual([]);
  });
});

describe("freeShortName", () => {
  it("is the base when it is free", () => {
    expect(freeShortName("tags", new Set())).toBe("tags");
    expect(freeShortName("tags", new Set(["tag"]))).toBe("tags");
  });

  it("counts up from 2 until a name is free", () => {
    expect(freeShortName("tags", new Set(["tags"]))).toBe("tags-2");
    expect(freeShortName("tags", new Set(["tags", "tags-2"]))).toBe("tags-3");
    expect(freeShortName("tags", new Set(["tags", "tags-2", "tags-3", "tags-5"]))).toBe("tags-4");
  });

  it("stays empty when there is no base to count from", () => {
    expect(freeShortName("", new Set(["-2"]))).toBe("");
  });
});

describe("ownShortNames", () => {
  it("is the short name of every list the author has, and nobody else's", () => {
    const mine = header(AUTHOR, [["d", "tags"], ["names", "tag", "tags"]]);
    const mineToo = header(AUTHOR, [["d", "books"], ["names", "book", "books"]]);
    const theirs = header(OTHER, [["d", "cafes"], ["names", "cafe", "cafes"]]);

    expect(ownShortNames([mine, mineToo, theirs], AUTHOR)).toEqual(new Set(["tags", "books"]));
    expect(ownShortNames([mine, theirs], null)).toEqual(new Set());
  });

  it("leaves out a list the author has since blanked", () => {
    const first = header(AUTHOR, [["d", "tags"], ["names", "tag", "tags"]], 1_790_000_000);
    const blanked = header(AUTHOR, [["d", "tags"]], 1_790_000_100);

    expect(ownShortNames([first, blanked], AUTHOR)).toEqual(new Set());
  });
});

describe("shortNameProblems", () => {
  it("asks for a short name, and refuses one the author already has", () => {
    expect(shortNameProblems("", new Set())).toEqual(["Give the list an identifier (its d tag)."]);
    expect(shortNameProblems("tags", new Set(["tags"]))).toEqual([
      'You already have a list with the short name "tags". Publishing would replace it.',
    ]);
    expect(shortNameProblems("tags-2", new Set(["tags"]))).toEqual([]);
  });
});

describe("createProblems", () => {
  const taken = new Set<string>();

  it("has none for a list that can go", () => {
    expect(createProblems(cafes, CAFES, taken)).toEqual([]);
  });

  it("refuses a field name with a space", () => {
    const q = { ...cafes, fields: [{ ...cafes.fields[0], name: "opening hours" }] };

    const problems = createProblems(q, CAFES, taken);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("opening hours");
  });

  it("refuses a field named twice", () => {
    const q = { ...cafes, fields: [cafes.fields[0], { ...cafes.fields[1], name: "name" }] };

    const problems = createProblems(q, CAFES, taken);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("name");
  });

  it.each(["d", "z", "b"])("refuses a field named %s, which the list itself uses", (reserved) => {
    const q = { ...cafes, fields: [{ ...cafes.fields[0], name: reserved }] };

    const problems = createProblems(q, CAFES, taken);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`Not a field name: ${reserved}`);
  });

  it("asks for both names, and for a name on every field", () => {
    const q: QuickList = {
      singular: "",
      plural: "Cafés",
      description: "",
      fields: [{ ...cafes.fields[0], name: " " }],
    };

    expect(createProblems(q, CAFES, taken)).toEqual([
      "Give the concept a singular and a plural name.",
      "Every field needs a name.",
    ]);
  });

  it("asks for a field when the list has none, since no item could be added to it", () => {
    expect(createProblems({ ...cafes, fields: [] }, CAFES, taken)).toEqual(["Add at least one field."]);
  });

  it("refuses an empty short name, and one the author already has", () => {
    expect(createProblems(cafes, "", taken)).toEqual(["Give the list an identifier (its d tag)."]);
    expect(createProblems(cafes, CAFES, new Set([CAFES]))).toEqual([
      'You already have a list with the short name "cafes". Publishing would replace it.',
    ]);
  });
});
