---
title: Creating a list
summary: Make your own DList in Curate: name it, say what each item holds, pick its short name, check the preview, and publish it as a shared concept.
---

This page walks through making the coffee shops list from [What is a DList?](/guide/what-is-a-dlist). A list is a signed message, called an event, on nostr, the open network DLists live on. Events are kept on relays, servers that hand them to any app that asks. You need to be connected to publish. The page [Connecting to write](/guide/signing-in) shows how.

Press "Create" in the top bar. The page is called "Create a new list", and it says: "Name what you are collecting and say what each item holds. You add the items once the list is published."

## The names

A list has two names.

- **"Singular name"** is what one item is called: "coffee shop".
- **"Plural name"** is what the whole list is called: "coffee shops".

Curate needs both because it uses each in its place. The plural is the list's title, on Discover and at the top of its page. The singular names one item, as in "+ Add coffee shop" or "Delete this coffee shop?".

## The description

"Description" is optional. Say what belongs on the list, such as "Coffee shops worth crossing town for."

## The fields

Under "Fields" you say what each item on the list holds. A field is one piece of information about an item. The form starts with one field, called "name", set to "Text" and "Required".

Each field has:

- a name, typed in the "Field name" box. It is one word with no spaces, such as `website` or `opening-hours`. The names `d`, `z` and `b` are taken, because they hold the list's own workings;
- a type, chosen from a menu;
- a requirement, chosen from a second menu;
- a short description, in the "Short description (optional)" box, which tells people what to put in it;
- a "×" button that removes the field.

"Add a field" adds another one. A list needs at least one field. Until it has one, the form says "Add at least one field."

### Types

| In the menu | What the field holds | On the list's page |
| --- | --- | --- |
| Text | Words | text |
| Link | A web address that starts with http:// or https:// | url |
| Phone | A phone number, which a phone can call | tel |
| Email | An email address | email |
| Address | The address of another nostr event | address |

"Address" does not mean a street address. It means the address of another nostr event, written as `kind:pubkey:identifier` or as an `naddr1…` string. For a coffee shop's street address, use "Text".

### Requirements

- **"Required"**: an item can't be published without it.
- **"Recommended"**: people should fill it in, but they can leave it out.
- **"Optional"**: people can leave it out.

When someone adds an item, Curate shows the required fields first, then the recommended ones, then the optional ones, and says beside each which it is.

### The coffee shop fields

| Field name | Type | Requirement | Short description |
| --- | --- | --- | --- |
| name | Text | Required | The shop's name |
| website | Link | Recommended | Its website |
| address | Text | Optional | Street address |

## The short name

"Short name" is part of the list's address. The page reminds you: "Part of the list’s address. It cannot be changed once the list is published."

Every list you make is stored at an address made of your public key and its short name. Curate fills the short name in from the plural name, in lower case with hyphens between the words: "coffee shops" becomes `coffee-shops`. It keeps following the plural name until you type in the box yourself.

Curate never picks a short name you already use. Publishing a list at the same address as one of yours would replace that list, and its items would then belong to the new one. So if you already have a list at `coffee-shops`, Curate picks `coffee-shops-2`, then `coffee-shops-3`, and so on. If you type a short name you already use, the form won't publish, and says:

> You already have a list with the short name "coffee-shops". Publishing would replace it.

To choose a short name, Curate first reads your lists from the relays it reads lists from: the list relay, dcosl.brainstorm.world, which Curate saves every change to, and any extra relays you added in Settings. While it reads, it says "Looking for lists that already exist…". If none of those relays answers, it holds "Publish" and says "Couldn't check your lists. Try again." Press "Try again" to ask again.

## The preview and the checks

"Preview" shows the list as its page will: its plural name, its description, a line such as "Each item is one coffee shop", and its fields with their requirements, types and descriptions.

As you type, Curate runs Brainstorm's checks on the list, the same rules Brainstorm itself holds lists to. Problems appear in place once you start. A problem shown in red stops the list from publishing. For example:

- "Give the concept a singular and a plural name."
- "Every field needs a name."
- "Not a field name: opening hours (no spaces; d, z and b are taken)."
- "Listed twice: website."

"Publish" waits until nothing would stop the list. If you are not connected, the button says "Connect to publish", and pressing it opens the Connect chooser.

## If a list by the same name exists

Every list made with this form is published as a shared concept: one idea, such as coffee shops, that other people can make their own versions of. The page [Shared concepts and your own version](/guide/versions) explains concepts.

So before it publishes, Curate looks for a list that already goes by either of your names. It compares names in lower case, without accents or punctuation, so "Cafés" and "cafes" match. If it finds one, pressing "Publish" shows "A shared concept called “coffee shops” already exists." and two buttons:

- **"Make my own version of coffee shops"** opens that list, with a form to make your own version of it. Your version shares the list's items and its card on Discover, and has the names, description and fields you choose.
- **"Offer a new shared concept anyway"** publishes your list as a separate concept.

Changing either name puts the choice away until you press "Publish" again.

## Publishing

Press "Publish". Your signer asks you to approve, and the button says "Publishing…".

Curate sends the list to the list relay, dcosl.brainstorm.world. It also sends it to your own relays: the relays your nostr account, the account your key signs for, lists for writing, up to four of them.

- **Saved.** The list relay accepted the list. Curate opens your new list at once. If some of your own relays missed it, a short notice names them, such as "Saved to the list relay. Not saved to 1 of your own relays: relay.example.com." The list is saved all the same.
- **Not saved.** The list relay refused it. Curate shows "Not saved to the list relay:" followed by the relay's reason, and a "Retry" button that sends the same signed list again. If you change anything in the form first, "Retry" goes away, and the next "Publish" signs the list as you see it now.

A brand new list is empty. The next page, [Adding, editing and deleting items](/guide/adding-items), shows how to fill it.

## What the form doesn't do

The form sets a list's names, description, fields and short name. It does not set up pictures, links built from a field, or a map. Lists made in other apps may have those, and Curate shows them.

Once published, a list can be changed with "Edit list" on its page (see [Shared concepts and your own version](/guide/versions)), but its short name stays. Curate can't delete a list: see [Glossary and questions](/guide/glossary-and-faq).

Next: [Adding, editing and deleting items](/guide/adding-items).
