"use client";

/**
 * The "Built on Brainstorm" line, the same in every app built on Brainstorm and Tapestry:
 * Brainstorm's mark and the words, the whole of it one link to brainstorm.world. It is a
 * custom element whose file Brainstorm-UI owns and each app copies unchanged (here
 * ../lib/built-on-brainstorm.js, pinned in vendor/brainstorm-ui.json), and whose look
 * comes from https://brainstorm.world/built-on/v1.css, so a restyle there reaches every app.
 * Contract: docs/built-on-brainstorm.md in NosFabrica/Brainstorm-UI.
 *
 * Importing the file registers the element. That happens in the browser only: on the server
 * (the static export's build) the file finds no custom element registry and does nothing, and
 * the element is printed as plain markup for the browser to upgrade. The line is fitted to the
 * page with the hooks in globals.css.
 */

import type { DetailedHTMLProps, HTMLAttributes } from "react";
import "@/lib/built-on-brainstorm.js";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "built-on-brainstorm": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function BuiltOnBrainstorm() {
  return <built-on-brainstorm />;
}
