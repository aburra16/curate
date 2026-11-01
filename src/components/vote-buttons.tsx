"use client";

import { useRef } from "react";
import { PublishOutcome } from "@/components/publish-outcome";
import { useSettled } from "@/hooks/use-settled";
import { useWrite } from "@/hooks/use-write";
import { applyVote, voteTemplate, type ReactionCount, type Vote } from "@/lib/curate/writeTemplates";
import { cn } from "@/lib/utils";
import type { ItemEvent } from "@/services/concepts";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";

interface Props {
  /** The row's own event: the vote names it, and no list. */
  item: ItemEvent;
  /** The votes read for the item, and the reader's own among them (`loadReactions`). */
  count: ReactionCount;
  /** The reader is one of the people the count is made of, so their vote moves it. */
  readerCounts: boolean;
  /** The list relay has the reader's vote; handed the count it leaves. */
  onVoted: (next: ReactionCount) => void;
}

/** What each side looks like: its mark, its words, and its colours while it is the reader's vote. */
const SIDES = {
  "+": {
    mark: "↑",
    words: "Upvote",
    pressed: "border-green-500/40 text-green-400 bg-green-500/5",
    idle: "border-rule text-mute enabled:hover:text-green-400/60 enabled:hover:border-green-500/30",
  },
  "-": {
    mark: "↓",
    words: "Downvote",
    pressed: "border-red-500/30 text-red-400 bg-red-500/5",
    idle: "border-rule text-mute enabled:hover:text-ink-soft enabled:hover:border-rule-strong",
  },
} as const;

function Side({
  vote,
  votes,
  pressed,
  disabled,
  title,
  onClick,
}: {
  vote: Vote;
  votes: number;
  pressed: boolean;
  disabled: boolean;
  title: string;
  onClick: () => void;
}) {
  const side = SIDES[vote];
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2 py-1 text-[12px] border transition-all duration-150",
        "disabled:opacity-60 disabled:cursor-default",
        pressed ? side.pressed : side.idle,
      )}
      style={{ borderRadius: "var(--radius-input)" }}
    >
      <span aria-hidden className="text-[14px] leading-none">
        {side.mark}
      </span>
      <span className="sr-only">{side.words}</span>
      {votes > 0 ? <span className="font-mono text-[11px] tabular-nums">{votes}</span> : null}
    </button>
  );
}

/**
 * Up and down votes on an item: the counts the page read, the reader's own
 * vote marked, and the buttons that write a vote (a reaction naming the item,
 * with "+" or "-" as its content). A click on the vote the reader already
 * holds sends nothing. A vote counts once the list relay has it, and a toast
 * names any of the author's own relays that missed it. Beneath the buttons, a
 * vote the list relay didn't take says so with Retry, until the next vote.
 * Signed out, a click invites the reader to connect.
 */
export function VoteButtons({ item, count, readerCounts, onVoted }: Props) {
  const signedIn = useSigner((s) => s.status === "connected");
  const { state, busy, write, retry } = useWrite();
  /** The vote last sent, for Retry to count. */
  const sent = useRef<Vote | null>(null);
  const settled = useSettled(() => {
    if (sent.current) onVoted(applyVote(count, sent.current, readerCounts));
  });

  const vote = async (next: Vote) => {
    if (next === count.mine) return;
    const result = await write(voteTemplate(item, next));
    if (!result) return;
    sent.current = next;
    settled(result);
  };

  const again = async () => settled(await retry());

  // A saved vote needs no word here; the signer's failure and the list relay's refusal do.
  const speaks = state.phase === "error" || (state.phase === "done" && !state.result.onHub);
  const disabled = busy;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {(["+", "-"] as const).map((side) => (
          <Side
            key={side}
            vote={side}
            votes={side === "+" ? count.up : count.down}
            pressed={count.mine === side}
            disabled={disabled}
            title={signedIn ? SIDES[side].words : "Connect to vote"}
            onClick={() => (signedIn ? void vote(side) : useConnectDialog.getState().show())}
          />
        ))}
      </div>
      {speaks ? (
        <div className="max-w-xs text-right">
          <PublishOutcome state={state} busy={busy} onRetry={() => void again()} />
        </div>
      ) : null}
    </div>
  );
}
