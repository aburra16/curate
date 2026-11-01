---
title: Glossary and questions
summary: The words this guide uses, each in a sentence or two, and answers to common questions, from getting started and cost to deleting and missing items.
---

## Glossary

**Nostr.** An open way for apps to share short signed messages through relays. Nobody owns it, and any app can read what is on it.

**Event.** One message on nostr. Every list header, item and vote is an event. Each is signed by its author.

**Kind.** A number on every event that says what sort of event it is. List headers are kind 39998 or 9998, items are kind 39999 or 9999, and votes are kind 7.

**Tag.** One labelled piece of an event, such as `["name", "Corner Press"]`. An item's fields are stored as tags.

**Relay.** A server, a computer on the internet that stores events and hands them to any app that asks. Many relays exist, and the same event can be on several.

**List relay.** The relay Curate saves every change to, and the main one it reads lists from: dcosl.brainstorm.world. A change counts as saved when the list relay accepts it.

**Key.** Your nostr key is a secret that proves who you are. Whoever holds it can write as you. Its other half, your public key, is your identity and is safe to share.

**npub.** Your public key written as text that starts with `npub1`. Curate shows a shortened npub for an account that has no name.

**Signer.** A small program that holds your key and signs for you. It can be a browser extension, or a remote signer.

**Browser extension.** A signer that lives in your web browser (NIP-07).

**Remote signer.** A signer that lives somewhere else, such as an app on your phone, and talks to Curate through relays (NIP-46).

**Bunker.** A remote signer you connect to by pasting a link that starts with `bunker://`.

**DList.** A decentralized list: a list one person describes and anyone can add to.

**List header.** The event that describes a list: its names, its description and its fields. One person writes it.

**Item.** One entry on a list, an event that points back at the list's header. Anyone can write one.

**Field.** One piece of information each item holds, such as a name or a website. A field is required, recommended or optional, and has a type.

**Short name.** The part of a list's address its author chooses, such as `coffee-shops`. It can't change once the list is published.

**Concept.** One idea, such as coffee shops, that several lists can be versions of.

**Community header.** The header that started a concept.

**Version.** One person's header for a concept, with their own names, description and fields. Items added under any version show together. In this guide, version always means this. Editing an item or a list doesn't make a version: it publishes a newer copy at the same address, and apps show the latest one.

**Assistant.** A service your nostr account can name to act for you. If it has made a version of a list, you see that version unless you have your own. Curate can't name one for you: it uses the one an app has published for your account.

**Dictionary.** The first group on Discover: shared lists published by curators whom Brainstorm has chosen.

**Web of trust.** A way to work out which accounts to trust, based on who trusts whom. In Curate it decides which items you see straight away and whose votes count. Curate uses the one an app has published for your account, or Brainstorm's default when there is none.

**Vote.** An up or down reaction to an item, a small public event. Only votes from people inside your web of trust are counted.

**Withdraw.** To take your version out of a concept. It is replaced, not deleted.

**Deletion request.** A signed event asking relays to drop something you wrote (NIP-09). Relays that honour it drop it; others may keep a copy.

**NIP.** A "nostr implementation possibility": a short public document that describes part of how nostr works. DLists are described in the [Decentralized Lists NIP](https://nostrhub.io/naddr1qvzqqqrcvypzpef89h53f0fsza2ugwdc3e54nfpun5nxfqclpy79r6w8nxsk5yp0qythwumn8ghj7erpwe5kgtnwdaehgu339e3k7mf0qqfkgetrv4h8gunpd35h5ety94kxjum5wv4px7v6).

## Questions

### I've never used nostr. How do I start?

To read lists, you need nothing: open Discover and look around. To add to a list or make one, you need a nostr key and a signer to hold it.

1. Install a nostr signer: a browser extension, or a signer app on your phone.
2. Let it make a new key for you. Most signers can.
3. Keep the backup it gives you somewhere safe. Nobody can recover your key for you.
4. Press "Connect" in Curate's top bar.

See [Connecting to write](/guide/signing-in).

### Is it free?

Curate doesn't charge anything, and it has no accounts of its own. Your nostr key is your identity. To write, you need a signer. Relays decide for themselves what they keep, and some have their own rules.

### Who can see my list?

Everyone. Lists, items and votes are public events on public relays. Anyone can read them, in Curate or in any other app that understands DLists. Don't put anything on a list that you want to keep private.

### Can I delete a list?

Not in Curate. Other people's items point at a list's header, so deleting it would leave their items with nothing to belong to. You can change your list with "Edit list". If it is your version of someone else's list, "Withdraw my version" takes it out of the concept. See [Shared concepts and your own version](/guide/versions).

You can delete items you added: see [Adding, editing and deleting items](/guide/adding-items).

### Why don't I see my item?

- **It may be folded.** If your account is outside the web of trust Curate is using, your item waits under a line such as "3 more from accounts outside your web of trust". Open the line, or turn on "Show everything".
- **A relay may be slow.** If a relay didn't answer, a line near the top of the page names it. Try again in a moment, or press "Load more".
- **It may not be loaded yet.** Curate loads items in pages. Press "Load more", or search for the item.
- **It may not have been saved.** Look for "Not saved to the list relay:" where you published it, and press "Retry".
- **A search may be hiding it.** Clear the search box above the items.

### Why does the count say more than I see?

A count marked "counted before the web-of-trust filter" includes items from everyone. The list shows the items from inside your web of trust and folds the rest. See [Whose items you see, and how votes count](/guide/trust-and-votes).

### Why does a list look different for someone else?

Two people can see different versions of a list, and different items. Each person sees their own version first, and each person's web of trust decides which items show. See [Shared concepts and your own version](/guide/versions).

### Does Curate see my private key?

No. Your signer holds your key and signs for you. Curate only receives the signed events and your public key. See [Connecting to write](/guide/signing-in).

### Can I use another app?

Yes. A DList and its items are nostr events, signed by the people who wrote them and kept on relays. Any app that understands DLists can read them, show them and add to them.

Back to the start: [What is a DList?](/guide/what-is-a-dlist)
