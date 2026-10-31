// @vitest-environment jsdom
/** Brainstorm's check problems, picked out by field and listed. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Problem } from "@/lib/listCheck";
import { CheckProblems, hasBlocking, problemsFor } from "./check-problems";

const missingName: Problem = {
  code: "required-missing",
  field: "name",
  message: "name is required.",
  blocking: true,
};
const badSite: Problem = {
  code: "not-a-url",
  field: "website",
  message: "website isn't a web address.",
  blocking: false,
};
const dropped: Problem = {
  code: "dropped-tag",
  field: null,
  message: '["x","y"] is dropped: not a tag a header uses.',
  blocking: false,
};

describe("problemsFor", () => {
  it("picks a field's problems", () => {
    const problems = [missingName, badSite, dropped];

    expect(problemsFor(problems, "name")).toEqual([missingName]);
    expect(problemsFor(problems, "website")).toEqual([badSite]);
    expect(problemsFor(problems, "phone")).toEqual([]);
  });

  it("picks the problems that are about no field with null", () => {
    expect(problemsFor([missingName, dropped], null)).toEqual([dropped]);
  });
});

describe("hasBlocking", () => {
  it("is true when any problem would stop the write", () => {
    expect(hasBlocking([badSite, missingName])).toBe(true);
    expect(hasBlocking([badSite, dropped])).toBe(false);
    expect(hasBlocking([])).toBe(false);
  });
});

describe("CheckProblems", () => {
  it("says nothing when there are no problems", () => {
    const { container } = render(<CheckProblems problems={[]} />);

    expect(container.textContent).toBe("");
  });

  it("lists the messages, and marks the blocking ones", () => {
    render(<CheckProblems problems={[missingName, badSite]} />);

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["name is required.", "website isn't a web address."]);
    expect(items[0].hasAttribute("data-blocking")).toBe(true);
    expect(items[1].hasAttribute("data-blocking")).toBe(false);
  });
});
