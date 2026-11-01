---
title: For developers and AI agents
summary: The kinds and tags behind a DList, example events as Curate writes them, filters for reading lists from relays, and how to answer questions about a list.
---

This page is for people who build on DLists, and for AI assistants explaining a list to someone. It assumes you know nostr's basics: events, tags, kinds and relays, as NIP-01 describes them. The rules for DLists are in the [Decentralized Lists NIP](https://nostrhub.io/naddr1qvzqqqrcvypzpef89h53f0fsza2ugwdc3e54nfpun5nxfqclpy79r6w8nxsk5yp0qythwumn8ghj7erpwe5kgtnwdaehgu339e3k7mf0qqfkgetrv4h8gunpd35h5ety94kxjum5wv4px7v6). Curate's source is on [GitHub](https://github.com/aburra16/curate).

## The kinds

| Kind | What it is | Editable? |
| --- | --- | --- |
| 39998 | A list header | Yes: addressable, at `39998:<pubkey>:<d>` |
| 9998 | A list header | No: named by its event id |
| 39999 | A list item | Yes: addressable, at `39999:<pubkey>:<d>` |
| 9999 | A list item | No: named by its event id |
| 7 | A vote on an item (a NIP-25 reaction) | |
| 5 | A deletion request (NIP-09) | |

Curate writes kinds 39998, 39999, 7 and 5. It reads headers and items of all four kinds, and votes. It doesn't read deletions itself: a relay that honours one stops sending what it deletes.

A 39999 or 9999 is a header, not an item, when it says so: `["z", "list"]`, which is the NIP's nonstandard way to declare a list, or a `z` naming an address that ends in `:concept-header`, which is a convention Curate shares with Brainstorm. Curate reads both as headers.

## A header's tags

| Tag | Meaning |
| --- | --- |
| `["d", "coffee-shops"]` | The list's short name. With the kind and the author's public key, it makes the list's address. |
| `["names", "coffee shop", "coffee shops"]` | The singular and plural names. The NIP requires this tag. |
| `["description", "…"]` | What belongs on the list. |
| `["required", "name", "The shop's name"]` | A field every item must fill in. The second element is the item tag the field is read from. |
| `["recommended", "website", "Its website"]` | A field items should fill in. |
| `["optional", "address", "Street address"]` | A field items may fill in. The NIP's word for this is `allowed`, which Curate reads the same way. |
| `["field-type", "website", "url"]` | The type of a declared field: `url`, `tel`, `email` or `address` (another event's `kind:pubkey:d` or `naddr`). A field with no `field-type` is `text`. |
| `["b", "39998:<pubkey>:coffee-shops", "pointer"]` | The concept this header is a version of. A header that points at its own address puts itself forward as a shared concept. |
| `["b", "b-tag-deferred"]` | A withdrawn version: it belongs to no concept. |
| `["client", "Curate"]` | The app that signed it (NIP-89). Curate puts this on every event it signs. |

A field tag may carry a third element, a short description for people. Curate writes it when the author gives one, and an app that doesn't know it can ignore it.

Which of these are in the NIP:

- **In the NIP:** `names`, which it requires, `description`, which its examples use, and the field tags `required`, `allowed`, `recommended` and `disallowed`. The `d` tag on an editable header comes from NIP-01.
- **Not in the NIP:** `optional`, `field-type`, `b`, `display`, `image` and `link`. These are conventions Curate shares with Brainstorm, and an app that doesn't know them can ignore them. Curate ignores the NIP's `disallowed`.

The `display`, `image` and `link` tags say how items are drawn: which field is the title, the list's picture, links built from a field. Curate reads them and keeps them when a list is edited, but its form doesn't write them. On a list without them, an item's title is its first required field, and its summary is a field called `summary` or `description`.

## An item's tags

| Tag | Meaning |
| --- | --- |
| `["d", "corner-press-3f9a1c2e"]` | The item's own short name: its title in lower case with hyphens, then eight random hex characters, so two items never share an address. |
| `["z", "39998:<pubkey>:coffee-shops"]` | The list it belongs to: the header's address, or a 9998 header's event id. |
| `["name", "Corner Press"]` | One tag for each field that has a value, named after the field. |
| `["alt", "coffee shop: Corner Press"]` | A plain-words summary for apps that don't know the kind (NIP-31). |
| `["client", "Curate"]` | The app that signed it. |

In Curate, an item is filed under the version of the list its author was reading, so a list's items are those whose `z` names the community header or any version of it.

## Example events

These are shaped exactly as Curate builds them. The `id`, `pubkey`, `created_at` and `sig` are placeholders.

A new list, from the "Create" form:

```json
{
  "id": "<event id>",
  "pubkey": "<author pubkey>",
  "created_at": 1793491200,
  "kind": 39998,
  "content": "",
  "tags": [
    ["d", "coffee-shops"],
    ["names", "coffee shop", "coffee shops"],
    ["description", "Coffee shops worth crossing town for."],
    ["required", "name", "The shop's name"],
    ["recommended", "website", "Its website"],
    ["field-type", "website", "url"],
    ["optional", "address", "Street address"],
    ["b", "39998:<author pubkey>:coffee-shops", "pointer"],
    ["client", "Curate"]
  ],
  "sig": "<signature>"
}
```

An item on it:

```json
{
  "id": "<event id>",
  "pubkey": "<item author pubkey>",
  "created_at": 1793491500,
  "kind": 39999,
  "content": "",
  "tags": [
    ["d", "corner-press-3f9a1c2e"],
    ["z", "39998:<list author pubkey>:coffee-shops"],
    ["name", "Corner Press"],
    ["website", "https://cornerpress.example"],
    ["address", "12 Mill Lane"],
    ["alt", "coffee shop: Corner Press"],
    ["client", "Curate"]
  ],
  "sig": "<signature>"
}
```

An up vote on that item. A down vote is the same with `"content": "-"`:

```json
{
  "id": "<event id>",
  "pubkey": "<voter pubkey>",
  "created_at": 1793491800,
  "kind": 7,
  "content": "+",
  "tags": [
    ["e", "<item event id>", "wss://dcosl.brainstorm.world"],
    ["a", "39999:<item author pubkey>:corner-press-3f9a1c2e", "wss://dcosl.brainstorm.world"],
    ["p", "<item author pubkey>"],
    ["k", "39999"],
    ["client", "Curate"]
  ],
  "sig": "<signature>"
}
```

The item's author deleting it names the id of each copy of the item that Curate knows of, then the item's address and kind:

```json
{
  "id": "<event id>",
  "pubkey": "<item author pubkey>",
  "created_at": 1793492100,
  "kind": 5,
  "content": "",
  "tags": [
    ["e", "<item event id>"],
    ["a", "39999:<item author pubkey>:corner-press-3f9a1c2e"],
    ["k", "39999"],
    ["client", "Curate"]
  ],
  "sig": "<signature>"
}
```

Someone else's version of the list, made with "Make my own version", is a 39998 signed by them, at the same `d` unless they already use it. It carries the names, description and fields they chose, and `["b", "39998:<list author pubkey>:coffee-shops", "pointer"]`. "Withdraw my version" replaces it with a 39998 at the same `d` whose tags are only `["d", "coffee-shops"]`, `["b", "b-tag-deferred"]`, `["alt", "A withdrawn concept copy: considered, and affiliated with no community concept."]` and `["client", "Curate"]`.

## How votes are counted

- Each person's latest kind 7 on an item counts, found by the item's `e` or its `a`. Because an edit changes an item's id, the `a` is what carries votes from one edit to the next.
- `"+"` is up, `"-"` is down, and an empty content counts as up. Anything else, such as an emoji, is not a vote.
- Only voters inside the reader's web of trust are counted. Curate doesn't read deletions of votes.

## Reading from relays

Curate reads lists from `wss://dcosl.brainstorm.world`, the list relay. Brainstorm's search index, `wss://search.brainstorm.world`, also holds lists, answers NIP-45 counts and NIP-50 search, and only answers a filter that carries a `search` field. Curate adds `include:spam` to every filter it sends to the index, and reads both relays at once. It also reads the tag hub, `wss://tags.brainstorm.world/relay`, for the Dictionary and for the URL templates some lists build links from.

Every list header:

```json
[
  { "kinds": [39998, 9998] },
  { "kinds": [39999, 9999], "#z": ["list"] }
]
```

A relay can't match the end of a tag value, so the 39999 and 9999 headers whose `z` ends in `:concept-header` need a second round: take the 39998 events with `["d", "concept-header"]` from the first answer, and ask for `{ "kinds": [39999, 9999], "#z": [<their addresses>] }`.

One list's header, and every version of it:

```json
[
  { "kinds": [39998], "authors": ["<list author pubkey>"], "#d": ["coffee-shops"] },
  { "kinds": [39998, 9998, 39999, 9999], "#b": ["39998:<list author pubkey>:coffee-shops"] }
]
```

The items, filed under the community header or any version (add each version's address to `#z`). For a 9998 header, ask by its event id in both `#z` and `#e`:

```json
{ "kinds": [39999, 9999], "#z": ["39998:<list author pubkey>:coffee-shops"] }
```

The votes on items, by address and by id:

```json
[
  { "kinds": [7], "#a": ["39999:<item author pubkey>:corner-press-3f9a1c2e"] },
  { "kinds": [7], "#e": ["<item event id>"] }
]
```

Keep only the newest event at each address. Curate also ignores blank events: an event with empty content and no tags that say anything, which some apps publish in place of a deletion.

## What an event is connected to

The "Relationships" tab reads these, from the list relay and the tag hub, never the search index. Each is a filter for one event, asked by its id, and by its address too when it has one:

- **Copies of an item:** `{ "kinds": [39999], "#q": ["<item address>", "<item event id>"] }`. A copy is a 39999 whose `d` starts with `copy-` and whose `q` names the item.
- **Items that mention it:** `{ "kinds": [39999, 9999], "#e": ["<event id>"] }` and `{ "kinds": [39999, 9999], "#a": ["<address>"] }`. Copies and taggings are left out, and so are a header's own items.
- **The lists it is on:** the headers its `z` tags name, read by address or by id. An item with no `z` at all is filed under the 9998 list its first `e` names, as a 9998 list is named by its header's id.

Copies and mentions by accounts outside the reader's web of trust are folded, and only for accounts the scoring service answered for. A tagging counts only when its author is inside it; it is not folded.

### How tags are counted

`{ "kinds": [39999], "#e": ["<event id>"] }` and `{ "kinds": [39999], "#a": ["<address>"] }` find the candidate taggings. Curate counts a candidate like this:

1. A tagging names its tag's header in a `z` of the form `39999:<pubkey>:tagging:<slug>-tagging`. Read the header at that address. A tagging whose header can't be read counts for nothing.
2. The header is honoured only if one of its `z` tags is `39998:<pubkey>:tagging-with-specific-tag`, where `<pubkey>` is `82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833` or `a68dbf561cfe3da1b76f1e65c7d4d9cc116f79921b38a815fd75cb5460b4b599`. That is the honoured namespace. A tagging under any other namespace counts for nothing.
3. The header's `a` is `39999:<tag author pubkey>:<slug>`, the address of the tag's own element. That names the tag. Read the element at that address for the name to show: its `name` tag, else its `names` tag, else the name in its JSON content (`{"tag":{"name":"Cosy"}}`), else the slug.
4. The tagging's `polarity` tag says which way it goes. A value of 0.5 or more, or no `polarity` tag, applies the tag. A value of -0.5 or less disputes it. Anything between counts for nothing.
5. Each person counts once, by their latest tagging of that tag on that event, and only people inside the reader's web of trust count.

Separately, the reader's own latest stance is shown ("you applied", "you disputed") whether or not they are inside their web of trust.

## Whose web of trust

Curate takes trust scores from the service a person's kind 10040 names in its `30382:rank` row, and reads those scores as kind 30382 events (NIP-85 trusted assertions). A person who names none, and anyone not signed in, gets the service Brainstorm's own account names. An author scored at or above the line Brainstorm calls verified is inside the web of trust. Curate never shows a score.

The same kind 10040 names a person's Assistant for lists: the service in its `39998:dlist-header` row (or a bare `39998` row), or failing that its `30382:rank` service. A person's own version of a list comes first, then their Assistant's, then Brainstorm's, then the community header.

## What "saved" means in Curate

A write is saved when the list relay accepts it. Curate also sends it to at most four of the author's own write relays, from their NIP-65 relay list (kind 10002), and waits only about a second and a half for them. It never sends to the search index. If the list relay refuses, Curate shows the relay's words and can resend the same signed event.

## Curate's addresses

- A list: `https://curate.brainstorm.world/list?c=<address>`, where the address is `39998:<pubkey>:<d>`, an `naddr`, or a header's event id.
- One version of it: add `&version=<author pubkey>`.
- An item's panel: add `&item=<item address or event id>`.
- The header's panel: add `&event=header`.

## For AI agents: answering a question about a list

When a person asks you about a list, work from the events, and describe Curate's screens with the words this guide quotes.

1. **Find the list.** A Curate link carries it in `c`. Read the header at that address.
2. **Say what it is.** The plural in `names` is its name, and `description` says what belongs. The `required`, `recommended`, `optional` and `allowed` tags are its fields, each with its description and its `field-type`.
3. **Check for versions.** Ask for headers whose `b` names the list's address. If there are several, the person sees their own version first, then their Assistant's, then Brainstorm's, then the community header. Their fields can differ.
4. **Read the items.** Ask for kinds 39999 and 9999 whose `z` names the list or any version. Keep the newest per address, and drop blank ones. Each item's fields are tags named after the header's fields. Tags the header doesn't declare are extras, which Curate shows under "Outside this list’s definition".
5. **Remember the web of trust.** The person may not see every item. Items from accounts outside their web of trust are folded under a line such as "3 more from accounts outside your web of trust", and only votes from inside it are counted. Counts marked "counted before the web-of-trust filter" include everyone.
6. **Point to the right button.** You can't sign for the person. To add an item they press "+ Add" and the list's singular name; to make a list, "Create"; to change a version, "Make my own version", "Edit my version", "Edit list" or "Withdraw my version". The other pages of this guide explain each one.

Next: [Glossary and questions](/guide/glossary-and-faq).
