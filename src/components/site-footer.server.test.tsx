// The static export renders the footer on the server, where there is no document and no custom
// element registry: the shared element's file must load there and do nothing, and the footer must
// still print the element for the browser to upgrade.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "@/components/site-footer";

describe("the footer, rendered on the server", () => {
  it("renders without a DOM, with the source line and the element in the markup", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof customElements).toBe("undefined");

    const html = renderToString(<SiteFooter />);

    const text = html.replace(/<!-- -->/g, "").replace(/<[^>]*>/g, "");
    expect(text).toContain("Source: github.com/aburra16/curate (AGPL-3.0)");
    expect(html).toContain('href="https://github.com/aburra16/curate"');
    expect(html).toMatch(/<built-on-brainstorm[^>]*><\/built-on-brainstorm>/);
  });
});
