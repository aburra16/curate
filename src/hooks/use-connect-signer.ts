"use client";

import { useCallback, useEffect, useRef } from "react";
import { connectBunker as connectRemoteBunker, restoreRemote, startPairing as startRemotePairing } from "@/services/remoteSigner";
import { connectExtension as connectExtensionSigner, disconnect as disconnectSigner, SignerError } from "@/services/signer";
import { useSigner } from "@/stores/signer";

/** A pairing in progress: the code to show, and how to stop waiting for a signer to scan it. */
export interface Pairing {
  /** The `nostrconnect://` code, to show as a picture or to copy. */
  uri: string;
  /** Stop waiting. Does nothing once a signer has paired or the pairing has ended. */
  cancel: () => void;
}

const failureWords = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Connecting and disconnecting the signer, with the signer store following
 * every step: connecting while a signer is asked, connected when it answers,
 * and the signer's own words when it doesn't.
 */
export function useConnectSigner() {
  const status = useSigner((s) => s.status);
  const pubkey = useSigner((s) => s.pubkey);
  const error = useSigner((s) => s.error);
  const setConnecting = useSigner((s) => s.setConnecting);
  const setConnected = useSigner((s) => s.setConnected);
  const setError = useSigner((s) => s.setError);
  const setDisconnected = useSigner((s) => s.setDisconnected);

  /** Connect the browser's signer extension. */
  const connectExtension = useCallback(async () => {
    setConnecting();
    try {
      setConnected(await connectExtensionSigner(), "extension");
    } catch (err) {
      setError(failureWords(err));
    }
  }, [setConnecting, setConnected, setError]);

  /** Connect the bunker a pasted `bunker://` link names. */
  const connectBunker = useCallback(
    async (link: string) => {
      setConnecting();
      try {
        setConnected(await connectRemoteBunker(link), "remote");
      } catch (err) {
        setError(failureWords(err));
      }
    },
    [setConnecting, setConnected, setError],
  );

  /**
   * Start pairing a signer app by code, and be connected once one pairs.
   * Null when the pairing could not start; the store then holds why. A pairing
   * that is stopped, or overtaken by another signer, ends quietly.
   */
  const startPairing = useCallback((): Pairing | null => {
    setConnecting();
    let pairing: ReturnType<typeof startRemotePairing>;
    try {
      pairing = startRemotePairing();
    } catch (err) {
      setError(failureWords(err));
      return null;
    }

    let over = false;
    pairing.done.then(
      (paired) => {
        over = true;
        setConnected(paired, "remote");
      },
      (err: unknown) => {
        over = true;
        if (err instanceof SignerError && err.reason === "not-connected") return;
        setError(failureWords(err));
      },
    );

    const cancel = () => {
      if (over) return;
      over = true;
      pairing.cancel();
      // Whatever else has taken over the store since is left as it is.
      if (useSigner.getState().status === "connecting") setDisconnected();
    };
    return { uri: pairing.uri, cancel };
  }, [setConnecting, setConnected, setError, setDisconnected]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectSigner();
    } catch {
      // The signer is forgotten before anything can fail; closing it is all that went wrong.
    } finally {
      setDisconnected();
    }
  }, [setDisconnected]);

  return { status, pubkey, error, connectExtension, connectBunker, startPairing, disconnect };
}

/**
 * Bring back the remote signer a reload left behind, once, when the page
 * loads. Nothing is shown when there is none, when it can't be reopened, or
 * when the person connected another signer while it reopened: they are
 * disconnected, or connected as they chose, and Connect is there.
 */
export function useRestoreRemote(): void {
  const setConnected = useSigner((s) => s.setConnected);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    restoreRemote().then(
      (restored) => {
        if (restored) setConnected(restored, "remote");
      },
      () => {},
    );
  }, [setConnected]);
}
