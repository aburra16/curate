---
title: Adding, editing and deleting items
summary: Add an item to any list that declares fields, change the items you added, and delete them, including what deleting means on nostr.
---

Anyone can add an item to a DList, including lists other people made. An item is an event, one signed message on nostr, the open network DLists live on. Curate saves it to relays, the servers that store nostr events. You need to be connected to write. The page [Connecting to write](/guide/signing-in) shows how.

## Adding an item

Open the list, say coffee shops, and press "+ Add coffee shop" above the items. If you are not connected, the button says "Connect to add a coffee shop", and pressing it opens the Connect chooser.

A form called "Add coffee shop" opens. It has one box for each field the list declares, labelled with the field's name. The required fields come first, then the recommended ones, then the optional ones. Under each box, a line says which it is and gives the list's description of the field, such as "Required · The shop's name".

Fill in the boxes. For Corner Press:

- name: Corner Press
- website: https://cornerpress.example
- address: 12 Mill Lane

As you type, Curate runs Brainstorm's checks on the item, the same rules Brainstorm holds items to. A required field left empty stops the item from publishing, and says so in red. Other notes are shown in grey and don't stop it. For example, if the website box holds something that isn't a web address, a note says it isn't an http(s) URL, meaning a web address that starts with http:// or https://.

When every required field has something in it, press "Publish". Your signer asks you to approve, and the button says "Publishing…". "Cancel" closes the form without publishing.

- **Saved.** The list relay, dcosl.brainstorm.world, accepted the item. The form closes, and the item appears in the list. If some of your own relays missed it, a short notice names them. The item is saved all the same.
- **Not saved.** The list relay refused it. Curate shows "Not saved to the list relay:" followed by the relay's reason, and a "Retry" button that sends the same signed item again. If you change anything in the form first, "Retry" goes away, and the next "Publish" signs the item as you see it now.

Your item stays yours. It is signed by you, and nobody else can change or delete it.

On a list made in Curate, an item's title is its first required field, here the name. If a list has several versions, the item is filed under the version you are looking at, and it shows on the list's page whichever version people read. The page [Shared concepts and your own version](/guide/versions) explains versions.

## Editing your own items

Items you added have an "Edit" button. Press it, and a form called "Edit coffee shop" opens with the item's fields filled in.

Change what you like and press "Publish". Curate changes only the fields you changed. Everything else the item carries stays exactly as it was, including anything the list's fields don't cover. Clearing a box removes that field from the item.

An edit publishes a new version of the item at the same address, and apps show the newest. Votes cast in Curate stay with the item, because they point at the item's address as well as at the version voted on.

Some items are fixed: they were published in the form that can't be replaced (kind 9999). They have no "Edit" button, only "Delete". Every item Curate writes is the editable kind.

## Deleting your own items

Items you added have a "Delete" button. Press it, and Curate asks: "Delete this coffee shop? Relays that honour deletions will drop it." Press "Delete" to go ahead, or "Cancel".

Deleting on nostr works differently from deleting a file. Curate publishes a deletion request: a signed event that names your item and asks relays to drop it. NIP-09 is the public description of how this works.

- Relays that honour deletions drop the item.
- A relay may ignore the request, so a copy can survive somewhere.
- An app or person that already saved a copy may still have it.

Curate's request names every version of the item you made, and its address, so no older version comes back. Once the list relay has saved the request, the item leaves the list.

You can only delete items you added. You can't remove other people's items from a list. If you think an item doesn't belong, vote it down: see [Whose items you see, and how votes count](/guide/trust-and-votes).

## Lists Curate can't add to

Some lists say nothing about what their items hold. Curate's form is built from a list's fields, so on such a list it says "This list declares no fields, so there is nothing for Curate's form to fill in." There is no "+ Add" button, and no "Edit" or "Delete" on its items. Another app that understands that list may be able to add to it.

Next: [Shared concepts and your own version](/guide/versions).
