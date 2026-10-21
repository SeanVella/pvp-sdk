# Which version of the game?

**This server isn't Old School RuneScape.** It runs the LostCity "2004Scape" engine at
RuneScape 2 **revision 289, the game as of 17 January 2005**. Old School RuneScape is Jagex's
separate live game, rebuilt from an August 2007 backup and updated ever since. There is no
switch between them: OSRS would mean a different server, a different network protocol and
different game clients.

Researched October 2026; effort figures are estimates.

## The options

| Option | Era | Effort | PvP content gained | Risks |
|---|---|---|---|---|
| **A. Stay on 289**, take LostCity upgrades as they ship | 2005 onward | ~1-2 weeks per upgrade | Slayer, whip, granite maul; later Tele Block, Ancient Magicks, Barrows, Smite | Slow: LostCity moves about one revision every 3-4 months |
| **B. Stay on 289, add our own PvP kit** | 289 plus later items | ~3-6 weeks | Whip and granite maul (scripts exist in LostCity's 377-wip branch), Tele Block, Ancient Magicks, Barrows, Vengeance | Not historically authentic; needs care at each upgrade |
| C. Jump to LostCity 377-wip | May 2006 | ~3-5 months | Slayer now; Barrows, Ancients and Tele Block still unfinished there | Upstream says it's "not meant to ship"; no TypeScript client; drifts from rs-sdk |
| D. A 2009-2012 emulator (2009scape, Void, Darkan) | 2009-2012 | ~5-8 months | Ancients, Vengeance, Tele Block, claws, godswords, Bounty Hunter | Java clients only; AGPL licences; full SDK rewrite |
| E. An OSRS emulator (tsps, RSMod) | 2025-26 | ~5-9+ months | Modern OSRS PvP | Highest legal exposure; tsps is very young, RSMod is stalled |

**Recommendation: A plus B.** Staying on 289 keeps both TypeScript clients, the bot bridge,
the headless lite client and easy merges with rs-sdk. Add a clearly labelled PvP kit on top
(Tele Block, Ancient Magicks, whip/granite maul, Barrows sets), cherry-picking LostCity's
377-wip scripts where they exist. Revisit 377 when LostCity publishes a TypeScript client for
it. Don't move the public server to OSRS.

## When PvP features arrived

| Feature | Released | First revision | Here? |
|---|---|---|---|
| Protection prayers, multi-combat, skulls | 2004 | ≤ 289 | yes |
| Special attack bar | Jun 2004 | 244 | yes |
| Slayer, abyssal whip, granite maul | Jan 2005 | 291-295 | no |
| Tele Block | Mar 2005 | 304 | no |
| Ancient Magicks (Desert Treasure) | Apr 2005 | 308 | no |
| Barrows | May 2005 | 316 | no |
| Smite, Retribution, Redemption | Sep 2005 | 333 | no |
| Vengeance (Lunar Diplomacy) | Jul 2006 | after 377 | no |
| Dragon claws, Bounty Hunter, PvP worlds | 2007-2008 | none in LostCity | no |

## LostCity branches

| Branch | Game date | Browser client |
|---|---|---|
| 274 | 23 Nov 2004 | yes |
| **289 (ours)** | 17 Jan 2005 | yes |
| 377-wip | 2 May 2006 | no (Java only) |
| 530-wip | Jan 2009 | protocol experiment only |

377-wip has Slayer, the whip and granite maul specials, the Kalphite Queen and TzHaar, but its
Barrows and Desert Treasure work is unfinished, it has no Tele Block or Ancient spells, and it
has fewer scripts and quests than 289.

## Legal note (not legal advice)

None of these options is authorised by Jagex. Its terms forbid server emulators, and its Fan
Content Policy (v1.4, Sep 2026) bans private game servers. Its enforcement has mostly hit
public, promoted, OSRS-based servers through domain disputes and takedowns; its court cases
have been about botting the live game. LostCity positions itself as non-commercial
preservation of the 2004-era game, and we found no action against it. Moving pvp-sdk to an
OSRS base would raise our exposure, and an OSRS bot SDK overlaps with botting the live game.

## Sources

- LostCity: <https://github.com/LostCityRS>, roadmap <https://2004.lostcity.rs/roadmap>, FAQ
  <https://lostcity.rs/t/faq-what-is-lost-city/16>, 377 branch notes <https://lostcity.rs/t/15972>
- Emulators: <https://gitlab.com/2009scape/2009scape>, <https://github.com/GregHib/void>,
  <https://gitlab.com/darkanrs/server>, <https://github.com/rsmod/rsmod>, <https://github.com/RSPSApp/tsps>
- Jagex terms: <https://legal.jagex.com/docs/terms/terms-and-conditions>, Fan Content Policy
  <https://legal.jagex.com/docs/policies/fan-content-policy>
- Domain decisions with Jagex as complainant: <https://udrp.adr.eu/decisions/list?grid-filter%5Bcomplainants%5D=Jagex>
