/**
 * The page's relay pool: one shared RelayPool, created on first use.
 *
 * Browser-only. Relay sockets are client-side state, so server-rendered pages
 * draw skeletons and data arrives after hydration. The pool holds no relay
 * list of its own: every request names the relays it goes to.
 */

import { RelayPool } from "applesauce-relay";

let pool: RelayPool | null = null;

/** The shared relay pool. Throws when called outside the browser. */
export function getPool(): RelayPool {
  if (typeof window === "undefined") {
    throw new Error("getPool() can only be called in the browser");
  }
  if (!pool) pool = new RelayPool();
  return pool;
}
