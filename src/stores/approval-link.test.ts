import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalLink } from "@/stores/approval-link";

beforeEach(() => useApprovalLink.getState().dismiss());

describe("the approval link store", () => {
  it("keeps an https link, as the browser reads it", () => {
    useApprovalLink.getState().show("https://Signer.Example.test/approve?request=1");

    expect(useApprovalLink.getState().url).toBe("https://signer.example.test/approve?request=1");
  });

  it.each([
    ["an http link", "http://signer.example.test/approve"],
    ["a script", "javascript:alert(1)"],
    ["a data page", "data:text/html,<p>approve</p>"],
    ["an address that opens the phone's own app", "nostrconnect://signer.example.test"],
    ["a path with no site", "/approve"],
    ["words", "approve me"],
    ["nothing", ""],
  ])("ignores %s", (_what, url) => {
    useApprovalLink.getState().show(url);

    expect(useApprovalLink.getState().url).toBeNull();
  });

  it("keeps the link it has when a bad one comes", () => {
    useApprovalLink.getState().show("https://signer.example.test/approve");

    useApprovalLink.getState().show("javascript:alert(1)");

    expect(useApprovalLink.getState().url).toBe("https://signer.example.test/approve");
  });

  it("puts the link away when dismissed", () => {
    useApprovalLink.getState().show("https://signer.example.test/approve");

    useApprovalLink.getState().dismiss();

    expect(useApprovalLink.getState().url).toBeNull();
  });
});
