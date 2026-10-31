/**
 * URL templates, fetched by the event id a header's `link` pins
 * (lib/linkTemplates). Follows Brainstorm-UI's services/linkTemplates.ts at
 * the pinned commit, reading dcosl and the tag hub.
 */
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import type { LinkRef } from "@/lib/linkTemplates";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, TAG_HUB } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";
import { relayCorpus, type HeldRelay } from "@/test/relayCorpus";
import githubTemplate from "@/test/fixtures/github.template.json";
import { clearTemplateCache, fetchTemplates } from "./templates";

const [github] = githubTemplate as NostrEvent[];
const URL_TEMPLATES = "39998:2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331:url-templates";

const ref = (templateId: string): LinkRef => ({ templateId, relay: "", bindings: [["username", "github-username"]] });

const template = (url: string, name = "A link") =>
  finalizeEvent(
    { kind: 9999, created_at: 1_792_000_000, content: "", tags: [["z", URL_TEMPLATES], ["name", name], ["url-template", url]] },
    generateSecretKey(),
  ) as NostrEvent;

function hold(held: Record<string, HeldRelay>) {
  const corpus = relayCorpus(held);
  setTransport(corpus.transport);
  return corpus;
}

beforeEach(() => {
  clearTemplateCache();
  clearSeenOn();
  useRelayStatus.getState().reset();
});

describe("fetchTemplates", () => {
  it("reads the pinned templates by id from dcosl and the tag hub", async () => {
    const { calls } = hold({ [DCOSL]: [], [TAG_HUB]: [github], [INDEX]: [github] });

    const templates = await fetchTemplates([ref(github.id), ref(github.id)]);

    expect([...templates]).toEqual([
      [
        github.id,
        { id: github.id, pubkey: github.pubkey, name: "GitHub profile", template: "https://github.com/{username}" },
      ],
    ]);
    expect(calls.map((c) => c.relay).sort()).toEqual([DCOSL, TAG_HUB].sort());
    for (const c of calls) expect(c.filters).toEqual([{ ids: [github.id] }]);
  });

  it("keeps what it found for the visit: an id is one frozen event", async () => {
    const { calls } = hold({ [DCOSL]: [github], [TAG_HUB]: [] });
    await fetchTemplates([ref(github.id)]);
    const asked = calls.length;

    const again = await fetchTemplates([ref(github.id)]);

    expect(again.get(github.id)?.name).toBe("GitHub profile");
    expect(calls).toHaveLength(asked);
  });

  it("asks again for a template it didn't find: its relay may have been down", async () => {
    hold({ [DCOSL]: { fails: "the connection failed" }, [TAG_HUB]: [] });
    expect((await fetchTemplates([ref(github.id)])).size).toBe(0);

    hold({ [DCOSL]: [github], [TAG_HUB]: [] });
    expect((await fetchTemplates([ref(github.id)])).has(github.id)).toBe(true);
  });

  it("keeps only templates that follow the rules", async () => {
    const plainHttp = template("http://example.com/{id}");
    const hostChosen = template("https://{host}/x");
    const script = template("javascript:alert({id})");
    const notATemplate = finalizeEvent(
      { kind: 9999, created_at: 1_792_000_000, content: "", tags: [["name", "Nothing"]] },
      generateSecretKey(),
    ) as NostrEvent;
    const good = template("https://btcmap.org/merchant/{id}", "BTC Map");
    const events = [plainHttp, hostChosen, script, notATemplate, good];
    hold({ [DCOSL]: events, [TAG_HUB]: [] });

    const templates = await fetchTemplates(events.map((e) => ref(e.id)));

    expect([...templates.keys()]).toEqual([good.id]);
  });

  it("asks nothing when no link pins a template", async () => {
    const { calls } = hold({ [DCOSL]: [github], [TAG_HUB]: [github] });
    expect((await fetchTemplates([])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
