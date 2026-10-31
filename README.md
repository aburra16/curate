# Curate

Curate is a browser for Decentralized Lists on nostr, with forms for building them. It reads lists the way
[Brainstorm](https://brainstorm.world) does, and signs what you write with your own nostr extension. There
is no server and no account: the site is static files, and everything it shows comes from relays.

## What it does

- **Discover** (`/`): the Dictionary's concepts first, then every other list, one card per concept with its
  item count. Copies of a concept sit under it, and withdrawn or blank headers stay out of the way, until
  you turn on "Show everything".
- **A list** (`/list?c=<coordinate>`): the version of the list that governs for you (your own copy, then
  your Assistant's, then Brainstorm's, then the community's), its fields, and its items as rows. Items from
  accounts outside your web of trust fold away behind one line. A row opens a panel with three views of the
  event: Item (the item drawn the way its list defines it, as Brainstorm's item page draws it: its picture,
  title, summary, links, facts, audio or video, and a map that loads only when you ask), Pretty and Raw.
- **Create** (`/create`) and the edit forms: make a list, add and edit items, and vote. Reading never
  signs; writing asks your NIP-07 extension (nos2x, Alby and the like).
- **Settings** (`/settings`): extra relays to read lists from.

Lists are read from `wss://dcosl.brainstorm.world` and, in parallel, the search index at
`wss://search.brainstorm.world`, which also answers counts. Trust ranks come from the `30382:rank`
provider your own kind 10040 names; signed out, or with none named, from the one Brainstorm's house names
in its kind 10040. A rank only decides what is shown and what is counted; Curate never shows anyone's rank.

## Run it

You need Node.js 22.22.2 or a later 22, or 24.15.0 or later (`package.json` `engines`). `.nvmrc` picks 24.

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # static export into out/
npm run lint
npx tsc --noEmit
```

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
