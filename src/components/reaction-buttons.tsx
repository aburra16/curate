"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { buildReactionEvent } from "@/lib/nostr/events";
import { signAndPublish } from "@/lib/nostr/publish";
import { useSigner } from "@/stores/signer";
import { useToast } from "@/components/toast";
import type { ReactionCount } from "@/services/reactions";

interface Props {
  /** The item event id to react to. */
  itemEventId: string;
  /** The item's replaceable address, if any. */
  itemAddress?: string;
  /** The item author pubkey. */
  itemAuthor: string;
  /** The item kind. */
  itemKind: number;
  /** Parent list UUID for filtering. */
  parentListUuid?: string;
  /**
   * The votes read for this item (services/reactions `loadReactions`): one
   * per person, their latest, from inside the reader's web of trust. Absent
   * while they load, or when ranks are unknown.
   */
  counts?: ReactionCount | null;
}

/**
 * Up and down votes on an item: the counts the page read, and the buttons
 * that write a vote. Writing stays as it was until spec 2 replaces it: a
 * vote cast here adds to the counts for this visit.
 */
export function ReactionButtons({
  itemEventId,
  itemAddress,
  itemAuthor,
  itemKind,
  parentListUuid,
  counts,
}: Props) {
  const { toast } = useToast();
  const signerStatus = useSigner((s) => s.status);

  // What a vote cast in this visit adds to the counts read.
  const [cast, setCast] = useState({ up: 0, down: 0 });
  const [myVote, setMyVote] = useState<"+" | "-" | null>(null);
  const [voting, setVoting] = useState(false);
  const upCount = (counts?.up ?? 0) + cast.up;
  const downCount = (counts?.down ?? 0) + cast.down;

  const vote = useCallback(
    async (reaction: "+" | "-") => {
      if (signerStatus !== "connected") {
        toast("Connect your extension to vote.", "error");
        return;
      }
      if (myVote === reaction) return; // already voted this way

      setVoting(true);
      try {
        const template = buildReactionEvent({
          itemEventId,
          itemAddress,
          itemAuthor,
          itemKind,
          parentListUuid,
          reaction,
        });
        await signAndPublish(template);

        // Optimistic update
        setCast((c) =>
          reaction === "+"
            ? { up: c.up + 1, down: myVote === "-" ? c.down - 1 : c.down }
            : { up: myVote === "+" ? c.up - 1 : c.up, down: c.down + 1 },
        );
        setMyVote(reaction);
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Failed to vote.",
          "error"
        );
      } finally {
        setVoting(false);
      }
    },
    [
      signerStatus,
      myVote,
      itemEventId,
      itemAddress,
      itemAuthor,
      itemKind,
      parentListUuid,
      toast,
    ]
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => vote("+")}
        disabled={voting || myVote === "+"}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-[12px] border transition-all duration-150",
          myVote === "+"
            ? "border-green-500/40 text-green-400 bg-green-500/5"
            : "border-rule text-mute hover:text-green-400/60 hover:border-green-500/30",
          "disabled:cursor-default"
        )}
        style={{ borderRadius: "var(--radius-input)" }}
        title="Upvote"
      >
        <span className="text-[14px] leading-none">&uarr;</span>
        {upCount > 0 ? (
          <span className="font-mono text-[11px] tabular-nums">{upCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => vote("-")}
        disabled={voting || myVote === "-"}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-[12px] border transition-all duration-150",
          myVote === "-"
            ? "border-red-500/30 text-red-400 bg-red-500/5"
            : "border-rule text-mute hover:text-ink-soft hover:border-rule-strong",
          "disabled:cursor-default"
        )}
        style={{ borderRadius: "var(--radius-input)" }}
        title="Downvote"
      >
        <span className="text-[14px] leading-none">&darr;</span>
        {downCount > 0 ? (
          <span className="font-mono text-[11px] tabular-nums">{downCount}</span>
        ) : null}
      </button>
    </div>
  );
}
