// @vitest-environment jsdom
/**
 * "Show everything" is kept in localStorage (key `curate.showEverything`),
 * and every read and write is guarded: a blocked or full store must not
 * break the page, and the switch still works for the visit.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHOW_EVERYTHING_KEY, useShowEverything, useView } from "./view";

beforeEach(() => {
  localStorage.clear();
  useView.setState({ on: false, loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useShowEverything", () => {
  it("starts off, and the key is curate.showEverything", () => {
    expect(SHOW_EVERYTHING_KEY).toBe("curate.showEverything");
    const { result } = renderHook(() => useShowEverything());
    expect(result.current.on).toBe(false);
  });

  it("set(true) turns it on and keeps it", () => {
    const { result } = renderHook(() => useShowEverything());
    act(() => result.current.set(true));
    expect(result.current.on).toBe(true);
    expect(localStorage.getItem("curate.showEverything")).toBe("true");
    act(() => result.current.set(false));
    expect(result.current.on).toBe(false);
    expect(localStorage.getItem("curate.showEverything")).toBe("false");
  });

  it("a later visit reads what was kept", () => {
    localStorage.setItem("curate.showEverything", "true");
    const { result } = renderHook(() => useShowEverything());
    expect(result.current.on).toBe(true);
  });

  it("anything but true reads as off", () => {
    localStorage.setItem("curate.showEverything", "yes");
    const { result } = renderHook(() => useShowEverything());
    expect(result.current.on).toBe(false);
  });

  it("two users of the hook agree (the header's switch and the page)", () => {
    const header = renderHook(() => useShowEverything());
    const page = renderHook(() => useShowEverything());
    act(() => header.result.current.set(true));
    expect(page.result.current.on).toBe(true);
  });

  it("works when storage throws on read and on write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const { result } = renderHook(() => useShowEverything());
    expect(result.current.on).toBe(false);
    act(() => result.current.set(true));
    expect(result.current.on).toBe(true); // still applies for the visit
  });

  it("works when localStorage itself is missing", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      const { result } = renderHook(() => useShowEverything());
      expect(result.current.on).toBe(false);
      act(() => result.current.set(true));
      expect(result.current.on).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
