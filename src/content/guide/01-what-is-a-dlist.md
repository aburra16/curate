---
title: What is a DList?
summary: A DList is a list that anyone can add to, and this page explains how one is put together and who decides what you see.
---

A DList is a list that anyone can add to.

Most lists belong to one person. You make a list, and only you can change what is on it. A DList works differently. One person starts the list and says what it is about. After that, anyone can add an entry to it.

The "D" stands for "decentralized". It means the list is not kept in one place, and nobody owns all of it.

## An example: favourite coffee shops

Say you want a list of good coffee shops in your city. You start a DList called "coffee shops", and you say what each entry should hold: a name, a website and an address.

Then other people add the places they love. One person adds Corner Press. Another adds Blue Door. You did not have to approve them, and each entry stays with the person who added it.

## The two parts of a DList

Every DList is made of two kinds of piece: one header, and any number of items. An item is one entry on the list. From here on, this guide calls entries items, as Curate does.

- **The header** describes the list. It holds the list's names, a short description and the fields each item has. The names come in two forms: one for a single item ("coffee shop") and one for many ("coffee shops"). A field is one piece of information about an item, such as its name, its website or its address. One person writes the header.
- **The items** hold the facts for one entry each, such as a coffee shop's name and address, and point back at the list they belong to. Anyone can write an item.

## Where a DList lives

The header and every item live on nostr, an open way for apps to share short messages. Each message is called an event. Every event is signed by its author, which means it carries a mark that only the author can make. Anyone can check the mark, so anyone can tell who wrote an event and see that nobody has changed it.

Events are kept on relays. A relay is a server, a computer on the internet that stores events and hands them to any app that asks. Many relays exist, and several can hold the same event.

So nobody owns the whole list. The header sits on relays, and so does every item. Any app that understands DLists can read them. Curate is one such app.

The rules for DLists are written down in a public document called the [Decentralized Lists NIP](https://nostrhub.io/naddr1qvzqqqrcvypzpef89h53f0fsza2ugwdc3e54nfpun5nxfqclpy79r6w8nxsk5yp0qythwumn8ghj7erpwe5kgtnwdaehgu339e3k7mf0qqfkgetrv4h8gunpd35h5ety94kxjum5wv4px7v6). A NIP is a "nostr implementation possibility", a short public description of how part of nostr works. You do not need to read it to use Curate.

## Editable or fixed

A header or an item comes in one of two forms. An editable one can be replaced later: its author publishes a newer copy, and apps show the latest one. A fixed one stays exactly as it was signed.

Curate makes the editable form. If you spot a typo in an item you added, you can fix it.

## Who decides what you see

Anyone can add to a DList, so something has to decide which items are worth showing you. It is not the person who wrote the header. That person does not approve items, and cannot remove other people's. Curate uses a web of trust instead.

A web of trust is a way to work out which accounts to trust, based on who trusts whom.

On a list's page, Curate shows the items added by accounts inside your web of trust. It folds the others away under a line such as "3 more from accounts outside your web of trust". Nothing is deleted. You can open the line and read them.

To see everything at once, turn on the "Show everything" switch in the top bar. Curate then shows every item, and marks the ones from outside your web of trust with the label "outside your web of trust".

Whose web of trust is it? If you have not connected, Curate uses the default one from [Brainstorm](https://brainstorm.world), the service Curate is built on. If you connect a signer, Curate uses your own web of trust when an app has set one up for your account, and Brainstorm's when none has. Curate can't set one up itself. A signer is a small program that holds your nostr key, the secret that proves who you are, and signs for you.

## More lists you could make

A DList can hold anything that a few short facts can describe.

- A list of coffee shops, each with a name, a website and an address.
- A list of books, each with a title, an author and a link.
- A list of GitHub accounts worth following, each with a username and a link.
- A list of songs, each with a title, an artist and a link to hear it.

That is the whole idea. One person describes a list, anyone can add to it, and your web of trust decides what you see. The next pages show you how to find lists in Curate, read them, add to them and make your own.

Next: [Finding and reading lists](/guide/exploring-lists).
