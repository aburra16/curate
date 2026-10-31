// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/site-footer";

describe("the footer", () => {
  it("names the source and its license, and links to the source", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");

    expect(footer.textContent).toContain("Source: github.com/aburra16/curate (AGPL-3.0)");
    const source = within(footer).getByRole("link", { name: "github.com/aburra16/curate" });
    expect(source.getAttribute("href")).toBe("https://github.com/aburra16/curate");
    expect(source.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("carries Brainstorm's shared Built on Brainstorm element, upgraded", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");

    const element = footer.querySelector("built-on-brainstorm");
    expect(element).not.toBeNull();
    // Registered by the time the footer is on the page: it has drawn itself.
    expect(customElements.get("built-on-brainstorm")).toBeDefined();
    const link = element?.shadowRoot?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://brainstorm.world");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("aria-label")).toBe("Built on Brainstorm (opens in a new tab)");
    expect(link?.textContent).toContain("Built on Brainstorm");
  });

  it("takes its look from brainstorm.world's shared stylesheet", () => {
    render(<SiteFooter />);

    const sheet = document.querySelector("built-on-brainstorm")?.shadowRoot?.querySelector("link[rel=stylesheet]");
    expect(sheet?.getAttribute("href")).toBe("https://brainstorm.world/built-on/v1.css");
  });

  it("is in the footer once, however many times the page renders it", () => {
    const { rerender } = render(<SiteFooter />);
    rerender(<SiteFooter />);

    expect(document.querySelectorAll("built-on-brainstorm")).toHaveLength(1);
  });
});
