// @vitest-environment jsdom
/** A modal dialog's behaviour: focus in and back out, Tab kept inside, Escape, scrolling, and focus kept when the content changes. */
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDialog } from "@/hooks/use-dialog";

/** A dialog with a button that can be removed or disabled, to change what it shows. */
function Dialog({
  onClose,
  returnFocus,
  shown,
  removed = false,
  disabled = false,
}: {
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  shown: string | null;
  removed?: boolean;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialog(dialog, onClose, returnFocus, shown);
  return (
    <div ref={dialog} role="dialog" aria-label="Test" tabIndex={-1} onKeyDown={onKeyDown}>
      <button type="button">First</button>
      {removed ? null : (
        <button type="button" disabled={disabled}>
          Middle
        </button>
      )}
      <button type="button">Last</button>
    </div>
  );
}

const dialog = () => screen.getByRole("dialog");
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

afterEach(() => {
  document.body.style.overflow = "";
});

describe("useDialog", () => {
  it("moves focus into the dialog, and stops the page behind it from scrolling", () => {
    const { unmount } = render(<Dialog shown="one" onClose={() => {}} />);

    expect(document.activeElement).toBe(dialog());
    expect(document.body.style.overflow).toBe("hidden");

    unmount();

    expect(document.body.style.overflow).toBe("");
  });

  it("gives focus back to what the dialog was told to, when it goes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const { unmount } = render(<Dialog shown="one" onClose={() => {}} returnFocus={() => opener} />);

    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("closes on Escape, wherever focus is", () => {
    const onClose = vi.fn();
    render(<Dialog shown="one" onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last control to the first, and Shift+Tab the other way", () => {
    render(<Dialog shown="one" onClose={() => {}} />);

    button("Last").focus();
    fireEvent.keyDown(button("Last"), { key: "Tab" });
    expect(document.activeElement).toBe(button("First"));

    fireEvent.keyDown(button("First"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(button("Last"));
  });

  it("brings back focus that lands outside", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    render(<Dialog shown="one" onClose={() => {}} />);

    outside.focus();

    expect(document.activeElement).toBe(dialog());
    outside.remove();
  });

  it("takes focus back when the view changes and the control that had it is gone", () => {
    const { rerender } = render(<Dialog shown="one" onClose={() => {}} />);
    button("Middle").focus();

    rerender(<Dialog shown="two" onClose={() => {}} removed />);

    expect(document.activeElement).toBe(dialog());
  });

  it("takes focus back when the view changes and the control that had it is held", () => {
    const { rerender } = render(<Dialog shown="one" onClose={() => {}} />);
    button("Middle").focus();

    rerender(<Dialog shown="two" onClose={() => {}} disabled />);

    expect(document.activeElement).toBe(dialog());
  });

  it("leaves focus alone when the view changes and the control that had it is still usable", () => {
    const { rerender } = render(<Dialog shown="one" onClose={() => {}} />);
    button("Middle").focus();

    rerender(<Dialog shown="two" onClose={() => {}} />);

    expect(document.activeElement).toBe(button("Middle"));
  });

  it("does not move focus when nothing about the view changes", () => {
    const { rerender } = render(<Dialog shown="one" onClose={() => {}} />);
    button("Middle").focus();

    rerender(<Dialog shown="one" onClose={() => {}} disabled />);

    expect(document.activeElement).toBe(button("Middle"));
  });
});
