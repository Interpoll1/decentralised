# Self-hosting

Run your own instance in one command. Nothing here talks to anyone else's
server: no database to install, no accounts to create, no API keys. It is built
for **short-lived content** — a poll for tonight's meeting, a vote at an event,
a room that should not outlive the day — so everything expires on its own
unless you say otherwise.

## Start it

Pick whichever line matches how you like to work. They all end in the same
place: one process, one port, `http://localhost:8080`.

**Double-click** — `selfhost/launch.sh` (macOS: `launch.command`, Windows:
`launch.bat`). Checks Node, installs dependencies the first time, picks a free
port, opens your browser, and prints the address phones on the same wifi can
use.

**One npm script**

```bash
npm run selfhost          # the simple poll client — no build step
npm run selfhost:full     # the complete app, built and served locally
```

**Docker**

```bash
docker compose -f selfhost/docker-compose.yml up --build
```

**tmux, for development** — `./selfhost/run.sh` runs the Vite dev server and the
relay side by side, both pointed at localhost.

## The two clients

| | **Lite** (default) | **Full** |
|---|---|---|
| What it is | One page: create a poll, share the link, vote, watch results, keep a receipt | The complete app — communities, posts, chat, comments, polls |
| Build step | None. Plain HTML/CSS/JS served straight from the relay | `npm run selfhost:full` (Vite build, a few minutes) |
| Good for | Handing a link to a room full of people in 60 seconds | Running the whole platform for a group |
| Branding | None. `INSTANCE_NAME` names it, or leave it blank | Set `VITE_APP_NAME` in `.env.full` |

They share one relay and one graph: a poll created in the lite client is
visible in the full app, and the other way round.

Switch with `EDITION=full` (or `npm run selfhost:full`, which also builds it).

## Settings

Every one of these has a working default — you can run the whole thing without
setting any of them.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Port for everything: client, API, Gun and the peer socket |
| `HOST` | `0.0.0.0` | Bind address. `127.0.0.1` keeps it off the network |
| `EDITION` | `lite` | `lite` or `full` (see above) |
| `INSTANCE_NAME` | `Polls` | Name in the lite client. Empty string = unnamed |
| `ACCENT_COLOR` | `#4f7cff` | The single colour the lite client is built around |
| `RELAY_TTL_HOURS` | `24` | How long content lives. `0` = keep forever |
| `EPHEMERAL` | `0` | `1` = memory only; nothing is written to disk, a restart is a clean slate |
| `DATA_DIR` | `selfhost/data` | Where the graph and its index live |
| `REQUIRE_POW` | `1` | Require the vote's proof-of-work. `0` for slow phones on a LAN — the signature is still verified either way |
| `ALLOWED_ORIGINS` | _(empty)_ | Origins allowed to call the API from a browser. Only needed if you serve the client from somewhere other than this relay |
| `REQUIRE_AUTH` | `0` | Leave it off — there are no accounts here to authenticate against |

For the full client, build-time settings live in `selfhost/.env.full` (copy it
to `.env.full.local` to keep your own values out of git).

## A worked example: a poll for tonight, gone by morning

```bash
RELAY_TTL_HOURS=8 INSTANCE_NAME="Thursday Standup" ./selfhost/launch.sh
```

The launcher prints two addresses — one for you, one for anyone on the same
wifi. Open yours, write the question, hit create, and share the link it gives
you. People vote from their phones; results update live. Eight hours later the
poll, the votes and the receipts are gone, and you never had to clean anything
up. Add `EPHEMERAL=1` and nothing was ever written to disk in the first place.

Each voter gets a verification code and a signature over their own choice, so a
vote can be checked afterwards even though nobody signed in.

## What expiry actually means

When content expires, this instance stops serving it and marks it deleted for
any peer that still holds a copy. That is the honest limit of a replicated
graph: if you federated with other relays (`VITE_GUN_PEERS`), bytes already
copied to their disks are theirs, not yours. A default instance federates with
nobody, so expiry is complete.

## Who can write to it

There are no accounts, so **reaching the port is the permission**. Anyone who
can open the address can create polls and vote. That is the point at an event
and a problem on an untrusted network, so:

- Bind it to yourself with `HOST=127.0.0.1` when you do not want the LAN in.
- Web pages you visit cannot reach it: the relay refuses cross-origin writes
  and only hands browser access to its own origin (add others with
  `ALLOWED_ORIGINS`). The clients here are served by the relay itself, so
  phones on your wifi are already covered.
- Votes carry a signature the relay checks, so a tally cannot be forged by
  replaying someone else's vote even though nobody signed in.

## Not included, on purpose

- **Sign-in / OAuth** — no accounts, so nothing to sign into. Voting is by
  device key, which is what makes receipts work anonymously.
- **A database** — the graph plus a small index on disk is the whole store.
- **Video upload** — needs object storage this does not have.
- **The moderation API and the trust issuer** — hosted services; a self-hosted
  build hides both rather than pointing you at someone else's.
- **Push notifications.**

`VITE_SELFHOST=1` (already set in `.env.full`) is what hides those from the full
client, so nobody is offered a button that cannot work.

## Checking it works

```bash
curl localhost:8080/health          # uptime, peers, TTL, how much is stored
curl localhost:8080/api/polls       # every poll this instance still serves
curl "localhost:8080/db/soul?soul=v3/polls/<id>"   # 200 held, 404 expired
```
