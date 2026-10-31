"use client";

import { useEffect, useMemo, useState } from "react";
import type { DictionaryReader } from "@/services/dictionary";
import { readerAssistant } from "@/services/trust";
import { useSigner } from "@/stores/signer";

/**
 * Who is reading: their public key while an extension is connected (reading
 * signs nothing), and the Assistant their kind 10040 names, once that's
 * been read. Signed out, both are null and the house's version governs.
 *
 * The object changes only when the reader does, so a page that computes
 * from it computes again when someone signs in or out, and not otherwise.
 */
export function useReader(): DictionaryReader {
  const pubkey = useSigner((s) => (s.status === "connected" ? s.pubkey : null));
  const [assistant, setAssistant] = useState<{ pubkey: string; taPubkey: string | null } | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    readerAssistant(pubkey).then(
      (taPubkey) => {
        if (!cancelled) setAssistant({ pubkey, taPubkey });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [pubkey]);

  const taPubkey = pubkey && assistant?.pubkey === pubkey ? assistant.taPubkey : null;
  return useMemo(() => ({ pubkey, taPubkey }), [pubkey, taPubkey]);
}
