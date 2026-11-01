---
title: Whose items you see, and how votes count
summary: Your web of trust decides which items a list shows you and whose votes count, and this page explains whose web of trust Curate uses and how voting works.
---

Anyone can add an item to a DList. That is the point of one, and it also means a list can collect items you would not want to see. Curate uses your web of trust to sort them.

## What a web of trust is

A web of trust is a way to work out which accounts to trust, based on who trusts whom. A scoring service works out a score for each account from the point of view of one person, and publishes the scores on nostr, the open network DLists live on, for apps to read.

Curate reads the score of each person who added an item or voted. An account whose score reaches a set line is inside your web of trust. An account below the line is outside it.

Curate never shows anyone's score. A score only decides what is shown and what is counted.

## Whose web of trust Curate uses

- **If you have not connected,** Curate uses Brainstorm's default scores. Brainstorm is the service Curate is built on, at [brainstorm.world](https://brainstorm.world).
- **If you have connected,** Curate uses the scoring service your own nostr account names, if it names one. This is your own web of trust. If your account names none, Curate uses Brainstorm's default scores.

The page [Connecting to write](/guide/signing-in) explains connecting.

## What it changes

On a list's page:

- items from accounts inside your web of trust are shown;
- items from accounts outside it are folded under a line such as "3 more from accounts outside your web of trust". Click the line to open them. Nothing is deleted;
- if the scoring service does not answer about an account, Curate shows that account's items rather than hide them. An account the service answers for but has no score for counts as outside.

The "Show everything" switch in the top bar turns the folding off. Every item is then shown, and the ones from outside your web of trust are marked "outside your web of trust".

The counts on Discover, and the count at the top of a list, are not filtered. They include items from everyone, which is why they say "counted before the web-of-trust filter".

Votes are filtered too, as the next section explains.

## Votes

Each item has two vote buttons: an up arrow, "↑", and a down arrow, "↓". Screen readers call them "Upvote" and "Downvote".

- The number beside each arrow is how many people inside your web of trust voted that way. A side with no votes shows no number.
- Only each person's latest vote on an item counts.
- Your own vote is highlighted.
- To change your vote, click the other arrow. Clicking the vote you already hold does nothing.
- Curate has no way to take a vote back. You can only switch it.
- Your own vote moves the numbers only if you are inside your own web of trust. Either way, it is highlighted for you.

A vote is a small public event, called a reaction, that points at the item. An event is one signed message on nostr. An up vote says "+" and a down vote says "-". Anyone can see who voted and how.

To vote you need to be connected. If you are not, a vote button opens the Connect chooser.

A vote counts once the list relay has saved it. A relay is a server that stores nostr events, and the list relay is the one Curate saves every change to: dcosl.brainstorm.world. If the list relay refuses it, a note under the buttons says "Not saved to the list relay:" followed by the relay's reason, with a "Retry" button that sends the same vote again.

## Why the list's author doesn't decide

The person who wrote a list's header does not approve items, and cannot remove other people's. What you see depends on your web of trust, not on theirs. Two people can open the same list and see different items, and that is how DLists are meant to work.

Next: [Connecting to write](/guide/signing-in).
