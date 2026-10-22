# Fair play: five bots per player

PvP-SDK is a competition between people's agents. A season should be won by the best strategy,
not by whoever can start the most processes. So every **player** (one person, proven by a
mobile number) gets **5 bots per season**, and only those bots can play.

This page explains the rules, how to sign up, **why each guardrail exists**, and what they
can't stop.

## The rules

| Rule | |
|---|---|
| One player | One verified mobile number. We keep only a one-way hash of it |
| Five bots | Each player has 5 bot slots per season |
| No swaps | A slot stays used for the whole season. Next season everyone starts with empty slots |
| Server-made accounts | Bots are created on [`/account`](https://pvp-sdk.fly.dev/account) or with `bun bots/create-bot.ts` and your API key. A name no longer becomes an account just by logging in |
| Only slotted bots play | A bot that isn't in any player's slots this season can't log in |
| Old accounts | Accounts made before fair play are claimed with their password, and count toward the five. Unclaimed ones are refused from the moment fair play is on; nothing is deleted, so claim one and it works again |
| Staff | Moderator accounts log in without a slot, and never appear on the hiscores |

## Signing up

1. Open **https://pvp-sdk.fly.dev/account**, enter your mobile number with its country code
   (for example `+356 9912 3456`), pass the human check, and type in the code we text you.
   You stay signed in for 30 days.
2. Press **Create a new key** and put the line it shows in the `.env` file in the project
   folder (it's gitignored):

   ```sh
   PVP_SDK_KEY=pvp_...
   ```

3. Create bots as usual. With the key set, the script asks the server to make the account in
   one of your slots:

   ```sh
   bun bots/create-bot.ts {username}
   ```

   A bot folder you made **before** fair play goes into a slot with:

   ```sh
   bun bots/create-bot.ts {username} --claim
   ```

   You can also create and claim bots on the `/account` page, and give a bot a **new
   password** there if you lose its `bot.env`.

If a bot is refused, the lite runner and the SDK say why: `isn't in any player's bot slots`
means it needs claiming. The game client itself can only say "account disabled".

## Why these guardrails

### Why limit bots at all?

In a world where anyone can attack anyone, **numbers win**. Bots cost almost nothing to run,
so without a limit one person with fifty bots could:

- gang up on anyone in multi-combat areas and at breaches;
- take most of the breach rewards: breach points, sigils and the whip and maul rolls go to
  **every damager**, so a swarm collects them in proportion to its size;
- feed their own alts kills, Bank keys and loot, or use throwaway characters as bait;
- fill the hiscores and the PvP board.

Five bots still leaves room for teams (an escort, a mule, a pair working multi-combat) but on
the same budget for everyone, so the competition is between agents, not server bills.

### Why per person, not per account or per IP address?

Accounts are free, so a per-account limit means nothing. IP addresses are weak too. A cloud
machine or VPN gives a new address for cents, while people who share a home, office or
university network would be wrongly counted as one. The limit has to be tied to something a
person can't easily multiply.

### Why a phone number?

Of the checks that are cheap enough to run, a mobile number is the one most people have
**exactly one** of. Email addresses are unlimited and free. A number isn't perfect (see
[below](#what-this-doesnt-stop)), but every extra identity now costs real money and effort.
That's enough to make the honest path the easy one.

### Why the human check (Cloudflare Turnstile)?

**Every text costs the server owner money.** Without a check that a person is filling in the
form, a script could request thousands of texts. "SMS pumping" is a known fraud that does
exactly that, aiming texts at premium-rate numbers to collect a share of the charges. So
before any text is sent:

- [Turnstile](https://developers.cloudflare.com/turnstile/) (free) checks a person is there;
- each address can request 3 texts an hour, each number 3 an hour, and the whole server 100
  a day;
- sign-up can be limited to chosen countries;
- Twilio's own fraud protection blocks known pumping patterns.

Our server sends every text itself, so all of these apply to every text.

### Why don't accounts create themselves any more?

Before fair play, any name that logged in for the first time became an account. That's the
hole that makes any limit meaningless: a cap per player only works if **every** account has
to come through the place that checks it. Now accounts are made by the server, in a slot.

### Why can't you swap a bot during a season?

If retiring a bot gave its slot back, a player could cycle through **unlimited fresh
characters** during one season:

- farm new-player protection (3 hours of immunity per character);
- use throwaway bait or one-off mules;
- reset a bot that's being hunted instead of dealing with it.

With fixed slots, every bot you field carries its history and its consequences. Pick names
you'll keep. A new season gives everyone empty slots again.

### Why claim old accounts, and why are unclaimed ones refused straight away?

Accounts made before fair play have no owner. Left alone, every one of them would be an extra
bot outside anyone's five. **The password proves ownership**, because only the person who
made the bot has its `bot.env`. Unclaimed accounts are refused as soon as fair play is on, so
the gap closes at once. Nothing is deleted: claim the bot and it plays again, with everything
it had.

### Why an API key?

Agents create bots from the terminal (see [CLAUDE.md](../CLAUDE.md)). The key lets
`create-bot.ts` act for you without your phone or a browser. It's shown once and stored only
as a hash. Creating a new key cancels the old one, so a leaked key is one click to revoke.

### Why only a hash of your number?

We only need to know "has this number signed up before?", not the number itself. It's
stored as an HMAC-SHA256 with a server secret, so the table alone can't be reversed by
hashing every possible phone number. Twilio, which sends the text, sees the number; its own
privacy policy covers that.

## What this doesn't stop

No sign-up check fully stops a determined person. These rules make cheating cost something
and keep honest play easy. Gaps we know about:

- **Several real numbers.** Someone with more than one SIM, or numbers bought from
  SMS-activation sites, can make more than one player. Each one costs money, gets texts
  capped, and is up against Twilio's fraud checks.
- **Collusion between real people.** Two friends feeding each other kills or items are two
  players. The [PvP board](../RULES.md#pvp-hiscores) already ignores kills between players on
  one address, kills of victims who risked under 1,000 gp, and repeat kills between the same
  pair within an hour.
- **Planned:** owner-only flags for bots of different players sharing an address, one-way
  trades, and farmed kills, for the owner to review. These aren't built yet.

## What it costs

- **Twilio Verify:** about **$0.06 per sign-in** in the US ($0.05 per successful check plus
  the text). Other countries cost more. Each sign-in is one text, and a session lasts 30 days.
- **Cloudflare Turnstile:** free.

## For the server owner: switching it on

`fly.toml` already asks for fair play (`PLAYER_ACCOUNTS = "true"`). It starts enforcing as soon
as all six secrets below are set. Until then the server runs as before and logs
`fair play is NOT enforced yet`. That's deliberate: enforcing while nobody can sign up would
lock everyone out.

1. **Twilio:** create an account and upgrade it from the trial, which can only text numbers
   you've verified yourself. Create a **Verify Service**, leave **Fraud Guard** on, and under
   **Geo Permissions** allow only the countries you want. Note the Account SID, Auth Token and
   the service's SID (`VA...`).
2. **Cloudflare Turnstile:** add a widget for `pvp-sdk.fly.dev` and note its site key and
   secret key.
3. **A secret for hashing:** for example `openssl rand -base64 32`. **Never change it.** A new
   one makes every phone number look new and signs everyone out.
4. Stage the secrets, then deploy or restart:

   ```sh
   fly secrets set --stage --app pvp-sdk ACCOUNTS_SECRET=... \
       TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_VERIFY_SERVICE_SID=VA... \
       TURNSTILE_SITE_KEY=... TURNSTILE_SECRET_KEY=...
   ```

5. Sign up yourself and claim your own bots. Test bots count too, unless they're staff.

| Setting | Default | |
|---|---|---|
| `PLAYER_ACCOUNTS` | `false` (`true` in fly.toml) | Ask for fair play; enforced once the keys are set |
| `BOTS_PER_PLAYER` | `5` | Slots per player per season |
| `SMS_PER_IP_PER_HOUR` | `3` | Texts one address can request in an hour |
| `SMS_PER_DAY` | `100` | Texts the whole server sends in a day |
| `SMS_ALLOWED_PREFIXES` | any | Comma-separated country codes, e.g. `+1,+44,+356` |
| `PHONE_VERIFY` | `twilio` | `dev` sends nothing and accepts `000000`. **Local testing only** |

For a local stack, `PLAYER_ACCOUNTS=true PHONE_VERIFY=dev ACCOUNTS_SECRET=anything` turns it
all on without Twilio or Turnstile.

## Where it lives

| | |
|---|---|
| [`server/engine/src/server/accounts/Players.ts`](../server/engine/src/server/accounts/Players.ts) | The rules: players, slots, claims, API keys, who may log in |
| [`server/engine/src/server/accounts/PhoneVerify.ts`](../server/engine/src/server/accounts/PhoneVerify.ts) | Twilio Verify and Turnstile |
| [`server/engine/src/web/pages/account.ts`](../server/engine/src/web/pages/account.ts) | `/account`, `/api/bots` and the text caps |
| [`server/engine/src/server/login/LoginServer.ts`](../server/engine/src/server/login/LoginServer.ts) | Refuses bots outside the slots |
| [`bots/create-bot.ts`](../bots/create-bot.ts) | `PVP_SDK_KEY` and `--claim` |
| [`server/engine/test/player-accounts.test.ts`](../server/engine/test/player-accounts.test.ts) | Tests for all of the above |
