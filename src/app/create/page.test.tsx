// @vitest-environment jsdom
/**
 * The create page: names, fields and a short name typed in, Brainstorm's checks
 * shown beside them, the choice offered when a shared concept already has the
 * name, and what a refusal leaves the person.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeaderEvent } from "@/lib/conceptResolution";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";
import { SignerError } from "@/services/signer";
import { setTransport } from "@/services/transport";
import { useSigner } from "@/stores/signer";
import { fakeTransport } from "@/test/fakeTransport";
import tagsHeaders from "@/test/fixtures/tags.headers.json";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));

vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));
vi.mock("@/services/dictionary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/dictionary")>()),
  loadAllHeaders: vi.fn(),
}));
vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { loadAllHeaders } from "@/services/dictionary";
import { retryPublish, signAndPublish } from "@/services/publish";
import CreatePage from "./page";

const READER = "c".repeat(64);
/** Where the real Tags concept lives: the header the other Tags headers point at. */
const TAGS_ROOT = "39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:tag";

const SIGNED: NostrEvent = {
  id: "e".repeat(64),
  pubkey: READER,
  created_at: 1_792_000_000,
  kind: 39998,
  tags: [],
  content: "",
  sig: "5".repeat(128),
};

const saved: PublishResult = { event: SIGNED, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] };
/** The list relay took it; one of the person's own relays didn't. */
const missedOwnRelay: PublishResult = {
  ...saved,
  failed: [{ ok: false, from: "wss://own.example.test", message: "timed out" }],
};
const refusedByList: PublishResult = {
  event: SIGNED,
  onHub: false,
  hubMessage: "blocked: not allowed",
  accepted: [],
  failed: [{ ok: false, from: DCOSL, message: "blocked: not allowed" }],
};

/** A list the reader already has. */
const ownTags: HeaderEvent = {
  id: "1".repeat(64),
  pubkey: READER,
  kind: 39998,
  created_at: 1_790_000_000,
  tags: [
    ["d", "tags"],
    ["names", "tag", "tags"],
  ],
};

function signIn(pubkey: string | null) {
  useSigner.setState(
    pubkey
      ? { pubkey, method: "extension", status: "connected", error: null }
      : { pubkey: null, method: null, status: "disconnected", error: null },
  );
}

/** What the page finds on the list relay, as `loadAllHeaders` reads it. */
function listsOnTheRelay(headers: HeaderEvent[]) {
  vi.mocked(loadAllHeaders).mockResolvedValue(headers);
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const publishButton = () => screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

/** Names a list "tag" and "tags", then waits for the lists on the relay to be read. */
async function nameIt() {
  type("Singular name", "tag");
  type("Plural name", "tags");
  await waitFor(() => expect(publishButton().disabled).toBe(false));
}

beforeEach(() => {
  nav.router.push.mockReset();
  vi.mocked(signAndPublish).mockReset().mockResolvedValue(saved);
  vi.mocked(retryPublish).mockReset().mockResolvedValue(saved);
  vi.mocked(loadAllHeaders).mockReset();
  listsOnTheRelay([]);
  setTransport(fakeTransport({}));
  signIn(READER);
});

describe("Create", () => {
  it("shows the names exactly as typed in the preview", async () => {
    render(<CreatePage />);

    type("Singular name", "tag");
    type("Plural name", "tags");
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(within(preview).getByText("tag")).toBeTruthy();
    expect(within(preview).getByText("tags")).toBeTruthy();

    type("Singular name", "Café");
    type("Plural name", "Cafés");
    expect(within(preview).getByText("Café")).toBeTruthy();
    expect(within(preview).getByText("Cafés")).toBeTruthy();
    expect(within(preview).queryByText("tags")).toBeNull();
  });

  it("disables Publish while a field name is refused, and says which", async () => {
    render(<CreatePage />);
    await nameIt();

    type("Field 1 name", "opening hours");
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText(/Not a field name: opening hours/)).toBeTruthy();

    type("Field 1 name", "opening-hours");
    expect(publishButton().disabled).toBe(false);
    expect(screen.queryByText(/Not a field name/)).toBeNull();
  });

  it("refuses a field named d, and a field named twice", async () => {
    render(<CreatePage />);
    await nameIt();

    type("Field 1 name", "d");
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText(/Not a field name: d/)).toBeTruthy();

    type("Field 1 name", "title");
    click("Add a field");
    type("Field 2 name", "title");
    expect(publishButton().disabled).toBe(true);
    expect(screen.getByText("Listed twice: title.")).toBeTruthy();
  });

  it("starts without complaints, and asks for what is missing once the person has begun", () => {
    render(<CreatePage />);

    expect(publishButton().disabled).toBe(true);
    expect(screen.queryByText(/Give the concept a singular and a plural name/)).toBeNull();

    type("Plural name", "tags");
    expect(screen.getByText(/Give the concept a singular and a plural name/)).toBeTruthy();
  });

  it("adds and removes field rows, with a type, a requirement and a few words each", async () => {
    render(<CreatePage />);
    await nameIt();

    click("Add a field");
    type("Field 2 name", "website");
    fireEvent.change(field("Field 2 type"), { target: { value: "url" } });
    fireEvent.change(field("Field 2 requirement"), { target: { value: "recommended" } });
    type("Field 2 description", "Its home page");
    click("Publish");

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    const tags = vi.mocked(signAndPublish).mock.calls[0][0].tags;
    expect(tags).toContainEqual(["required", "name"]);
    expect(tags).toContainEqual(["recommended", "website", "Its home page"]);
    expect(tags).toContainEqual(["field-type", "website", "url"]);

    fireEvent.click(screen.getAllByRole("button", { name: /^Remove field/ })[1]);
    expect(screen.queryByLabelText("Field 2 name")).toBeNull();
  });

  describe("the short name", () => {
    it("is made from the plural, and kept when the plural changes after the person has typed their own", async () => {
      render(<CreatePage />);

      type("Plural name", "Cafés");
      expect(field("Short name").value).toBe("cafes");
      type("Plural name", "Bars");
      expect(field("Short name").value).toBe("bars");

      type("Short name", "my-bars");
      type("Plural name", "Pubs");
      expect(field("Short name").value).toBe("my-bars");
    });

    it("counts up past a list the reader already has", async () => {
      listsOnTheRelay([ownTags]);
      render(<CreatePage />);

      type("Plural name", "Tags");

      await waitFor(() => expect(field("Short name").value).toBe("tags-2"));
    });

    it("refuses one the reader already has, and says publishing would replace it", async () => {
      listsOnTheRelay([ownTags]);
      render(<CreatePage />);
      await nameIt();
      await waitFor(() => expect(field("Short name").value).toBe("tags-2"));

      type("Short name", "tags");

      expect(
        screen.getByText('You already have a list with the short name "tags". Publishing would replace it.'),
      ).toBeTruthy();
      expect(publishButton().disabled).toBe(true);
    });
  });

  describe("a shared concept with the same name", () => {
    it("offers both choices instead of publishing", async () => {
      listsOnTheRelay(tagsHeaders as HeaderEvent[]);
      render(<CreatePage />);
      await nameIt();

      click("Publish");

      expect(screen.getByText("A shared concept called “tags” already exists.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Make my own version of tags" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Offer a new shared concept anyway" })).toBeTruthy();
      expect(signAndPublish).not.toHaveBeenCalled();
    });

    it("takes the reader to their own version of it", async () => {
      listsOnTheRelay(tagsHeaders as HeaderEvent[]);
      render(<CreatePage />);
      await nameIt();
      click("Publish");

      click("Make my own version of tags");

      expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(TAGS_ROOT)}&edit=mine`);
      expect(signAndPublish).not.toHaveBeenCalled();
    });

    it("stops asking when the names change, and does not ask twice once the reader has offered it anyway", async () => {
      listsOnTheRelay(tagsHeaders as HeaderEvent[]);
      vi.mocked(signAndPublish).mockRejectedValueOnce(new SignerError("refused", "Your signer refused to sign."));
      render(<CreatePage />);
      await nameIt();

      click("Publish");
      expect(screen.getByText("A shared concept called “tags” already exists.")).toBeTruthy();
      type("Plural name", "labels");
      expect(screen.queryByText(/already exists/)).toBeNull();

      type("Plural name", "tags");
      expect(screen.queryByText(/already exists/)).toBeNull();
      click("Publish");
      click("Offer a new shared concept anyway");
      await screen.findByText("Your signer refused to sign.");
      expect(screen.queryByText(/already exists/)).toBeNull();

      click("Publish");

      await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(2));
      expect(screen.queryByText(/already exists/)).toBeNull();
    });

    it("publishes a new one when the reader offers it anyway", async () => {
      listsOnTheRelay(tagsHeaders as HeaderEvent[]);
      render(<CreatePage />);
      await nameIt();
      click("Publish");

      click("Offer a new shared concept anyway");

      await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
      expect(vi.mocked(signAndPublish).mock.calls[0][0].tags).toContainEqual(["b", `39998:${READER}:tags`, "pointer"]);
      await waitFor(() =>
        expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(`39998:${READER}:tags`)}`),
      );
    });
  });

  describe("publishing", () => {
    it("signs the list at its short name and opens it once the list relay has it", async () => {
      render(<CreatePage />);
      await nameIt();
      type("Description", "Words that sort things");

      click("Publish");

      await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
      const template = vi.mocked(signAndPublish).mock.calls[0][0];
      expect(template.kind).toBe(39998);
      expect(template.tags).toEqual([
        ["d", "tags"],
        ["names", "tag", "tags"],
        ["description", "Words that sort things"],
        ["required", "name"],
        ["b", `39998:${READER}:tags`, "pointer"],
      ]);
      await waitFor(() =>
        expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(`39998:${READER}:tags`)}`),
      );
    });

    it("stays where it is when the list relay refuses, and opens the list after a Retry that works", async () => {
      vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
      render(<CreatePage />);
      await nameIt();

      click("Publish");

      await screen.findByText(/Not saved to the list relay: blocked: not allowed/);
      expect(nav.router.push).not.toHaveBeenCalled();

      click("Retry");

      await waitFor(() => expect(retryPublish).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(`39998:${READER}:tags`)}`),
      );
    });

    it("says which of the person's own relays missed the list and opens it when the person chooses", async () => {
      vi.mocked(signAndPublish).mockResolvedValue(missedOwnRelay);
      render(<CreatePage />);
      await nameIt();

      click("Publish");

      await screen.findByText(/Not saved to 1 of your own relays: own\.example\.test/);
      expect(nav.router.push).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();

      click("Open the list");

      expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(`39998:${READER}:tags`)}`);
      expect(signAndPublish).toHaveBeenCalledTimes(1);
    });

    it("waits for the person after a Retry too, when an own relay still misses the list", async () => {
      vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
      vi.mocked(retryPublish).mockResolvedValue(missedOwnRelay);
      render(<CreatePage />);
      await nameIt();
      click("Publish");
      await screen.findByText(/Not saved to the list relay/);

      click("Retry");

      await screen.findByText(/Not saved to 1 of your own relays/);
      expect(nav.router.push).not.toHaveBeenCalled();
      click("Open the list");
      expect(nav.router.push).toHaveBeenCalledTimes(1);
    });

    it("keeps every typed value when the signer refuses", async () => {
      vi.mocked(signAndPublish).mockRejectedValue(new SignerError("refused", "Your signer refused to sign."));
      render(<CreatePage />);
      await nameIt();
      type("Description", "Words that sort things");
      type("Field 1 name", "label");
      type("Field 1 description", "What it says");
      click("Add a field");
      type("Field 2 name", "colour");
      type("Short name", "my-tags");

      click("Publish");

      await screen.findByText("Your signer refused to sign.");
      expect(field("Singular name").value).toBe("tag");
      expect(field("Plural name").value).toBe("tags");
      expect(field("Description").value).toBe("Words that sort things");
      expect(field("Field 1 name").value).toBe("label");
      expect(field("Field 1 description").value).toBe("What it says");
      expect(field("Field 2 name").value).toBe("colour");
      expect(field("Short name").value).toBe("my-tags");
      expect(nav.router.push).not.toHaveBeenCalled();
      expect(publishButton().disabled).toBe(false);
    });

    it("waits for the lists on the relay to be read before it can replace one", async () => {
      let read: (headers: HeaderEvent[]) => void = () => {};
      vi.mocked(loadAllHeaders).mockReturnValue(new Promise<HeaderEvent[]>((resolve) => (read = resolve)));
      render(<CreatePage />);

      type("Singular name", "tag");
      type("Plural name", "tags");
      expect(publishButton().disabled).toBe(true);

      read([]);

      await waitFor(() => expect(publishButton().disabled).toBe(false));
    });
  });

  describe("signed out", () => {
    beforeEach(() => signIn(null));

    it("lets the form be filled in, and reads Connect to publish", async () => {
      render(<CreatePage />);

      type("Singular name", "tag");
      type("Plural name", "tags");

      expect(within(screen.getByRole("region", { name: "Preview" })).getByText("tags")).toBeTruthy();
      const button = screen.getByRole("button", { name: "Connect to publish" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    });
  });
});
