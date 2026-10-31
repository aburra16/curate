import { describe, expect, it } from "vitest";
import type { ItemLink } from "@/lib/linkTemplates";
import { distinctLinks } from "./links";

const link = (href: string, label = "Link"): ItemLink => ({ label, href, host: new URL(href).host });

describe("distinctLinks", () => {
  it("puts the item's own link first, then the template links, in order", () => {
    const own = link("https://a.example/me", "Website");
    const built = [link("https://b.example/1"), link("https://c.example/2")];
    expect(distinctLinks(own, built).map((l) => l.href)).toEqual([
      "https://a.example/me",
      "https://b.example/1",
      "https://c.example/2",
    ]);
  });

  it("keeps one of each address, the first", () => {
    const own = link("https://a.example/me", "Website");
    const built = [link("https://a.example/me", "Profile"), link("https://b.example/1"), link("https://b.example/1")];
    expect(distinctLinks(own, built)).toEqual([own, built[1]]);
  });

  it("is the template links alone when the item has no link of its own", () => {
    const built = [link("https://b.example/1")];
    expect(distinctLinks(null, built)).toEqual(built);
    expect(distinctLinks(null, [])).toEqual([]);
  });
});
