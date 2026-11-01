// @vitest-environment jsdom
/**
 * The item form: one input per field the list declares, Brainstorm's checks
 * beside them, what an added item and a changed one publish, and what
 * a refusal leaves the person.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";
import { setTransport } from "@/services/transport";
import type { ItemEvent } from "@/services/concepts";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";
import { fakeTransport } from "@/test/fakeTransport";
import { ToastProvider } from "@/components/toast";

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { retryPublish, signAndPublish } from "@/services/publish";
import { ItemForm } from "./item-form";

const CURATOR = "b".repeat(64);
const READER = "c".repeat(64);

/** A list of places: two required fields, then one recommended and two optional, three of them typed. */
const PLACES: HeaderEvent = {
  id: "1".repeat(64),
  pubkey: CURATOR,
  kind: 39998,
  created_at: 1_790_000_000,
  tags: [
    ["d", "places"],
    ["names", "place", "places"],
    ["required", "name", "What it is called"],
    ["required", "category"],
    ["recommended", "website"],
    ["optional", "phone"],
    ["optional", "contact"],
    ["field-type", "website", "url"],
    ["field-type", "phone", "tel"],
    ["field-type", "contact", "email"],
  ],
};
const places = definitionOf(PLACES);

/** A list that is a 9998: named by its id, not by an address. */
const SHORT_LIST: HeaderEvent = {
  id: "9".repeat(64),
  pubkey: CURATOR,
  kind: 9998,
  created_at: 1_790_000_000,
  tags: [
    ["names", "place", "places"],
    ["required", "name"],
  ],
};

/** An item of the reader's, with a repeated tag, a field the list doesn't declare and a tag from another client. */
const ITEM: ItemEvent = {
  id: "a".repeat(64),
  pubkey: READER,
  kind: 39999,
  created_at: 1_792_000_000,
  content: "",
  tags: [
    ["d", "blue-bottle-1a2b3c4d"],
    ["z", places.coordinate],
    ["name", "Blue Bottle"],
    ["category", "cafe"],
    ["website", "https://bluebottle.example.test"],
    ["t", "coffee"],
    ["t", "espresso"],
    ["hours", "7 to 5"],
    ["alt", "place: Blue Bottle"],
    ["client", "Brainstorm"],
  ],
};

const SIGNED: NostrEvent = {
  id: "e".repeat(64),
  pubkey: READER,
  created_at: 1_792_000_100,
  kind: 39999,
  tags: [],
  content: "",
  sig: "5".repeat(128),
};
const saved: PublishResult = { event: SIGNED, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] };
const refusedByList: PublishResult = {
  event: SIGNED,
  onHub: false,
  hubMessage: "blocked: not allowed",
  accepted: [],
  failed: [{ ok: false, from: DCOSL, message: "blocked: not allowed" }],
};

/** The list relay took it; one of the author's own relays didn't. */
const missedOwnRelay: PublishResult = {
  ...saved,
  failed: [{ ok: false, from: "wss://own.example.test", message: "timed out" }],
};

function signIn(pubkey: string | null) {
  useSigner.setState(
    pubkey
      ? { pubkey, method: "extension", status: "connected", error: null }
      : { pubkey: null, method: null, status: "disconnected", error: null },
  );
}

const noTemplates = new Map();
const onSaved = vi.fn();
const onCancel = vi.fn();

const form = (props: Partial<Parameters<typeof ItemForm>[0]> = {}) => (
  <ItemForm definition={places} templates={noTemplates} onSaved={onSaved} onCancel={onCancel} {...props} />
);
const open = (props: Partial<Parameters<typeof ItemForm>[0]> = {}) => render(form(props), { wrapper: ToastProvider });

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
const publishButton = () => screen.getByRole("button", { name: /Publish|Connect to publish/ }) as HTMLButtonElement;
const sentTags = (): string[][] => vi.mocked(signAndPublish).mock.calls.at(-1)![0].tags;
const tag = (tags: string[][], name: string) => tags.find((t) => t[0] === name);
/** The part of the form that belongs to one field: its input, its words and its problems. */
const around = (label: string) => within(input(label).parentElement!);

beforeEach(() => {
  onSaved.mockReset();
  onCancel.mockReset();
  vi.mocked(signAndPublish).mockReset().mockResolvedValue(saved);
  vi.mocked(retryPublish).mockReset().mockResolvedValue(saved);
  setTransport(fakeTransport({}));
  signIn(READER);
});

describe("the fields", () => {
  it("has one input per declared field, required first, each of the type its field has", () => {
    open();

    const order = [...document.querySelectorAll("label")].map((label) => label.textContent);
    expect(order).toEqual(["name", "category", "website", "phone", "contact"]);
    expect(input("name").type).toBe("text");
    expect(input("category").type).toBe("text");
    expect(input("website").type).toBe("url");
    expect(input("phone").type).toBe("tel");
    expect(input("contact").type).toBe("email");
  });

  it("says whether a field is required, and the header's own words for it", () => {
    open();

    expect(around("name").getByText("Required · What it is called")).toBeTruthy();
    expect(around("website").getByText("Recommended")).toBeTruthy();
    expect(around("phone").getByText("Optional")).toBeTruthy();
  });

  it("names the form for what it adds", () => {
    open();
    expect(screen.getByRole("form", { name: "Add place" })).toBeTruthy();
  });
});

describe("the checks", () => {
  it("disables Publish while a required field is empty, with the problem by its input", () => {
    open();
    expect(publishButton().disabled).toBe(true);

    type("website", "https://example.test");

    expect(publishButton().disabled).toBe(true);
    expect(around("name").getByText('places require "name".')).toBeTruthy();
    expect(around("category").getByText('places require "category".')).toBeTruthy();
    expect(around("website").queryByText(/require/)).toBeNull();

    type("name", "Blue Bottle");
    expect(publishButton().disabled).toBe(true);
    expect(around("name").queryByText(/require/)).toBeNull();

    type("category", "cafe");
    expect(publishButton().disabled).toBe(false);
  });

  it("keeps quiet about a form nobody has started", () => {
    open();
    expect(screen.queryByText(/require/)).toBeNull();
  });

  it("counts a required field of only spaces as empty", () => {
    open();
    type("name", "   ");
    type("category", "cafe");

    expect(publishButton().disabled).toBe(true);
    expect(around("name").getByText('places require "name".')).toBeTruthy();
  });

  it("checks again as values change: a value that isn't a web address is said so, and doesn't stop Publish", () => {
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");

    type("website", "bluebottle");
    expect(around("website").getByText('"website" isn\'t an http(s) URL.')).toBeTruthy();
    expect(publishButton().disabled).toBe(false);

    type("website", "https://bluebottle.example.test");
    expect(around("website").queryByText(/isn't an http/)).toBeNull();
  });

  it("is not stopped by the browser's own check of a typed input", async () => {
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    type("website", "bluebottle");

    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
  });
});

describe("adding", () => {
  it("publishes an item under the definition's coordinate, its filled fields in order and a short name from its title", async () => {
    open();
    type("category", "cafe");
    type("name", "  Blue Bottle ");
    type("phone", "+1 555 0100");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    const template = vi.mocked(signAndPublish).mock.calls[0][0];
    expect(template.kind).toBe(39999);
    expect(template.content).toBe("");
    expect(template.tags).toEqual([
      ["d", expect.stringMatching(/^blue-bottle-[0-9a-f]{8}$/)],
      ["z", places.coordinate],
      ["name", "Blue Bottle"],
      ["category", "cafe"],
      ["phone", "+1 555 0100"],
      ["alt", "place: Blue Bottle"],
    ]);
  });

  it("files an item under a 9998 list by the list's id", async () => {
    open({ definition: definitionOf(SHORT_LIST) });
    type("name", "Blue Bottle");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(tag(sentTags(), "z")).toEqual(["z", SHORT_LIST.id]);
  });

  it("gives two items with the same title different short names", async () => {
    const first = open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());
    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    first.unmount();

    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());
    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(2));

    const [one, two] = vi.mocked(signAndPublish).mock.calls.map(([template]) => tag(template.tags, "d")![1]);
    expect(one).not.toBe(two);
    expect(one.replace(/-[0-9a-f]{8}$/, "")).toBe(two.replace(/-[0-9a-f]{8}$/, ""));
  });

  it("keeps the same short name for an item sent again from the same form", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());
    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(publishButton());
    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(2));

    const [one, two] = vi.mocked(signAndPublish).mock.calls.map(([template]) => tag(template.tags, "d")![1]);
    expect(one).toBe(two);
  });

  it("hands the signed event on once the list relay has it", async () => {
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("what the list relay said", () => {
  it("hands on nothing when the list relay refused, says why, and hands the event on when Retry gets it saved", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());

    expect(await screen.findByText(/Not saved to the list relay: blocked: not allowed/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
    expect(retryPublish).toHaveBeenCalledWith(refusedByList);
    expect(signAndPublish).toHaveBeenCalledTimes(1);
  });

  it("signs the form as it now stands after a refusal and a change, never the event signed before", async () => {
    vi.mocked(signAndPublish).mockResolvedValueOnce(refusedByList).mockResolvedValueOnce(saved);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());
    await screen.findByRole("button", { name: "Retry" });

    type("name", "Red Bottle");

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/Not saved to the list relay/)).toBeNull();
    fireEvent.click(publishButton());
    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(2));
    expect(tag(sentTags(), "name")).toEqual(["name", "Red Bottle"]);
    expect(retryPublish).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
  });

  it("does the same for a changed item", async () => {
    vi.mocked(signAndPublish).mockResolvedValueOnce(refusedByList).mockResolvedValueOnce(saved);
    open({ item: ITEM });
    fireEvent.click(publishButton());
    await screen.findByRole("button", { name: "Retry" });

    type("category", "bakery");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(2));
    expect(tag(sentTags(), "category")).toEqual(["category", "bakery"]);
    expect(retryPublish).not.toHaveBeenCalled();
  });

  it("hands the event on at once when one of the author's own relays missed it, and a toast says which", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(missedOwnRelay);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved to the list relay. Not saved to 1 of your own relays: own.example.test.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("does the same for a Retry that gets the list relay to take it while an own relay still misses it", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
    vi.mocked(retryPublish).mockResolvedValue(missedOwnRelay);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
    expect(screen.getByText(/Not saved to 1 of your own relays: own\.example\.test/)).toBeTruthy();
  });

  it("hands a changed item on at once too", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(missedOwnRelay);
    open({ item: ITEM });
    fireEvent.click(publishButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
    expect(screen.getByText(/Not saved to 1 of your own relays/)).toBeTruthy();
  });

  it("disables Publish and Cancel while the write is in flight", async () => {
    let settle!: (result: PublishResult) => void;
    vi.mocked(signAndPublish).mockReturnValue(new Promise((resolve) => (settle = resolve)));
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");
    fireEvent.click(publishButton());

    await waitFor(() => expect(publishButton().textContent).toBe("Publishing…"));
    expect(publishButton().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);

    settle(saved);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("signed out", () => {
  beforeEach(() => useConnectDialog.getState().hide());

  it("invites connecting: the button opens the Connect chooser, and publishes nothing", () => {
    signIn(null);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");

    expect(publishButton().textContent).toBe("Connect to publish");
    expect(publishButton().disabled).toBe(false);
    fireEvent.click(publishButton());

    expect(useConnectDialog.getState().open).toBe(true);
    expect(signAndPublish).not.toHaveBeenCalled();
  });

  it("publishes nothing when the form is submitted another way", () => {
    signIn(null);
    open();
    type("name", "Blue Bottle");
    type("category", "cafe");

    fireEvent.submit(screen.getByRole("form"));

    expect(signAndPublish).not.toHaveBeenCalled();
  });
});

describe("changing an item", () => {
  it("starts from the item's values and names the form for what it changes", () => {
    open({ item: ITEM });

    expect(screen.getByRole("form", { name: "Edit place" })).toBeTruthy();
    expect(input("name").value).toBe("Blue Bottle");
    expect(input("category").value).toBe("cafe");
    expect(input("website").value).toBe("https://bluebottle.example.test");
    expect(input("phone").value).toBe("");
  });

  it("publishes the item's own tags, apart from client, when nothing was changed", async () => {
    open({ item: ITEM });
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    const template = vi.mocked(signAndPublish).mock.calls[0][0];
    const withoutClient = (tags: string[][]) => tags.filter((t) => t[0] !== "client");
    expect(template.kind).toBe(39999);
    expect(withoutClient(template.tags)).toEqual(withoutClient(ITEM.tags));
  });

  it("changes only the tag of the field that changed", async () => {
    open({ item: ITEM });
    type("category", "  bakery ");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual(ITEM.tags.map((t) => (t[0] === "category" ? ["category", "bakery"] : t)));
  });

  it("adds the tag of a field the item didn't have, after the others, and drops the tag of one that was emptied", async () => {
    open({ item: ITEM });
    type("phone", "+1 555 0100");
    type("website", "");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual([...ITEM.tags.filter((t) => t[0] !== "website"), ["phone", "+1 555 0100"]]);
  });

  it("puts a changed value back to what the item had and publishes it unchanged", async () => {
    open({ item: ITEM });
    type("name", "Red Bottle");
    type("name", "Blue Bottle");
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual(ITEM.tags);
  });

  it("stops at a required field emptied, with the problem by its input", () => {
    open({ item: ITEM });
    expect(publishButton().disabled).toBe(false);

    type("name", "");

    expect(publishButton().disabled).toBe(true);
    expect(around("name").getByText('places require "name".')).toBeTruthy();
  });

  it("says what is the matter with an item as it stands, before anything is changed", () => {
    open({ item: { ...ITEM, tags: [...ITEM.tags, ["website", "https://second.example.test"]] } });

    expect(around("website").getByText('"website" is given 2 times; only the first shows.')).toBeTruthy();
    expect(screen.getByText(/places don't declare "hours"/)).toBeTruthy();
  });

  it("changes only the person's field of a newer version that arrives while the form is open", async () => {
    const view = open({ item: ITEM });
    type("name", "Red Bottle");

    // Someone else's later version of the item: another field changed, another tag added.
    const NEWER: ItemEvent = {
      ...ITEM,
      id: "b".repeat(64),
      created_at: ITEM.created_at + 60,
      tags: [...ITEM.tags.map((t) => (t[0] === "category" ? ["category", "bakery"] : t)), ["phone", "+1 555 0100"]],
    };
    view.rerender(form({ item: NEWER }));
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual(NEWER.tags.map((t) => (t[0] === "name" ? ["name", "Red Bottle"] : t)));
  });

  it("publishes a newer version unchanged when the person changed nothing", async () => {
    const view = open({ item: ITEM });
    const NEWER: ItemEvent = {
      ...ITEM,
      id: "b".repeat(64),
      created_at: ITEM.created_at + 60,
      tags: ITEM.tags.map((t) => (t[0] === "website" ? ["website", "https://other.example.test"] : t)),
    };
    view.rerender(form({ item: NEWER }));
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual(NEWER.tags);
  });

  it("keeps the tag of a field the list began to declare while the form was open", async () => {
    const view = open({ item: ITEM });
    const declaresHours = definitionOf({ ...PLACES, tags: [...PLACES.tags, ["optional", "hours"]] });
    view.rerender(form({ item: ITEM, definition: declaresHours }));
    fireEvent.click(publishButton());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(sentTags()).toEqual(ITEM.tags);
  });

  it("hands the signed event on once the list relay has it", async () => {
    open({ item: ITEM });
    fireEvent.click(publishButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SIGNED));
  });
});

describe("cancelling", () => {
  it("leaves without publishing", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(signAndPublish).not.toHaveBeenCalled();
  });
});
