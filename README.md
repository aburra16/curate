# Curate

Curate is a browser for Decentralized Lists on nostr, with forms for building them. It reads lists the way
[Brainstorm](https://brainstorm.world) does, and signs what you write with your own nostr signer, a browser
extension or a remote one. There is no server and no account: the site is static files, and everything it
shows comes from relays.

## What it does

- **Discover** (`/`): the Dictionary's concepts first, then every other list, one card per concept with its
  item count. Copies of a concept sit under it, and withdrawn or blank headers stay out of the way, until
  you turn on "Show everything".
- **A list** (`/list?c=<coordinate>`): the version of the list that governs for you (your own copy, then
  your Assistant's, then Brainstorm's, then the community's), its fields, and its items as rows. Items from
  accounts outside your web of trust fold away behind one line. A row opens a panel with four views of the
  event: Item (the item drawn the way its list defines it, as Brainstorm's item page draws it: its picture,
  title, summary, links, facts, audio or video, and a map that loads only when you ask, drawn with MapLibre
  from OpenFreeMap's tiles on `map-tiles-server.brainstorm.world`), Pretty, Raw and Relationships (the lists
  the item is on, copies of it, the tags applied to it, the list items that mention it and what it names
  itself, read through your web of trust; copies and mentions from outside it fold away, and nothing is read
  until you open the tab). A list's header has Pretty, Raw and Relationships.
- **Create** (`/create`): make a list. The rest of writing (items, your own version of a list, votes)
  happens on the list's page; see "Writing" below.
- **Settings** (`/settings`): extra relays to read lists from.

Lists are read from `wss://dcosl.brainstorm.world` and, in parallel, the search index at
`wss://search.brainstorm.world`, which also answers counts. The Relationships tab reads the list relays and
the tag hub (`wss://tags.brainstorm.world/relay`) for tags, and never the search index. Trust ranks come from the `30382:rank`
provider your own kind 10040 names; signed out, or with none named, from the one Brainstorm's house names
in its kind 10040. A rank only decides what is shown and what is counted; Curate never shows anyone's rank.

## Writing

Reading never signs. To write, connect a signer with Connect in the header. Use a browser extension (nos2x,
Alby and the like), or a remote signer: scan the QR code with a signer app on your phone, or paste a
`bunker://` link. Curate asks the signer to sign each change and never sees your private key; the key stays
in the signer. A remote connection lasts until you disconnect or close the tab. If the signer switches
to another account while the page is open, Curate stops and asks you to connect again.

- **Create a list** (`/create`): a quick form for the list's names, a description, the fields each item
  holds and a short name. Brainstorm's checks run as you type, and Publish waits until none would stop the
  list. If a shared concept already goes by the same name, Curate asks first: make your own version of that
  concept, or offer a new shared concept anyway.
- **Add and edit items**: a list that defines fields shows an Add button, and its form is drawn from the
  list's own fields. Edit on an item you added opens the same form, and keeps every tag the item has. An
  item that cannot be replaced (kind 9999) has Delete only.
- **Your own version of a list**: on the page of a list someone else wrote, "Make my own version" copies
  it to your account. Your version keeps the original's short name, unless a list of yours already uses
  it: then it takes the next free one (`name-2`, `name-3`, and so on). "Edit my version" changes your copy,
  and "Withdraw my version" takes it back, so it stops counting as a version of that concept. A list you
  wrote yourself has "Edit list".
- **Delete your own items**: Delete asks first, then removes every version of the item that you made.
  Relays that honour deletions drop it. Items other people added are not touched.
- **Votes**: each row has an up and a down vote. Your own vote shows pressed; to change it, vote the other
  way.
- **Saved**: a change is saved when the list relay accepted it. Curate also sends it to at most four of
  the relays your own relay list (kind 10002) marks for writing, and a note says which of them missed it.
  If the list relay did not take it, Curate shows the relay's words and a Retry that sends the same event
  again. Nothing is written to the search index or the tag hub.

## Run it

You need Node.js 22.22.2 or a later 22, or 24.15.0 or later (`package.json` `engines`). `.nvmrc` picks 24.

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build         # static export into out/
npm run guide:export  # the guide's files for AI assistants, into public/
npm run lint
npx tsc --noEmit
```

`npm run dev` and `npm run build` first run `npm run guide:export`, which writes `llms.txt`, `llms-full.txt`, the guide's `.md` copies, `robots.txt` and `sitemap.xml` into `public/` from the pages in `src/content/guide`. Git doesn't keep those files. Run it again after you edit a guide page while `npm run dev` is running.

## Test it

```bash
npm test
```

`npm test` first runs `npm run vendor:check` (below), then the whole suite with Vitest. The tests run in
jsdom or Node over a pretend set of relays, and use real events saved from the relays in
`src/test/fixtures`.

## Vendored code

Curate does not reimplement Brainstorm's list code. It copies it from
[NosFabrica/Brainstorm-UI](https://github.com/NosFabrica/Brainstorm-UI): the Dictionary and concept
resolution, field and display rules, link templates and the like in `src/lib/`, with their tests, and the
shared `<built-on-brainstorm>` footer element (`src/lib/built-on-brainstorm.js`).

`vendor/brainstorm-ui.json` lists each copied file with its upstream path, its local path, the commit it
was taken at and its SHA-256. A vendored file is never edited here.

```bash
npm run vendor:check   # fails, naming the file, if any copy differs from its pin
npm run vendor:diff    # shows how each file differs on upstream's staging branch
npm run vendor:fetch   # downloads every file at its pinned commit and records its SHA-256
```

To take a newer version, move `commit` in the manifest (or a file's own `commit`) and run
`npm run vendor:fetch`. Fetching and diffing use the GitHub CLI (`gh`).

## Deploy

Curate builds as a static export (`output: "export"` in `next.config.ts`), so any static host serves it.
On Cloudflare Pages:

- Build command: `npm run build`
- Build output directory: `out`
- No environment variables and no server functions.

A list is addressed by its query string (`/list?c=...`), so one page serves every list.

## License

[GNU Affero General Public License, version 3](LICENSE). The vendored files are from Brainstorm-UI, which
is under the same license; see [NOTICE](NOTICE). The footer of the site links to this source.
