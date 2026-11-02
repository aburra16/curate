"use client";

import { useCallback, useEffect, useRef } from "react";
import { connectBunker as connectRemoteBunker, restoreRemote, startPairing as startRemotePairing } from "@/services/remoteSigner";
import {
  connectExtension as connectExtensionSigner,
  disconnect as disconnectSigner,
  restoreExtension,
  SignerError,
} from "@/services/signer";
import { useSigner } from "@/stores/signer";

/** A connect that can still be stopped. */
interface Attempt {
  /** Stop waiting. Does nothing once the attempt has ended. */
  cancel: () => void;
}

/** A pairing in progress: the code to show, and how to stop waiting for a signer to scan it. */
export interface Pairing extends Attempt {
  /** The `nostrconnect://` code, to show as a picture or to copy. */
  uri: string;
}

/** A bunker being asked to connect. */
export interface BunkerAttempt extends Attempt {
  /** Settles once the attempt has ended, however it ended; never rejects. */
  done: Promise<void>;
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

  /**
   * Connect the bunker a pasted `bunker://` link names, and be connected once
   * it answers. A bunker may be waiting for its owner to approve, so this can
   * take minutes: `cancel` gives up on it. The signer in use is let go, so a
   * bunker that answers late is closed and never put in use, and what it says
   * after that changes nothing.
   */
  const connectBunker = useCallback(
    (link: string): BunkerAttempt => {
      setConnecting();
      let over = false;
      const done = connectRemoteBunker(link).then(
        (connected) => {
          if (over) return;
          over = true;
          setConnected(connected, "remote");
        },
        (err: unknown) => {
          if (over) return;
          over = true;
          setError(failureWords(err));
        },
      );
      const cancel = () => {
        if (over) return;
        over = true;
        void disconnectSigner().catch(() => {});
        setDisconnected();
      };
      return { done, cancel };
    },
    [setConnecting, setConnected, setError, setDisconnected],
  );

  /**
   * Start pairing a signer app by code, and be connected once one pairs.
   * `onAnswered` hears when a signer has answered the code, while its account is
   * still to come. Null when the pairing could not start; the store then holds
   * why. A pairing that is stopped, or overtaken by another signer, ends quietly.
   */
  const startPairing = useCallback((onAnswered?: () => void): Pairing | null => {
    setConnecting();
    let over = false;
    let pairing: ReturnType<typeof startRemotePairing>;
    try {
      pairing = startRemotePairing(undefined, () => {
        if (!over) onAnswered?.();
      });
    } catch (err) {
      setError(failureWords(err));
      return null;
    }

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

/** Whether a page load can still bring the extension back: the person hasn't connected, started to or disconnected. */
const extensionWanted = (): boolean => {
  const { status, extensionConnected } = useSigner.getState();
  return status === "disconnected" && extensionConnected;
};

/**
 * Bring back the signer the last page left behind, once, when the page loads:
 * the kept remote session, or else the extension that was connected. Nothing is
 * shown when there is none, when it can't be brought back, or when the person
 * connected another signer meanwhile: they are disconnected, or connected as
 * they chose, and Connect is there.
 */
export function useRestoreSigner(): void {
  const setConnected = useSigner((s) => s.setConnected);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const restore = async () => {
      const remote = await restoreRemote();
      if (remote) return setConnected(remote, "remote");
      const { pubkey } = useSigner.getState();
      if (pubkey && extensionWanted() && (await restoreExtension(pubkey, extensionWanted))) {
        setConnected(pubkey, "extension");
      }
    };
    restore().catch(() => {});
  }, [setConnected]);
}
