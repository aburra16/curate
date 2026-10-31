"use client";

import { useCallback } from "react";
import { connectExtension, disconnect as disconnectSigner } from "@/services/signer";
import { useSigner } from "@/stores/signer";

export function useConnectSigner() {
  const status = useSigner((s) => s.status);
  const pubkey = useSigner((s) => s.pubkey);
  const setConnecting = useSigner((s) => s.setConnecting);
  const setConnected = useSigner((s) => s.setConnected);
  const setError = useSigner((s) => s.setError);
  const setDisconnected = useSigner((s) => s.setDisconnected);

  const connect = useCallback(async () => {
    setConnecting();
    try {
      setConnected(await connectExtension(), "extension");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [setConnecting, setConnected, setError]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectSigner();
    } finally {
      setDisconnected();
    }
  }, [setDisconnected]);

  return { status, pubkey, connect, disconnect };
}
