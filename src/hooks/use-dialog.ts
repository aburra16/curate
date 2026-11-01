"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog's behaviour: focus moves into it when it opens and returns
 * to what opened it when it closes; Tab stays inside it, among the controls
 * that can be reached (not those inside a `hidden` part); Escape closes it,
 * wherever focus has fallen; the page behind it doesn't scroll. Returns the
 * dialog's key handler (Tab).
 *
 * `shown` is what the dialog shows now (an event's id, or null while there
 * is none). When it changes, what was focused may be gone with the old
 * content (a link followed in the panel unmounts the link) or may have been
 * disabled (a button pressed that starts something): focus is brought back
 * into the dialog, or Escape and the Tab wrap would have nothing to hear them.
 */
export function useDialog(
  dialog: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  returnFocus: (() => HTMLElement | null) | undefined,
  shown: string | null,
) {
  const latest = useRef({ onClose, returnFocus });
  useEffect(() => {
    latest.current = { onClose, returnFocus };
  });

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.focus();
    // Focus that lands outside (a screen reader's virtual cursor, a stray Tab) comes back.
    const keepIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !node.contains(e.target)) node.focus();
    };
    document.addEventListener("focusin", keepIn);
    // Escape closes the dialog wherever focus is: on the page's body, once what had it has been unmounted.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      e.stopPropagation();
      latest.current.onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("focusin", keepIn);
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = overflow;
      const back = latest.current.returnFocus?.();
      if (back?.isConnected) back.focus();
    };
  }, [dialog]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // A control that was disabled while it had focus keeps it in some browsers until they catch up, then drops it.
    const held = document.activeElement;
    const lost = !node.contains(held) || (held instanceof HTMLElement && held.matches(":disabled"));
    if (lost) node.focus();
  }, [dialog, shown]);

  return (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    // A control inside a hidden part (a view that is kept drawn, out of sight) can't take focus.
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
    if (!focusable.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
