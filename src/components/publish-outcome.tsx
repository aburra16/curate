import { useConnectSigner } from "@/hooks/use-connect-signer";
import type { WriteState } from "@/hooks/use-write";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";

/**
 * What the list relay said about the last write. Saved says so (the write
 * completes at once, and a toast names any of the author's own relays that
 * missed it); not saved gives the list relay's words and a Retry that resends
 * the same event, disabled while a write is in flight; a write that stopped
 * before any relay was asked shows why. A remote signer that stopped
 * answering or refused (it may have been revoked) also offers Connect again,
 * as does any signer that signed as another account. Nothing shows before a
 * write or while one is in flight.
 */
export function PublishOutcome({
  state,
  busy,
  onRetry,
}: {
  state: WriteState;
  busy: boolean;
  onRetry: () => void;
}) {
  const signing = useSigner((s) => s.method);
  const { disconnect } = useConnectSigner();
  const showChooser = useConnectDialog((s) => s.show);

  if (state.phase === "error") {
    const reconnectable =
      state.reason === "account-changed" ||
      ((state.reason === "timeout" || state.reason === "refused") && signing === "remote");
    if (!reconnectable) {
      return (
        <p role="alert" className="text-[12px] leading-[1.5] text-red-400">
          {state.message}
        </p>
      );
    }
    return (
      <div role="alert" className="flex items-center gap-3 text-[12px] leading-[1.5] text-red-400">
        <p>{state.message}</p>
        <button
          type="button"
          onClick={() => void disconnect().then(showChooser)}
          className="shrink-0 px-3 py-1 text-[12px] bg-surface-raised border border-rule text-ink-soft hover:text-ink transition-colors"
          style={{ borderRadius: "var(--radius-input)" }}
        >
          Connect again
        </button>
      </div>
    );
  }
  if (state.phase !== "done") return null;

  const { result } = state;
  if (!result.onHub) {
    return (
      <div role="alert" className="flex items-center gap-3 text-[12px] leading-[1.5] text-red-400">
        <p>Not saved to the list relay: {result.hubMessage}</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="shrink-0 px-3 py-1 text-[12px] bg-surface-raised border border-rule text-ink-soft hover:text-ink transition-colors disabled:opacity-40"
          style={{ borderRadius: "var(--radius-input)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <p role="status" className="text-[12px] leading-[1.5] text-ink-soft">
      Saved to the list relay.
    </p>
  );
}
