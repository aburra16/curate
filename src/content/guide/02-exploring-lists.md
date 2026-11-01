---
title: Finding and reading lists
summary: How to find a list on Discover, read its page, and open any item to see it the way its list describes it, every tag it carries, or the event as signed.
---

You can read every list in Curate without connecting anything. Reading never signs anything and needs no account.

## Discover

Discover is Curate's front page. You reach it from "Discover" in the top bar, next to "Create", "Guide" and "Settings".

It shows one card for each list. A card holds:

- the list's name, and its description if it has one;
- the account that made it, by the name on its nostr profile. Nostr is the open network DLists live on. An account with no name shows its NIP-05 address, a web-style name such as `alice@example.com`, or else a shortened form of its public key, the code that identifies an account, written as an npub;
- "3 versions" (or another number) when several people have made their own version of the list. The page [Shared concepts and your own version](/guide/versions) explains versions;
- how many items it holds, such as "12 coffee shops", followed by "counted before the web-of-trust filter".

That last note matters. The count includes items from everyone. On the list's own page, items from accounts outside your web of trust are folded away, so you may see fewer. Your web of trust is a way to work out which accounts to trust, based on who trusts whom. The page [Whose items you see, and how votes count](/guide/trust-and-votes) explains it.

The cards come in two groups:

- **"Dictionary"** comes first. These are shared lists published by curators whom Brainstorm, the service Curate is built on, has chosen.
- **"All lists"** holds every other list.

To find a list, type in the "Search lists..." box. It matches words in a list's names and description, in any order, and ignores capital letters and accents. Click a card to open the list.

## A list's page

Say you open the coffee shops list. At the top you see:

- the list's name, "coffee shops", and its description;
- whose version of the list this is, such as "Brainstorm’s version" or "The community header", then "by" and the author's name, and how long ago it was written;
- a sentence comparing it with the header that started the list, called the community header, such as "Agrees with the community header.";
- a menu such as "3 versions", when there are several. It lets you read another version;
- "View event", which opens the list's header itself, in the panel described under "An item's panel" below.

Under that is "Fields". It lists what each item on the list holds. Each field shows its name, whether it is required, recommended or optional, its type and its description. The type is usually one of these words:

| Type shown | What the field holds |
| --- | --- |
| text | Words |
| url | A web address |
| tel | A phone number |
| email | An email address |
| address | The address of another nostr event |

A list made in another app can use a type of its own, which Curate shows as written.

If a list says nothing about its fields, you see "This list declares no fields."

## The items

Below the fields come the items. The line above them gives a count, such as "12 coffee shops · counted before the web-of-trust filter".

You can:

- search the items with the box, such as "Search coffee shops...". It matches each item's title and summary;
- sort them with "Newest" or "A to Z".

Each item shows:

- its title. For a list made in Curate, the title is the first required field, such as the shop's name. An item with nothing in that field shows as "Untitled coffee shop";
- a short summary, when the list has a "summary" or "description" field;
- links, and a "Map" or "Map of the area" button, when the list is set up to show them. The map loads only when you ask for it;
- "Listed by", then who added it and how long ago;
- the up and down votes. See [Whose items you see, and how votes count](/guide/trust-and-votes).

New items that people add while you have the page open appear without a reload.

Curate reads items from relays, the servers that store nostr events, in pages of about 500. "Load more" fetches the next page. When very many items are loaded, Curate shows 500 at a time, and "Show more" shows the next 500.

## An item's panel

Click an item's title, or anywhere on its row, to open its panel. The panel opens at the side of the screen, or over the whole screen on a narrow one, such as a phone. At the top it gives the item's title and a line such as "Item · kind 39999". A kind is a number that says what sort of nostr event this is.

The panel has three tabs.

- **"Item"** shows the item the way its list describes it: the list's name, the item's title and summary, its picture, links, audio or video, and a "Show on map" button when the list gives places. If a required field is empty, a note says so, such as "Missing name. The list requires it." Fields not shown above wait behind a "More fields" button, which says how many there are. Anything the item carries that its list never asked for sits apart, under "Outside this list’s definition". The last line says which version of the list the item was read through.
- **"Pretty"** shows every tag the item carries. A tag is one labelled piece of an event, such as `["name", "Corner Press"]`. Each tag is marked "field" (a field the list declares), "protocol" (a tag nostr itself uses, such as the one that points at the list), "metadata" (such as the app that wrote it) or "undeclared". Tags that point at a list or at another event are links, and a tag that names a person shows their name. Under the tags, "Identity" gives the event's id and address with "Copy" buttons, and "Provenance" gives its author, its date, and the relays it was "Seen on".
- **"Raw"** shows the event exactly as it was signed, with a "Copy" button. This is the same text any other nostr app would see.

The panel has its own web address, so you can copy the page's address from your browser and share it. Press "Close", or the Escape key, to close it.

"View event", at the top of a list's page, opens the list's header in the same panel. A header has only "Pretty" and "Raw". Its "Pretty" tab adds "Concept", which says which shared list it belongs to. When a list has several versions, its "Raw" tab has a menu, "Copy of the concept", to show each version's own event.

## Show everything

The "Show everything" switch in the top bar shows what Curate otherwise keeps out of the way. Curate remembers the setting in your browser.

On a list's page, it turns off the folding. Items from accounts outside your web of trust are shown in the list, each marked "outside your web of trust". With the switch off, they wait under a line such as "3 more from accounts outside your web of trust", which you can click to open.

On Discover, it adds:

- each list's other versions, under its card, each marked "copy";
- versions their authors have withdrawn, marked "withdrawn";
- lists that have been emptied out, marked "blank";
- lists with no name at all, shown as "Untitled list".

## When a relay doesn't answer

Curate reads lists from relays. A relay is a server, a computer on the internet that stores nostr events and hands them to any app that asks. Curate always reads from dcosl.brainstorm.world, which Curate calls the list relay, and from Brainstorm's search index at search.brainstorm.world. Only the search index can count items.

If one of them does not answer, a line near the top of the page names it, for example: "No answer from the index (search.brainstorm.world). What's shown comes from the other relays, so counts are missing." The page carries on with what the other relays sent.

To read from more relays, open "Settings". Under "Extra relays to read lists from", type a relay's address, which starts with `wss://`, and press "Add". "Reset to defaults" takes the relays back to how they started.

Next: [Whose items you see, and how votes count](/guide/trust-and-votes).
