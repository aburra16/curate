import { describe, expect, it } from "vitest";
import { exactCopyTemplate } from "@/lib/conceptCopy";
import { B_DEFERRED, definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { checkHeader } from "@/lib/listCheck";
import { groupConcepts, isWithdrawn } from "@/services/concepts";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import {
  listActionsFor,
  listEditDraft,
  listEditProblems,
  listEditTemplate,
  versionShortName,
  type ListEdit,
} from "./listActions";

const CURATOR = "b".repeat(64);
const READER = "c".repeat(64);
const OTHER = "d".repeat(64);
const ROOT_COORDINATE = `39998:${CURATOR}:places`;

let n = 0;
/** A header of `author`'s at the short name "places". */
const header = (author: string, tags: string[][] = [], over: Partial<HeaderEvent> = {}): HeaderEvent => ({
  id: (++n).toString(16).padStart(64, "0"),
  pubkey: author,
  kind: 39998,
  created_at: 1_790_000_000 + n,
  tags: [["d", "places"], ["names", "place", "places"], ["required", "name"], ...tags],
  ...over,
});
const point = ["b", ROOT_COORDINATE, "pointer"];

const root = header(CURATOR, [point]);
const readersCopy = header(READER, [point]);
const othersCopy = header(OTHER, [point]);
const readersWithdrawn = header(READER, [["b", B_DEFERRED]]);

/** The concept the headers make, as the page groups them. */
const groupOf = (...headers: HeaderEvent[]) => groupConcepts(headers).groups[0];

describe("listActionsFor", () => {
  it("offers nothing to a reader who is signed out", () => {
    const group = groupOf(root, readersCopy);

    expect(listActionsFor(null, group, root)).toEqual({ edit: null, withdraw: null });
    expect(listActionsFor(null, group, readersCopy)).toEqual({ edit: null, withdraw: null });
  });

  it("offers Edit on the header the reader wrote when it is the community header, and no withdrawing", () => {
    const group = groupOf(root, othersCopy);

    expect(listActionsFor(CURATOR, group, root)).toEqual({ edit: { kind: "edit", header: root }, withdraw: null });
  });

  it("offers Edit on the reader's own copy when it is the one shown, and withdrawing it", () => {
    const group = groupOf(root, readersCopy, othersCopy);

    expect(listActionsFor(READER, group, readersCopy)).toEqual({
      edit: { kind: "edit", header: readersCopy },
      withdraw: readersCopy,
    });
  });

  it("offers a version of their own on another's header when the reader has none", () => {
    const group = groupOf(root, othersCopy);

    expect(listActionsFor(READER, group, root)).toEqual({ edit: { kind: "make-mine", community: root }, withdraw: null });
    expect(listActionsFor(READER, group, othersCopy)).toEqual({
      edit: { kind: "make-mine", community: root },
      withdraw: null,
    });
  });

  it("offers the reader's own copy to change, and withdraw, while another's version is shown", () => {
    const group = groupOf(root, readersCopy, othersCopy);

    const expected = { edit: { kind: "edit-mine", copy: readersCopy }, withdraw: readersCopy };
    expect(listActionsFor(READER, group, root)).toEqual(expected);
    expect(listActionsFor(READER, group, othersCopy)).toEqual(expected);
  });

  it("offers the reader's own copy to change even when the community header was not found", () => {
    const group = groupOf(readersCopy, othersCopy);

    expect(group.rootHeader).toBeNull();
    expect(listActionsFor(READER, group, othersCopy)).toEqual({
      edit: { kind: "edit-mine", copy: readersCopy },
      withdraw: readersCopy,
    });
  });

  it("offers nothing to make a version of when the community header was not found", () => {
    const group = groupOf(othersCopy);

    expect(listActionsFor(READER, group, othersCopy)).toEqual({ edit: null, withdraw: null });
  });

  it("offers Edit on the community header to the reader who wrote it, whichever version is shown", () => {
    const group = groupOf(root, othersCopy);

    // Making a version of their own list would publish over it.
    expect(listActionsFor(CURATOR, group, othersCopy)).toEqual({ edit: { kind: "edit", header: root }, withdraw: null });
  });

  it("never offers withdrawing the community header", () => {
    const group = groupOf(root, othersCopy);
    // A copy that is the community header itself, as no grouping makes one.
    const circular = { ...group, copies: [root, othersCopy] };

    expect(listActionsFor(CURATOR, group, root).withdraw).toBeNull();
    expect(listActionsFor(CURATOR, group, othersCopy).withdraw).toBeNull();
    expect(listActionsFor(CURATOR, circular, othersCopy).withdraw).toBeNull();
  });

  describe("a withdrawn header", () => {
    it("is never edited or withdrawn, and the reader who withdrew may make a version again", () => {
      const group = groupOf(root, othersCopy, readersWithdrawn);

      expect(group.withdrawn).toEqual([readersWithdrawn]);
      expect(listActionsFor(READER, group, readersWithdrawn)).toEqual({
        edit: { kind: "make-mine", community: root },
        withdraw: null,
      });
    });

    it("offers a version of the community header to a reader who looks at another's withdrawn one", () => {
      const withdrawnByOther = header(OTHER, [["b", B_DEFERRED]]);
      const group = groupOf(root, withdrawnByOther);

      expect(listActionsFor(READER, group, withdrawnByOther)).toEqual({
        edit: { kind: "make-mine", community: root },
        withdraw: null,
      });
    });

    it("offers nothing on the reader's own withdrawn header when there is no community header to copy", () => {
      const group = groupOf(readersWithdrawn);

      expect(group.rootHeader).toBe(readersWithdrawn);
      expect(listActionsFor(READER, group, readersWithdrawn)).toEqual({ edit: null, withdraw: null });
    });

    it("is read as grouping reads it: the mark with a pointer beside it is a version, edited and withdrawn like any", () => {
      const both = header(READER, [point, ["b", B_DEFERRED]]);
      const group = groupOf(root, both);

      expect(isWithdrawn(both)).toBe(false);
      expect(group.copies).toEqual([both]);
      expect(listActionsFor(READER, group, both)).toEqual({ edit: { kind: "edit", header: both }, withdraw: both });
      expect(listActionsFor(READER, group, root)).toEqual({ edit: { kind: "edit-mine", copy: both }, withdraw: both });
    });

    it("does not offer withdrawing a copy that is withdrawn already, however the group came to hold it", () => {
      const group = groupOf(root, othersCopy);
      const held = { ...group, copies: [readersWithdrawn, othersCopy] };

      expect(listActionsFor(READER, held, othersCopy).withdraw).toBeNull();
    });

    it("does not offer making a version when the community header has withdrawn itself", () => {
      const withdrawnRoot = header(CURATOR, [["b", B_DEFERRED]]);
      const group = groupOf(withdrawnRoot, othersCopy);

      expect(group.rootHeader).toBeNull();
      expect(listActionsFor(READER, group, othersCopy)).toEqual({ edit: null, withdraw: null });
    });
  });

  describe("a header that republishing would not replace", () => {
    it("is not edited: a short header (kind 9998) has no address to publish over", () => {
      const short = header(READER, [], { kind: 9998 });
      const group = groupOf(short);

      expect(listActionsFor(READER, group, short)).toEqual({ edit: null, withdraw: null });
    });

    it("is not copied when it has no short name to copy to", () => {
      const nameless: HeaderEvent = { ...root, tags: root.tags.filter((t) => t[0] !== "d") };

      expect(
        listActionsFor(READER, { root: ROOT_COORDINATE, rootHeader: nameless, kind: "canonical", copies: [], withdrawn: [] }, nameless),
      ).toEqual({ edit: null, withdraw: null });
    });
  });
});

describe("what a change publishes", () => {
  const tagsOf = (h: { tags: string[][] }) => h.tags.map((t) => JSON.stringify(t)).sort();

  it("a community header saved untouched keeps every tag it had", () => {
    const edit: ListEdit = { kind: "edit", header: foodHeader[0] as HeaderEvent };

    const template = listEditTemplate(edit, CURATOR, listEditDraft(edit));

    expect(template.kind).toBe(39998);
    expect(tagsOf(template)).toEqual(tagsOf({ tags: foodHeader[0].tags.filter((t) => t[0] !== "client") }));
  });

  it("the reader's own copy saved untouched keeps every tag it had, whichever version was shown", () => {
    const copy = foodCopies[0] as HeaderEvent;
    const edit: ListEdit = { kind: "edit-mine", copy };

    const template = listEditTemplate(edit, copy.pubkey, listEditDraft(edit));

    expect(tagsOf(template)).toEqual(tagsOf({ tags: copy.tags.filter((t) => t[0] !== "client") }));
  });

  it("a version made untouched is the exact copy of the community header, under the reader's name", () => {
    const community = foodHeader[0] as HeaderEvent;
    const edit: ListEdit = { kind: "make-mine", community };

    const template = listEditTemplate(edit, READER, listEditDraft(edit));

    expect(template.kind).toBe(39998);
    expect(template.content).toBe("");
    expect(template.tags).toEqual(exactCopyTemplate(definitionOf(community)).tags);
    expect(template.tags[0]).toEqual(["d", "food-and-drink-places"]);
    expect(checkHeader(template.tags).problems.filter((p) => p.blocking)).toEqual([]);
  });

  it("a version made keeps the tags an exact copy takes that the form does not speak", () => {
    const community = header(CURATOR, [point, ["name", "place"], ["slug", "places"], ["license", "ODbL-1.0"]]);
    const edit: ListEdit = { kind: "make-mine", community };

    const template = listEditTemplate(edit, READER, listEditDraft(edit));

    expect(template.tags).toContainEqual(["name", "place"]);
    expect(template.tags).toContainEqual(["slug", "places"]);
    expect(template.tags).not.toContainEqual(["license", "ODbL-1.0"]);
    expect(template.tags).toContainEqual(["b", ROOT_COORDINATE, "pointer"]);
  });

  it("a version made from a changed draft carries the change", () => {
    const edit: ListEdit = { kind: "make-mine", community: root };
    const draft = { ...listEditDraft(edit), plural: "Spots" };

    const template = listEditTemplate(edit, READER, draft);

    expect(template.tags).toContainEqual(["names", "place", "Spots"]);
    expect(template.tags).toContainEqual(["b", ROOT_COORDINATE, "pointer"]);
  });

  it("a version made at another short name changes only the short name", () => {
    const edit: ListEdit = { kind: "make-mine", community: foodHeader[0] as HeaderEvent };

    const template = listEditTemplate(edit, READER, listEditDraft(edit), "food-and-drink-places-2");

    const exact = exactCopyTemplate(definitionOf(foodHeader[0] as HeaderEvent)).tags;
    expect(template.tags).toEqual(exact.map((t) => (t[0] === "d" ? ["d", "food-and-drink-places-2"] : t)));
    expect(template.tags.filter((t) => t[0] === "b")).toEqual([
      ["b", definitionOf(foodHeader[0] as HeaderEvent).coordinate, "pointer"],
    ]);
  });

  it("a copy of the community header made by the reader points back at it and nowhere else", () => {
    const edit: ListEdit = { kind: "make-mine", community: root };

    const template = listEditTemplate(edit, READER, listEditDraft(edit));

    expect(template.tags.filter((t) => t[0] === "b")).toEqual([point]);
  });
});

describe("what stops a change", () => {
  const blocking = (edit: ListEdit, reader: string, draft = listEditDraft(edit)) =>
    listEditProblems(edit, reader, draft)
      .filter((p) => p.blocking)
      .map((p) => p.message);

  it.each<[string, ListEdit, string]>([
    ["a community header", { kind: "edit", header: foodHeader[0] as HeaderEvent }, CURATOR],
    ["a copy of the reader's", { kind: "edit-mine", copy: foodCopies[2] as HeaderEvent }, READER],
    ["a version to make", { kind: "make-mine", community: foodHeader[0] as HeaderEvent }, READER],
  ])("finds nothing wrong with %s as it stands", (_name, edit, reader) => {
    expect(blocking(edit, reader)).toEqual([]);
  });

  it("stops a list left without its names, which the header check alone reads as another name", () => {
    const edit: ListEdit = { kind: "edit", header: root };

    expect(blocking(edit, CURATOR, { ...listEditDraft(edit), plural: "" })).toEqual([
      "Give the concept a singular and a plural name.",
    ]);
  });

  it("stops a field with a name no item could use", () => {
    const edit: ListEdit = { kind: "edit", header: root };
    const draft = listEditDraft(edit);
    draft.fields[0] = { ...draft.fields[0], name: "full name" };

    expect(blocking(edit, CURATOR, draft)).toEqual(["Not a field name: full name (no spaces; d, z and b are taken)."]);
  });

  it("says each problem once, and keeps what the header check adds", () => {
    const edit: ListEdit = { kind: "edit", header: root };
    const draft = { ...listEditDraft(edit), singular: "", plural: "" };

    const found = listEditProblems(edit, CURATOR, draft);

    expect(found.filter((p) => p.message === "Give the concept a singular and a plural name.")).toHaveLength(1);
    expect(found.every((p) => p.field === null)).toBe(true);
  });
});

describe("the short name of a version made", () => {
  /** A header of `author`'s at "places" that points nowhere, or wherever `tags` say. */
  const listOf = (author: string, tags: string[][] = [], over: Partial<HeaderEvent> = {}) =>
    header(author, tags, over);

  it("is the community header's own when the reader has no list by that name", () => {
    expect(versionShortName(root, READER, [])).toBe("places");
    expect(versionShortName(root, READER, [listOf(READER, [], { tags: [["d", "dogs"], ["names", "dog", "dogs"]] })])).toBe(
      "places",
    );
  });

  it("is not a name another person's list has: only the reader's lists are replaced", () => {
    expect(versionShortName(root, READER, [listOf(OTHER)])).toBe("places");
  });

  it("is the first free `-2`, `-3`, … when a list of the reader's, that is not a version of this concept, has the name", () => {
    const standalone = listOf(READER);
    const taken2 = listOf(READER, [], { tags: [["d", "places-2"], ["names", "place", "places"]] });
    const selfPointing = listOf(READER, [["b", `39998:${READER}:places`, "pointer"]]);
    const versionOfAnother = listOf(READER, [["b", `39998:${OTHER}:places`, "pointer"]]);

    expect(versionShortName(root, READER, [standalone])).toBe("places-2");
    expect(versionShortName(root, READER, [selfPointing])).toBe("places-2");
    expect(versionShortName(root, READER, [versionOfAnother])).toBe("places-2");
    expect(versionShortName(root, READER, [standalone, taken2])).toBe("places-3");
  });

  it("replaces a header of the reader's that is withdrawn, or already a version of this concept, in place", () => {
    expect(versionShortName(root, READER, [readersWithdrawn])).toBe("places");
    expect(versionShortName(root, READER, [readersCopy])).toBe("places");
  });

  it("counts the newest header at the name: a withdrawal made since frees it, and a list made since takes it", () => {
    const before = listOf(READER, [], { created_at: 1_790_000_000 });
    const withdrawnSince = listOf(READER, [["b", B_DEFERRED]], { created_at: 1_790_000_100 });
    const standaloneSince = listOf(READER, [], { created_at: 1_790_000_200 });

    expect(versionShortName(root, READER, [before, withdrawnSince])).toBe("places");
    expect(versionShortName(root, READER, [before, withdrawnSince, standaloneSince])).toBe("places-2");
  });

  it("ignores a list the reader has blanked", () => {
    const blanked = listOf(READER, [["deleted", "true"]], { tags: [["d", "places"], ["deleted", "true"]] });

    expect(versionShortName(root, READER, [blanked])).toBe("places");
  });
});
