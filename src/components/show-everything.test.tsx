// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useView } from "@/stores/view";
import { ShowEverything } from "./show-everything";

beforeEach(() => {
  localStorage.clear();
  useView.setState({ on: false, loaded: false });
});

describe("ShowEverything", () => {
  it("is a switch named 'Show everything', off to begin with", () => {
    render(<ShowEverything />);
    const toggle = screen.getByRole("switch", { name: "Show everything" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("turns on and off, and keeps its place", () => {
    render(<ShowEverything />);
    const toggle = screen.getByRole("switch", { name: "Show everything" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("curate.showEverything")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("comes up on when it was left on", () => {
    localStorage.setItem("curate.showEverything", "true");
    render(<ShowEverything />);
    expect(screen.getByRole("switch", { name: "Show everything" }).getAttribute("aria-checked")).toBe("true");
  });
});
