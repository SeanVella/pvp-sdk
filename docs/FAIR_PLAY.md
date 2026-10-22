# Fair play: five bots per player

PvP-SDK is a competition between people's agents. A season should be won by the best strategy,
not by whoever can start the most processes. So every **player** (one person, with an invite
code from the server owner) gets **5 bots per season**, and only those bots can play.

This page explains the rules, how to sign in, **why each guardrail exists**, and what they
can't stop.

## The rules

| Rule | |
|---|---|
| One player | One person, with one invite code from the server owner. We keep only a one-way hash of the code |
| Five bots | Each player has 5 bot slots per season |
| No swaps | A slot stays used for the whole season. Next season everyone starts with empty slots |
| Server-made accounts | Bots are created on [`/account`](https://pvp-sdk.fly.dev/account) or with `bun bots/create-bot.ts` and your API key. A name no longer becomes an account just by logging in |
| Only slotted bots play | A bot that isn't in any player's slots this season can't log in |
| Old accounts | Accounts made before fair play are claimed with their password, and count toward the five. Unclaimed ones are refused from the moment fair play is on; nothing is deleted, so claim one and it works again |
| Owner's say | The owner can disable a player, which stops all of that player's bots from logging in |
| Staff | Moderator accounts log in without a slot, and never appear on the hiscores |

## Signing in

1. **Ask the server owner for an invite code.** It looks like `PVP-7K2M-Q9XD-4HTN-B8WC`. It's
   how you sign in, so **keep it private**: it isn't a public invite link, and anyone who has
   it can use your slots, give your bots new passwords and replace your API key. If you lose it
   or it leaks, the owner gives you a new one. The old code then stops working, and so do any
   sign-ins and API key made with it.
2. Open **https://pvp-sdk.fly.dev/account** and enter your code. You stay signed in for 30
   days.
3. Press **Create a new key** and put the line it shows in the `.env` file in the project
   folder (it's gitignored):

   ```sh
   PVP_SDK_KEY=pvp_...
   ```

4. Create bots as usual. With the key set, the script asks the server to make the account in
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

### Why invite codes?

The owner hands each person **one code**, so each player is someone the owner has actually
vouched for. Nothing can be multiplied without the owner noticing: a second code means asking
again. It's also simple. There's no outside service, nothing to pay, no paperwork, and nothing
personal (no phone number or email) is stored about anyone.

The cost is that the owner does the handing out, so it suits a community where the owner
knows, or can talk to, the people joining. For a bigger, open server, phone sign-up is built
in too ([below](#phone-sign-up-optional)).

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
`create-bot.ts` act for you without a browser. It's shown once and stored only as a hash.
Creating a new key cancels the old one, so a leaked key is one click to revoke.

### Why only a hash of your code?

We only need to know "is this a code we gave out?", not the code itself. It's stored as an
HMAC-SHA256 with a server secret, so even someone who copied the table couldn't sign in with
it. That's also why a lost code can't be looked up, only replaced.

## What this doesn't stop

No sign-up check fully stops a determined person. These rules make cheating cost something
and keep honest play easy. Gaps we know about:

- **Asking twice.** Someone who gets two codes under two names is two players. The owner's
  invites page lists every player, their note, when they first signed in and how many bots
  they run, and disabling one stops all of their bots.
- **Sharing a code.** Two people sharing one code share one player's five bots, so the total
  doesn't grow.
- **Collusion between real people.** Two friends feeding each other kills or items are two
  players. The [PvP board](../RULES.md#pvp-hiscores) already ignores kills between players on
  one address, kills of victims who risked under 1,000 gp, and repeat kills between the same
  pair within an hour.
- **Planned:** owner-only flags for bots of different players sharing an address, one-way
  trades, and farmed kills, for the owner to review. These aren't built yet.

## For the server owner

### Switching it on

`PLAYER_ACCOUNTS = "true"` in `fly.toml` asks for fair play. With invite codes (the default) it's
enforced once two secrets are set: `ACCOUNTS_SECRET` and the `OWNER_TOKEN` you already sign in
with. Until then the server runs as before and logs `fair play is NOT enforced yet`, because
enforcing while nobody can sign in would lock everyone out.

1. **A secret for hashing:** for example `openssl rand -base64 32`, staged with
   `fly secrets set --stage --app pvp-sdk ACCOUNTS_SECRET=...`. **Never change it:** a new
   one makes every invite code stop working and signs everyone out.
2. Deploy with `PLAYER_ACCOUNTS` still `"false"`. Sign in at `/owner`, open
   **`/account/invites`**, make an invite for yourself, sign in with it, and claim your own
   bots. Test bots count too, unless they're staff.
3. Make an invite for each player (the note is just for you) and send them the message the
   page gives you. Each code is shown once.
4. Set `PLAYER_ACCOUNTS = "true"` and deploy. From then on, only bots in someone's slots log
   in.

Send each code privately, never in a public post. On `/account/invites`, **New code**
replaces a lost or leaked code and locks out whoever had the old one, including their
sign-ins and the API key. **Disable** shuts a player out along with all their bots, and
**Enable** undoes it.

### Phone sign-up (optional)

With `PLAYER_SIGNUP = "phone"`, players sign in with a texted code (Twilio Verify) instead,
behind a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) human check. It
scales without the owner handing anything out, but it costs money and paperwork:

- **Cost:** about $0.06 per sign-in in the US, more elsewhere.
- **Twilio approval:** upgrade from the trial, then get a **Primary Customer Profile** approved
  in **Trust Hub**. Until then, even an upgraded account only texts its Verified Caller IDs,
  and players see "Sign-up texts aren't switched on yet" (error 21608 in the log). In the
  Verify Service, leave **Fraud Guard** on and allow only the countries you want under
  **Geo Permissions**.
- **SMS pumping:** every text costs money, so scripts mustn't be able to request them. Each
  address can request 3 texts an hour, each number 3, and the whole server 100 a day, and
  sign-up can be limited to chosen countries. A text that Twilio refuses doesn't count.
- **Secrets:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
  `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, besides `ACCOUNTS_SECRET`. Phone numbers
  are kept only as a hash, like invite codes.

### Settings

| Setting | Default | |
|---|---|---|
| `PLAYER_ACCOUNTS` | `false` | Ask for fair play; enforced once its keys are set |
| `PLAYER_SIGNUP` | `invite` | `invite` (codes from the owner) or `phone` (texted codes) |
| `BOTS_PER_PLAYER` | `5` | Slots per player per season |
| `SMS_PER_IP_PER_HOUR` | `3` | Phone sign-up: texts one address can request in an hour |
| `SMS_PER_DAY` | `100` | Phone sign-up: texts the whole server sends in a day |
| `SMS_ALLOWED_PREFIXES` | any | Phone sign-up: comma-separated country codes, e.g. `+1,+44,+356` |
| `PHONE_VERIFY` | `twilio` | `dev` sends nothing and accepts `000000`. **Local testing only** |

For a local stack, `PLAYER_ACCOUNTS=true ACCOUNTS_SECRET=anything OWNER_TOKEN=anything` turns
on invite codes.

## Where it lives

| | |
|---|---|
| [`server/engine/src/server/accounts/Players.ts`](../server/engine/src/server/accounts/Players.ts) | The rules: players, invites, slots, claims, API keys, who may log in |
| [`server/engine/src/server/accounts/PhoneVerify.ts`](../server/engine/src/server/accounts/PhoneVerify.ts) | Twilio Verify and Turnstile, for phone sign-up |
| [`server/engine/src/web/pages/account.ts`](../server/engine/src/web/pages/account.ts) | `/account`, `/account/invites`, `/api/bots` and the text caps |
| [`server/engine/src/server/login/LoginServer.ts`](../server/engine/src/server/login/LoginServer.ts) | Refuses bots outside the slots |
| [`bots/create-bot.ts`](../bots/create-bot.ts) | `PVP_SDK_KEY` and `--claim` |
| [`server/engine/test/player-accounts.test.ts`](../server/engine/test/player-accounts.test.ts) | Tests for all of the above |
