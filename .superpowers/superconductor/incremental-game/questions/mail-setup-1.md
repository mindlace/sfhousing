# Question mail-setup-1 — from incremental-game-mail-setup

## Question

Partial hand-back, "waiting on owner: DNS records and a test address" (spec §sec-design-relay).
The owner needs to (1) add the six records below in the Cloudflare zone `mindlace.net`, and
(2) name one email address they read, for the two proof mails. Pass the address back in the
session only (a SendMessage), never in a file.

## What the package says

`docs/superpowers/specs/2026-11-22-mail-setup-design.html` §sec-design-dns: the operator cannot
write the zone; the owner adds the records from this exact list. §sec-design-proof: the test
address comes with the DNS answer.

## What I found

- SES identity `sfhousing.mindlace.net` created in `us-west-1`, Easy DKIM RSA 2048, MAIL FROM
  `mail.sfhousing.mindlace.net` with `USE_DEFAULT_VALUE` (both `aws sesv2` calls succeeded,
  2026-11-22).
- The records, names relative to `mindlace.net`, TTL Auto:

| Name                                                  | Type  | Content                                                | Proxy                 |
| ----------------------------------------------------- | ----- | ------------------------------------------------------ | --------------------- |
| `d2pbdsfzihrx67lekj37ia2rn3rqovjj._domainkey.sfhousing` | CNAME | `d2pbdsfzihrx67lekj37ia2rn3rqovjj.dkim.amazonses.com` | DNS only (grey cloud) |
| `zmb7vpr5olgzqrqvyrvw5knp3frfpz2u._domainkey.sfhousing` | CNAME | `zmb7vpr5olgzqrqvyrvw5knp3frfpz2u.dkim.amazonses.com` | DNS only (grey cloud) |
| `q4pciqb2ianhhhs4qftpk2trppunlsbu._domainkey.sfhousing` | CNAME | `q4pciqb2ianhhhs4qftpk2trppunlsbu.dkim.amazonses.com` | DNS only (grey cloud) |
| `mail.sfhousing`                                      | MX    | `feedback-smtp.us-west-1.amazonses.com`, priority 10   | —                     |
| `mail.sfhousing`                                      | TXT   | `v=spf1 include:amazonses.com ~all`                    | —                     |
| `_dmarc.sfhousing`                                    | TXT   | `v=DMARC1; p=quarantine; adkim=r; aspf=r`              | —                     |

- The three CNAMEs must be "DNS only": Cloudflare proxies a new CNAME by default, and a proxied
  DKIM record never verifies.
- Nothing is added at `sfhousing.mindlace.net` itself, and `mindlace.net`'s own SPF, MX and DMARC
  are not changed.

## Options I see

1. The owner adds the six records and sends one test address (the spec's path).

## Blocking

Plan `docs/superpowers/plans/2026-11-22-mail-setup.html` tasks 1 (steps t1-s4, t1-s5) through 5.
