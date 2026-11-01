---
title: Shared concepts and your own version
summary: Many lists can be versions of one shared idea. Which version you see, how to make and edit your own, and what withdrawing it does.
---

## One idea, many versions

A concept is one idea, such as "coffee shops". Several lists can be versions of the same concept, each written by a different person.

Say you made the coffee shops list from [Creating a list](/guide/creating-a-list), with a name, a website and an address. Someone else likes it but wants each shop's opening hours too. They make their own version of coffee shops, with an extra field. Both lists are now versions of one concept.

A version doesn't split the list. Items added under any version show together on the concept's page, and votes on them count in the same place. What changes from version to version is how the list is described: its names, its description and its fields.

The header that started the concept is called the community header. Every list made with Curate's "Create" form starts a concept of its own, with its header as the community header. On Discover, a concept is one card, and the card says "3 versions" (or another number) when it has more than one.

## Which version you see

When you open a list, Curate picks one version to show, in this order:

1. **Your own version**, if you have made one.
2. **Your Assistant's version**, if you have an Assistant and it has made one. An Assistant is a service your nostr account names to act on your behalf, often the same service that works out your web of trust.
3. **Brainstorm's version**, if Brainstorm has made one. Brainstorm is the service Curate is built on.
4. **The community header** itself.

If you are not connected, you see Brainstorm's version where there is one, and the community header otherwise.

The line under the list's name says which one you are reading: "Your version", "Your Assistant’s version", "Brainstorm’s version" or "The community header". Next to it, a sentence compares it with the community header, such as "Agrees with the community header." or "Differs from the community header in its fields."

## Reading another version

When a list has several versions, a menu such as "3 versions" sits under its name. It lists each version by its author, with a label:

- "community": the community header;
- "yours": your own version;
- "assistant": your Assistant's;
- "house": Brainstorm's own;
- "copy": anyone else's.

Choose one to read it. Unless you chose the community header, the line then says "A selected version". "Show the version that applies to me" takes you back to the one Curate picked for you.

On Discover, turn on "Show everything" to see each concept's other versions listed under its card.

## The buttons

When you are connected, the buttons under a list's name depend on whose list it is.

### "Make my own version"

This appears on a list someone else made, when you have no version of it yet. It opens a form headed "Make my own version", filled in with the list as it stands: "Singular name", "Plural name", "Description" and "Fields". Change what you like, then press "Publish". If you change nothing, your version is an exact copy, and the page says it agrees with the community header.

Curate saves your version at the same short name as the community header. A short name is the part of a list's address that its author chooses. If you already have a list with that short name, Curate picks a free one instead, so your list isn't replaced, and tells you, for example: "You already have a list with the short name “coffee-shops”, so your version is saved as “coffee-shops-2”." While it checks your lists, it says "Looking at your lists to choose a short name…". If it can't reach the list relay, it holds "Publish" and says "Couldn't check your lists. Try again." with a "Try again" button.

Once saved, Curate shows your version.

### "Edit my version"

This appears when you have a version of the list, but another version is on show. It opens a form headed "Edit my version", filled in with your version.

### "Edit list"

This appears when the list on show is one you wrote: your own list, or your own version. It opens a form headed "Edit list".

- You can change the names, the description and the fields. A list needs at least one field, and the form says "Add at least one field." until it has one.
- The short name stays as it is.
- Anything the form doesn't show, such as a picture or links set up in another app, is kept.
- Renaming a field doesn't change items already added. They keep the old name, and their value then shows under "Outside this list’s definition" in the item panel.

### "Withdraw my version"

This appears when you have a version of someone else's list. Curate asks first: "Withdraw your version of coffee shops? It will stop counting as a version of this concept." Press "Withdraw" to go ahead, or "Cancel".

Withdrawing doesn't delete anything. Curate replaces your version with a new one at the same address, which says that it belongs to no concept. After that:

- your version no longer counts as a version of the concept, and you see the next version in line;
- items that were filed under your version no longer show with the concept;
- a link to your version still opens it, as "A header on its own", marked "withdrawn";
- you can make a new version later with "Make my own version".

Curate replaces rather than deletes because a deletion is only a request that relays may ignore (see [Adding, editing and deleting items](/guide/adding-items)), while a replacement takes the old version's place, as nostr's rules for editable events say it should.

## Saving

Every one of these changes is saved the way any write is. Your signer asks you to approve. Once the list relay, dcosl.brainstorm.world, accepts the change, the form closes and the page shows it. If the list relay refuses, Curate shows "Not saved to the list relay:" with its reason and a "Retry" button.

Next: [For developers and AI agents](/guide/for-developers).
