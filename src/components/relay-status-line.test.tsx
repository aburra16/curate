// @vitest-environment jsdom
/** The small line that names a relay that didn't answer. */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DCOSL, INDEX, TAG_HUB } from "@/services/relays";
import { useRelayStatus } from "@/stores/relay-status";
import { RelayStatusLine } from "./relay-status-line";

beforeEach(() => {
  useRelayStatus.getState().reset();
});

describe("RelayStatusLine", () => {
  it("says nothing while every relay answered, or none has been asked", () => {
    const { container } = render(<RelayStatusLine />);
    expect(container.textContent).toBe("");
    useRelayStatus.getState().report(DCOSL, { state: "eose" });
    useRelayStatus.getState().report(INDEX, { state: "eose" });
    expect(container.textContent).toBe("");
  });

  it("names the index when it refuses, and says counts are missing", () => {
    useRelayStatus.getState().report(DCOSL, { state: "eose" });
    useRelayStatus.getState().report(INDEX, {
      state: "closed",
      reason: "vespa searched only 67% of the corpus: refused",
    });
    render(<RelayStatusLine />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("No answer from the index (search.brainstorm.world).");
    expect(line.textContent).toContain("counts are missing");
    expect(line.textContent).not.toContain("dcosl");
    expect(line.getAttribute("title")).toContain("vespa searched only 67% of the corpus");
  });

  it("names every relay that didn't answer, whatever way it failed", () => {
    useRelayStatus.getState().report(DCOSL, { state: "timeout" });
    useRelayStatus.getState().report(TAG_HUB, { state: "error", reason: "the connection failed" });
    useRelayStatus.getState().report("wss://relay.example.com", { state: "eose" });
    render(<RelayStatusLine />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("dcosl (dcosl.brainstorm.world)");
    expect(text).toContain("the tag hub (tags.brainstorm.world)");
    expect(text).not.toContain("relay.example.com");
    expect(text).not.toContain("counts are missing"); // the index answered nothing wrong
  });

  it("goes away when the relay answers again", () => {
    useRelayStatus.getState().report(INDEX, { state: "timeout" });
    const { container } = render(<RelayStatusLine />);
    expect(container.textContent).toContain("No answer from");
    act(() => useRelayStatus.getState().report(INDEX, { state: "eose" }));
    expect(container.textContent).toBe("");
  });
});
