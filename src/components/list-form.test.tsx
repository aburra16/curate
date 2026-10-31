// @vitest-environment jsdom
/**
 * The list form: a list's names and fields in the person's words, with the
 * types it offers, the display hints, links and image it keeps unseen, and
 * what it hands on when saved.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CopyDraft } from "@/lib/conceptCopy";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import type { Problem } from "@/lib/listCheck";
import { listDraftOf } from "@/lib/listDraft";
import { ListForm } from "./list-form";

const CURATOR = "b".repeat(64);
const TEMPLATE = "a".repeat(64);

/** A list with a typed field the form doesn't offer, a title, a link, a fact and a picture of its own. */
const PLACES: HeaderEvent = {
  id: "1".repeat(64),
  pubkey: CURATOR,
  kind: 39998,
  created_at: 1_790_000_000,
  tags: [
    ["d", "places"],
    ["names", "place", "places"],
    ["description", "Where to go"],
    ["required", "name", "What it is called"],
    ["recommended", "website"],
    ["optional", "opened"],
    ["optional", "handle"],
    ["field-type", "website", "url"],
    ["field-type", "opened", "date"],
    ["display", "title", "name"],
    ["display", "link", "website"],
    ["display", "fact", "opened", "Opened"],
    ["link", TEMPLATE, "", "user", "handle"],
    ["image", "https://example.test/places.png"],
  ],
};

const initial = listDraftOf(definitionOf(PLACES));

const onSave = vi.fn();
const onChange = vi.fn();
const onCancel = vi.fn();
const onDone = vi.fn();

function open(props: Partial<Parameters<typeof ListForm>[0]> = {}) {
  return render(<ListForm draft={initial} onSave={onSave} busy={false} problems={[]} {...props} />);
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const choose = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const publish = () => screen.getByRole("button", { name: /^Publish|Publishing/ }) as HTMLButtonElement;
const saved = (): CopyDraft => onSave.mock.calls[0][0];

const problem = (message: string, blocking: boolean): Problem => ({ code: "unpublishable", field: null, message, blocking });

beforeEach(() => {
  onSave.mockReset();
  onChange.mockReset();
  onCancel.mockReset();
  onDone.mockReset();
});

describe("the list form", () => {
  it("starts from the draft: names, description and one row for each field", () => {
    open();

    expect(field("Singular name").value).toBe("place");
    expect(field("Plural name").value).toBe("places");
    expect(field("Description").value).toBe("Where to go");
    expect(["name", "website", "opened", "handle"].map((_, i) => field(`Field ${i + 1} name`).value)).toEqual([
      "name",
      "website",
      "opened",
      "handle",
    ]);
    expect(field("Field 1 requirement").value).toBe("required");
    expect(field("Field 2 requirement").value).toBe("recommended");
    expect(field("Field 3 requirement").value).toBe("optional");
    expect(field("Field 1 description").value).toBe("What it is called");
    expect(field("Field 2 description").value).toBe("");
  });

  it("saves the draft it was given, untouched", () => {
    open();

    fireEvent.click(publish());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual(initial);
  });

  it("offers the five types, in the person's words, and a field's own type when it is not one of them", () => {
    open();

    const options = (label: string) => within(field(label)).getAllByRole("option").map((o) => [o.getAttribute("value"), o.textContent]);
    const five = [
      ["text", "Text"],
      ["url", "Link"],
      ["tel", "Phone"],
      ["email", "Email"],
      ["address", "Address"],
    ];
    expect(options("Field 1 type")).toEqual(five);
    expect(options("Field 2 type")).toEqual(five);
    // `date` is the third field's own: the menu keeps it.
    expect(options("Field 3 type")).toEqual([...five, ["date", "date"]]);
    expect(field("Field 3 type").value).toBe("date");
    expect(field("Field 2 type").value).toBe("url");
  });

  it("keeps a type that is not among the five when the person saves, and when they change another field", () => {
    open();

    choose("Field 1 type", "email");
    fireEvent.click(publish());

    expect(saved().fields.map((f) => [f.name, f.type])).toEqual([
      ["name", "email"],
      ["website", "url"],
      ["opened", "date"],
      ["handle", "text"],
    ]);
  });

  it("changes the names, a field's name, requirement and words, and hands the draft on as it changes", () => {
    open({ onChange });

    type("Plural name", "spots");
    type("Field 4 name", "account");
    choose("Field 4 requirement", "required");
    type("Field 4 description", "Their handle");

    expect(onChange).toHaveBeenCalledTimes(4);
    fireEvent.click(publish());
    expect(saved().plural).toBe("spots");
    expect(saved().fields[3]).toMatchObject({ name: "account", requirement: "required", description: "Their handle" });
  });

  it("adds a field and removes one", () => {
    open();

    fireEvent.click(screen.getByRole("button", { name: "Add a field" }));
    type("Field 5 name", "hours");
    fireEvent.click(screen.getByRole("button", { name: "Remove field 2" }));
    fireEvent.click(publish());

    expect(saved().fields.map((f) => f.name)).toEqual(["name", "opened", "handle", "hours"]);
    expect(saved().fields[3]).toMatchObject({ enabled: true, requirement: "optional", type: "text" });
  });

  describe("what the form does not show", () => {
    it("keeps the display hints, the links and the list's image as they were", () => {
      open();

      type("Plural name", "spots");
      type("Description", "Somewhere new");
      fireEvent.click(publish());

      expect(saved().display).toEqual(initial.display);
      expect(saved().links).toEqual(initial.links);
      expect(saved().display.listImage).toBe("https://example.test/places.png");
      expect(saved().templates).toEqual(initial.templates);
      expect(screen.queryByText("https://example.test/places.png")).toBeNull();
    });

    it("follows a field that is renamed: what points at it points at its new name", () => {
      open();

      type("Field 1 name", "title");
      type("Field 2 name", "site");
      type("Field 3 name", "founded");
      type("Field 4 name", "account");
      fireEvent.click(publish());

      expect(saved().display).toMatchObject({ title: "title", link: "site", facts: [{ field: "founded", label: "Opened" }] });
      expect(saved().links[0].bindings).toEqual([["user", "account"]]);
    });

    it("follows a rename typed through an empty name, and back", () => {
      open();

      type("Field 1 name", "");
      type("Field 1 name", "t");
      type("Field 1 name", "title");
      fireEvent.click(publish());
      expect(saved().display.title).toBe("title");

      onSave.mockReset();
      type("Field 1 name", "name");
      fireEvent.click(publish());
      expect(saved().display.title).toBe("name");
    });

    it("leaves what points at a field alone while its name is empty, and when it is removed", () => {
      open();

      type("Field 1 name", "");
      fireEvent.click(publish());
      expect(saved().display.title).toBe("name");

      onSave.mockReset();
      fireEvent.click(screen.getByRole("button", { name: "Remove field 4" }));
      fireEvent.click(publish());
      expect(saved().links[0].bindings).toEqual([["user", "handle"]]);
    });

    it("lets two fields swap names, each keeping what points at it", () => {
      open();

      type("Field 1 name", "website");
      type("Field 2 name", "name");
      fireEvent.click(publish());

      // The title followed the field it named; so did the link.
      expect(saved().display).toMatchObject({ title: "website", link: "name" });
    });
  });

  describe("publishing", () => {
    it("waits while a write is in flight", () => {
      open({ busy: true, onCancel });

      expect(publish().disabled).toBe(true);
      expect(publish().textContent).toBe("Publishing…");
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("waits while anything would stop the list, and says what", () => {
      open({ problems: [problem("Give the concept a singular and a plural name.", true), problem("Something else.", false)] });

      expect(publish().disabled).toBe(true);
      expect(screen.getByText("Give the concept a singular and a plural name.").hasAttribute("data-blocking")).toBe(true);
      expect(screen.getByText("Something else.").hasAttribute("data-blocking")).toBe(false);
    });

    it("waits while something it needs has not arrived", () => {
      open({ holding: true });

      expect(publish().disabled).toBe(true);
      expect(publish().textContent).toBe("Publish");
      fireEvent.submit(publish().closest("form")!);
      expect(onSave).not.toHaveBeenCalled();
    });

    it("goes ahead when what the checks found would not stop it", () => {
      open({ problems: [problem("Something else.", false)] });

      expect(publish().disabled).toBe(false);
      fireEvent.click(publish());
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("does not send a second write while one is in flight", () => {
      open({ busy: true });

      fireEvent.submit(publish().closest("form")!);

      expect(onSave).not.toHaveBeenCalled();
    });

    it("does not send the list while a problem would stop it, even when the form is submitted another way", () => {
      open({ problems: [problem("Every field needs a name.", true)] });

      fireEvent.submit(publish().closest("form")!);

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe("around the fields", () => {
    it("has a heading that names the form, and a Cancel", () => {
      open({ heading: "Edit list", onCancel });

      expect(screen.getByRole("form", { name: "Edit list" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("shows what it is given beside the button, for how the last write went", () => {
      open({ outcome: <p>Saved to the list relay.</p> });

      expect(screen.getByText("Saved to the list relay.")).toBeTruthy();
    });

    it("has no Done until the list is saved and waiting", () => {
      open({ onCancel });

      expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    });
  });
});

describe("a list saved but waiting for the person", () => {
  beforeEach(() => {
    open({ onDone, onCancel, heading: "Edit list" });
  });

  it("locks the fields, drops Cancel and Publish, and hands on when the person says Done", () => {
    expect(field("Plural name").disabled).toBe(true);
    expect(field("Field 1 name").disabled).toBe(true);
    expect(field("Field 1 type").disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add a field" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
