---
title: Connecting to write
summary: Reading needs nothing. To write, connect a signer, a browser extension or a remote signer on your phone, and Curate asks it to sign each change.
---

## Reading needs nothing

You can browse every list, open every item and read every event without connecting. Curate has no accounts and no passwords.

## Writing needs a signer

Everything you write on nostr is signed with your key. Your key is a secret, a long string that proves who you are. Whoever holds it can write as you, so it should stay in one safe place.

A signer is a small program that holds your key and signs for you. Curate asks your signer to sign each thing you write: a list, an item, a vote, a change or a deletion. Your key never enters Curate. Curate only ever sees what your signer hands back: the signed event, and your public key, which is your nostr identity and is safe to share. A public key is often written as an npub, a string that starts with `npub1`.

Curate works with two kinds of signer:

- a **browser extension**, which lives in your web browser (NIP-07 is the public description of how these work);
- a **remote signer**, which lives somewhere else, such as an app on your phone, and talks to Curate through relays (NIP-46).

## Connecting

Press "Connect" in the top bar. A window titled "Connect" opens. It says: "Curate asks your signer to sign what you write. Your private key stays with your signer."

### With a browser extension

Press "Browser extension". Under the button, Curate says "Use the signer extension in this browser" when it finds one, or "No extension found in this browser" when it does not. Then the button can't be pressed.

Curate says "Waiting for your extension…" until the extension answers. Some extensions first ask you whether to let Curate in. Once it answers, the window closes.

### With a signer app on your phone

Under "Remote signer", press "Scan with your phone". Curate shows a square code, a QR code, and says "Scan this code with your signer app."

1. Open your signer app and scan the code.
2. Approve the connection in the app.
3. Curate says "Waiting for your signer…" until the app answers, then the window closes.

If you are already on your phone, use "Open in a signer app on this device" instead of scanning. "Copy link" copies the code as text, for a signer that takes a pasted link. "Cancel" stops waiting.

Curate waits about three minutes. If no signer answers in that time, it says "No signer paired in time." and you can try again.

### With a bunker link

Some remote signers give you a link that starts with `bunker://`. A bunker is a remote signer that you reach by such a link.

Paste the link into the box under "Paste a bunker link" and press "Connect". Curate says "Waiting for your signer…" until the bunker answers. The bunker may first ask its owner to approve, so this can take a few minutes. Curate waits about three minutes, and "Cancel" stops waiting sooner. Anything that isn't a bunker link gets "That isn't a bunker:// link."

### When a signer asks for approval

Some remote signers ask you to approve Curate on a web page of their own. Curate then shows "Your signer asks you to approve Curate." with a link, "Open the approval page", and the name of the site it goes to. Curate never opens the page by itself. Check the site name, open the page if you trust it, and approve there. "Dismiss" puts the notice away.

## Once you are connected

The top bar shows your picture and name in place of "Connect", and a "Disconnect" button.

When it connects a remote signer, Curate asks for permission to sign four kinds of event: lists and items (kinds 39998 and 39999), votes (kind 7) and deletions (kind 5). These are all Curate writes.

To talk to a remote signer, Curate makes a throwaway key of its own. That key can't sign anything as you. It only lets Curate and your signer recognise each other.

## How long it lasts

- **A browser extension** stays connected while the page is open. If you reload the page, press "Connect" again.
- **A remote signer** stays connected until you press "Disconnect" or close the browser tab. A reload keeps it.

## When something goes wrong

Each problem shows its own words in place, and nothing is sent.

- **Your signer switched accounts.** Some signers let you switch accounts while a page is open. If your signer signs as a different account from the one you connected, Curate refuses the event and says "Your signer is now signing as a different account. Connect again to write." Press "Connect again" and connect as the account you want.
- **A remote signer didn't answer.** Curate waits 30 seconds for each signature. Then it says "The signer didn't answer in time." and offers "Connect again".
- **The signer said no.** Curate shows the signer's own words, after "The signer didn't sign:".
- **The signer changed the event.** Curate checks every signed event before it sends it. If the event isn't exactly what Curate asked for, it says "The signer changed the event it was asked to sign." and sends nothing.

Next: [Creating a list](/guide/creating-a-list).
