# apps/mail: AgentZero's mailbox receiver (D80, D83)

Each person's AgentZero gets one mailbox, `name.word@zerofee.si`. Sites (pump.fun via Privy, Axiom, Padre) send their
sign-in codes there. This process takes those mails in over SMTP, **seals each one on arrival to the mailbox's public
key, and stores only the sealed bytes**. ZeroFee's server can never read a mail once it is stored: the phone or the
laptop tray holds the key (made from the person's words) and opens it. A code is read on the device by plain code
(`codeFrom`, digits only), never by a model, and nothing in a mail is ever an instruction to AgentZero.

Receive only: mail is accepted only for a registered mailbox on the configured domain (anything else gets 550 at
RCPT, so it never relays), 256 KB at most, no AUTH, nothing ever sent out. Logs hold counts and errors only: never a
sender, a subject or a body.

The SMTP side is written here on `node:net` and `node:tls` (`src/smtp.ts`), with no SMTP library: under QA's
supply-chain rule (every version at least 90 days old) the only allowed `smtp-server` releases depend on a
`nodemailer` with open advisories. The one dependency is `postal-mime` 2.7.5 (MIME parsing, no dependencies of its own).

## Run it locally

```sh
npm install            # once: brings postal-mime (apps/mail/package.json)
node apps/mail/server.ts --smtp 2525 --http 8787 --domain zerofee.si --data /tmp/zf-mail
```

Options:
- `--host` for SMTP and `--http-host` for the inbox API (both `127.0.0.1` by default).
- `--tls-key key.pem --tls-cert cert.pem`: STARTTLS on SMTP and HTTPS on the inbox API.
- `--api-host mail.zerofee.si`: the host every request proof is signed for (default `mail.<domain>`).
- `--trust-proxy N`: the number of proxies you run in front that append to `x-forwarded-for`. The caller is the
  entry N places from the right; entries further left are the caller's own claim and are never used.

**It refuses to start** when either host is not loopback and no key and certificate are given. The inbox API must
only be reached over TLS: either it serves HTTPS itself (key and certificate given), or it listens on loopback behind a
TLS proxy you run.

The data dir holds `mailboxes.json` (name → public keys) and `box/<mailbox>/<id>.json` (`{id, at, sealed}`), files
mode 0600. Each mailbox keeps its newest 500 mails.

Tests (no other host is reached; the server test listens on 127.0.0.1 only):

```sh
node --import ./tools/test/no-network.ts --test packages/agent/src/mail/mail.test.ts apps/mail/src/*.test.ts
```

## Limits

- An "address" is an IPv4 address, or an IPv6 address's /64. The defaults bind IPv4 (`127.0.0.1`; on the box
  `0.0.0.0`, IPv4 only).
- SMTP connections: 5 at once from one address, checked first; a refused connection gets one 421 line and is dropped
  at once, never counted. 200 accepted sessions in all. Each closed after 2 minutes whatever it is doing, and after
  60 s idle.
- Memory per connection is bounded: reading pauses while a mail is stored or while 64 KB of replies wait unread; a
  command line over 2 KB gets 500 and the connection closes; DATA is copied into one buffer of the size cap. Only
  CRLF.CRLF ends DATA.
- Arrivals are charged when a mail is complete (after DATA), never at RCPT, so naming a mailbox uses up nothing:
  10 a minute per sender address and mailbox, 30 a minute per mailbox, 300 a minute per sender address (big senders
  like Privy's mail service share addresses across all our people). Over a limit: 451, and a real sender tries again.
- RCPT: 100 a minute per address; after 10 unknown recipients in 10 minutes from one address, every RCPT from it
  answers 450.
- Mail ids come from a counter read when the mail is written, so one that took longer to parse never lands behind a
  phone's `since`.
- Inbox API: 120 requests a minute per address (all but health), 60 authorised requests a minute per mailbox, 20
  registrations an hour per address. The limit tables hold at most 20,000 keys, least recently used dropped first.

## The person's own sign-in mailbox (K1, K3: 4 Nov)

The same receiver also serves each person's **sign-in mailbox** for sites that log in by email (pump.fun, via Privy):
`word.word@mail.zerofee.si`, with its own keys (salt `zerofee-sitemail-v1`, packages/core/src/site-mail.ts) so
AgentZero's keys open none of it, and reached only by ZeroFee's own screens (`sitemail.*`, refused to every app,
AgentZero included). Run it with `--domain mail.zerofee.si --api-host mail.zerofee.si`: addresses live on the
`mail` subdomain, and the zerofee.si apex MX stays where it is (K3). The app shows nothing of it until its settings name
the mail host (`mail: {host, domain}`).

## What the operator provides later

- An always-on box with **port 25 and 443 open inbound** (most home and many cloud networks block 25; receive only, so
  outbound 25 may stay blocked) running this process as `--smtp 25 --host 0.0.0.0 --domain mail.zerofee.si
  --api-host mail.zerofee.si` with a real key and certificate for mail.zerofee.si (Let's Encrypt).
- DNS at Namecheap, the `mail` host only: an **A record** mail.zerofee.si → the box, an **MX record** for
  mail.zerofee.si → mail.zerofee.si, `v=spf1 -all` and a DMARC `p=reject` on it (nothing is ever sent from it). The
  apex records are not touched (QA switches them; nothing here touches DNS).
- For the phone with the isolated core: `sitemail` added to IsolatedCore.swift's `coreFamilies` (until then the phone
  refuses it, closed).
- The box must reach DNS (TXT lookups for DKIM keys).
- Not built yet: SPF and DMARC policy checks (DKIM is in, below), and the phone's inbox screen.

## DKIM on arrival (src/dkim.ts)

A mail is sealed only when one of its DKIM signatures verifies (rsa-sha256 of 1024 bits or more, or ed25519-sha256)
and is its From domain's own (d= is the From domain or a parent). Unsigned, failing, unaligned, expired, `l=` (partly
signed), `rsa-sha1`, From not signed, or more than one From: `550 5.7.20`, never stored. A DNS failure: `451`, so a real
sender retries. It can be turned off only on loopback (tests); `startMail` refuses `dkim: "off"` beyond it. Checked
against RFC 8463's own signed mail (dkim.test.ts).

## The keys (packages/agent/src/mail/keys.ts, shared by the phone, the tray, this server and the tests)

```
seed      = hotRoot(wordsSeed)   (packages/core/src/hot-keys.ts: BIP-39 seed of the 24 words, ZeroFee's hot passphrase)
box key   = HKDF-SHA256(seed, salt "zerofee-mail-v1", info "zerofee-mail-box",  32) → X25519 secret
sign key  = HKDF-SHA256(seed, salt "zerofee-mail-v1", info "zerofee-mail-sign", 32) → Ed25519 seed
seal      = 0x01 ‖ E ‖ nonce(24) ‖ XChaCha20-Poly1305(HKDF-SHA256(X25519(e, R), salt E‖R, info "zerofee-mail-seal-v1"),
            nonce, JSON {from, subject, date, text}, aad 0x01‖E‖R)   with a fresh ephemeral e per mail; base64url
```

`mailKeys(seed)`, `sealTo`, `openSealed`, `sealMail`, `openMail`, `signRegister`, `signRequest`, `boxKeyOk`;
`codeFrom` and `htmlToText` in `code.ts`; the name rules in `names.ts`.

## The inbox API

All answers are JSON with `cache-control: no-store`. Timestamps are milliseconds (`Date.now()`); signatures and keys
are base64url without padding.

| Call | Body / header | Answers |
|---|---|---|
| `POST /v0/mail/register` | `{mailbox, publicKey, proof: {signingKey, timestamp, signature}}`; `signature` = Ed25519 by the sign key over `zerofee-mail-register:<mailbox>:<publicKey>:<timestamp>`, within 5 minutes | 200 `{ok, mailbox, address}`; 400 `bad-name` / `bad-body` / `bad-key` (a small-order box key); 403 `reserved`; 401 `refused` (a bad or stale proof, or a name held by another sign key: all the same answer); 429 |
| `GET /v0/mail/:mailbox?since=<id>` | `x-mail-proof: <timestamp>.<signature>`, Ed25519 over `zerofee-mail-read:<api host>:<mailbox>::<timestamp>` | 200 `{messages: [{id, at, sealed}], more}`: oldest first, at most 50, only ids after `since`; `more` when later ones remain, so the phone reads again with `since` = the last id and never skips a mail. 401 for anything else (an unknown mailbox too); 400 `bad-since`; 429 |
| `DELETE /v0/mail/:mailbox/:id` | `x-mail-proof` over `zerofee-mail-delete:<api host>:<mailbox>:<id>:<timestamp>` | 200 `{ok: true}`; 404; 401; 429 |
| `GET /v0/mail/health` | none | 200 `{ok: true}` |

A request proof is accepted within 30 seconds of its timestamp and **once only** (the server keeps used signatures for
a little over a minute), so the phone signs every request afresh. Because it covers the method, the API host, the
mailbox and the id, a read proof can't delete, a delete proof can't delete another mail, and no proof works on another
server.

Names: lowercase `[a-z]+\.[a-z]+`, 3–40 characters; a part that is a reserved word (admin, postmaster, abuse,
support, noreply, root, zerofee, agentzero, …) is refused. The first registration binds the name to its sign key;
a later one must be signed by that same key (it may change the box key).
