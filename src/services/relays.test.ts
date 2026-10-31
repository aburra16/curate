// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { extraRelays, migrateSettings, useSettings } from "@/stores/settings";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB, listRelays } from "@/services/relays";

beforeEach(() => {
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
});

describe("the relays, exactly", () => {
  it("names each relay's URL", () => {
    expect(DCOSL).toBe("wss://dcosl.brainstorm.world");
    expect(INDEX).toBe("wss://search.brainstorm.world");
    expect(TAG_HUB).toBe("wss://tags.brainstorm.world/relay");
    expect([...PROFILE_RELAYS]).toEqual(["wss://purplepag.es", "wss://nos.lol", "wss://relay.primal.net"]);
  });

  it("no longer defaults to the retired relays", () => {
    expect(DEFAULT_RELAYS).not.toContain("wss://relay.nostr.band");
    expect(DEFAULT_RELAYS).not.toContain("wss://relay.damus.io");
    expect(DEFAULT_RELAYS).toContain(DCOSL);
  });
});

describe("listRelays", () => {
  it("is dcosl alone when settings add nothing", () => {
    expect(listRelays()).toEqual([DCOSL]);
  });

  it("puts dcosl first, then the relays the reader added, once each", () => {
    useSettings.setState({
      relays: [
        ...DEFAULT_RELAYS,
        "wss://mine.example.test",
        "wss://mine.example.test/",
        "wss://other.example.test",
        DCOSL,
      ],
    });

    expect(listRelays()).toEqual([DCOSL, "wss://mine.example.test", "wss://other.example.test"]);
  });

  it("never returns the index or the tag hub, even saved as extras", () => {
    // Read from here they would go without the index's search token, and muddle the status line.
    useSettings.setState({
      relays: [
        ...DEFAULT_RELAYS,
        INDEX,
        `${TAG_HUB}/`,
        "wss://Search.Brainstorm.World/",
        "wss://tags.brainstorm.world/relay",
        "wss://mine.example.test",
      ],
    });

    const relays = listRelays();

    expect(relays).toEqual([DCOSL, "wss://mine.example.test"]);
    expect(relays).not.toContain(INDEX);
    expect(relays).not.toContain(TAG_HUB);
  });

  it("keeps a relay that only shares the index's host with another path", () => {
    useSettings.setState({ relays: [...DEFAULT_RELAYS, "wss://search.brainstorm.world/other"] });

    expect(listRelays()).toEqual([DCOSL, "wss://search.brainstorm.world/other"]);
  });

  it("is dcosl when the reader removed it from settings", () => {
    useSettings.setState({ relays: ["wss://mine.example.test"] });

    expect(listRelays()).toEqual([DCOSL, "wss://mine.example.test"]);
  });
});

describe("extraRelays", () => {
  it("is the saved relays that are not defaults", () => {
    expect(extraRelays([...DEFAULT_RELAYS, "wss://mine.example.test"])).toEqual(["wss://mine.example.test"]);
    expect(extraRelays([...DEFAULT_RELAYS])).toEqual([]);
  });

  it("is what getState exposes", () => {
    useSettings.setState({ relays: [...DEFAULT_RELAYS, "wss://mine.example.test"] });

    expect(useSettings.getState().extraRelays()).toEqual(["wss://mine.example.test"]);
  });
});

describe("migrateSettings", () => {
  const OLD_DEFAULTS = [
    "wss://dcosl.brainstorm.world",
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://relay.nostr.band",
  ];

  it("drops the retired relays from settings saved before they were retired", () => {
    const saved = { relays: [...OLD_DEFAULTS, "wss://mine.example.test"], wotEndpoint: "https://wot.example.test" };

    expect(migrateSettings(saved, 1)).toEqual({
      relays: ["wss://dcosl.brainstorm.world", "wss://relay.primal.net", "wss://nos.lol", "wss://mine.example.test"],
    });
  });

  it("drops the GrapeRank endpoint, which nothing reads any more, and keeps the relays", () => {
    const saved = { relays: [...DEFAULT_RELAYS, "wss://mine.example.test"], wotEndpoint: "https://wot.example.test" };

    expect(migrateSettings(saved, 2)).toEqual({ relays: [...DEFAULT_RELAYS, "wss://mine.example.test"] });
    expect(migrateSettings({ wotEndpoint: "https://wot.example.test" }, 2)).toEqual({});
  });

  it("falls back to the defaults when nothing else was saved", () => {
    expect(migrateSettings({ relays: ["wss://relay.damus.io"] }, 1)).toEqual({ relays: [...DEFAULT_RELAYS] });
  });

  it("leaves current settings alone", () => {
    const saved = { relays: [...OLD_DEFAULTS] };

    expect(migrateSettings(saved, 3)).toEqual(saved);
  });

  it("survives garbage in storage", () => {
    expect(migrateSettings(null, 1)).toEqual({});
    expect(migrateSettings({ relays: "nope" }, 1)).toEqual({});
  });
});

describe("settings saved by an earlier Curate", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("load cleanly: the relays stay, the GrapeRank endpoint is gone", async () => {
    localStorage.setItem(
      "curate-settings",
      JSON.stringify({
        state: { relays: [...DEFAULT_RELAYS, "wss://mine.example.test"], wotEndpoint: "https://wot.example.test" },
        version: 2,
      })
    );

    const { useSettings: fresh } = await import("@/stores/settings");
    const state = fresh.getState();

    expect(state.relays).toEqual([...DEFAULT_RELAYS, "wss://mine.example.test"]);
    expect(state.extraRelays()).toEqual(["wss://mine.example.test"]);
    expect("wotEndpoint" in state).toBe(false);
    expect("setWotEndpoint" in state).toBe(false);
  });

  it("are saved again without the endpoint", async () => {
    localStorage.setItem(
      "curate-settings",
      JSON.stringify({ state: { relays: [...DEFAULT_RELAYS], wotEndpoint: "https://wot.example.test" }, version: 2 })
    );

    const { useSettings: fresh } = await import("@/stores/settings");
    fresh.getState().addRelay("wss://mine.example.test");

    const saved = JSON.parse(localStorage.getItem("curate-settings") ?? "{}");
    expect(saved.version).toBe(3);
    expect(saved.state).not.toHaveProperty("wotEndpoint");
    expect(saved.state.relays).toContain("wss://mine.example.test");
  });
});
