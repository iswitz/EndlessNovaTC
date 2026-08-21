# EV Nova to Endless Sky

Extraction scaffold for the Windows EV Nova install at `C:\Users\Isaac\EV Nova`.

## Current result

`parsed-data/format-report.json` records the detected file format. The installed files are Windows BurgerLib `.rez` containers (`BRGR`). `extract:all` decodes them with `evnova-utils`, builds NovaParse-compatible resource forks, then parses those files.

`vendor/novaparse/` is the NovaParse source repo, built locally before use.

`vendor/burgerlib/` documents the `BRGR` container format. `vendor/evnova-utils/` supplies a working Perl `ResourceFork` reader for Windows EVN `.rez` files.

`reference/evntoes/` contains selected checked-in outputs from EVNToEndlessSky: its parsed JSON and generated ES data files. These are reference artifacts, not a claim that they came from this Windows install.

## Work completed

The current pipeline reads Windows EV Nova BurgerLib `.rez` containers, bridges them into NovaParse resource forks, extracts normalized gameplay records, and emits a total-conversion Endless Sky plugin named `Endless Nova TC`.

Current extracted dataset:

- 8,362 raw EVN resources preserved as JSON or compressed JSON.
- 288 ships, 242 outfits, 81 weapons, 411 planets, 545 systems, and 15 explosions normalized.
- 68 governments, 147 `düde` ship groups, 128 `flët` formations, 791 missions, 125 `crön` events, 19 `öops` disasters, and 4 `nëbu` nebula records preserved.

Current ES conversion:

- Ship, outfit, weapon, planet, system, government, fleet, shop, mission, conversation, start, and menu interface data emitted under `converted-plugin/data/`.
- EVN government colors, reputation, allies, enemies, dock flags, tech levels, SpecialTech shops, commodity flags, asteroid fields, traffic fleets, reinforcement fleets, tribute, and defense fleets mapped into ES syntax.
- EVN `DefCount` wave encoding converted to total ES tribute-fleet spawns. ES has no direct equivalent for EVN wave timing.
- EVN murk mapped to ES system haze artwork. Sensor interference, visibility expressions, and decorative `nëbu` regions remain explicit source/attribute data because ES has no direct equivalents.
- 194 missions and 543 conversations active; 313 missions remain inactive stubs because their destination, availability, or control script has no safe ES equivalent yet. EVN `AvailBits` boolean expressions now map through ES `and`/`or` conditions, including `P0` registration tests and recoverable `O` outfit tests. Government, ally, enemy, class, and adjacent-system stellar selectors map to ES filters with approximation comments where semantics differ. Travel stellar values become waypoints when recoverable.
- Mission `BriefText`, `QuickBrief`, cargo load/drop text, completion/failure/refusal text, ship-done text, deadlines, rating gates, cargo/passenger quantities, NPC groups, reputation rewards, `OnAccept`, `OnRefuse`, `OnSuccess`, `OnFailure`, `OnAbort`, and `OnShipDone` fields now emit ES data. EVN `{bNNN "yes" "no"}` and `{PNNN "yes" "no"}` text branches now emit ES `branch`/`label`/`goto` trees. Gender branches remain flattened because ES has no player-gender condition. Verified EVN `G`/`D` outfit, `F` mission-fail, `K`/`L` rank-state, `X` explored-system-state, and `Q` STR# message actions emit ES equivalents; unsafe movement, ship replacement, sound, and mission-start opcodes remain explicit comments.
- All 19 EVN `öops` disasters now emit ES system trade events plus hidden landing schedulers. EVN's daily frequency is approximated at landing because ES has no independent daily random-event hook; duration schedules a price reset.
- 124 of 125 EVN `crön` records now emit ES events and hidden landing schedulers. `EnableOn` becomes an ES mission condition; `FirstDay`/`FirstMonth`/`FirstYear` and `LastDay`/`LastMonth`/`LastYear` become ES date conditions; `Random`, `PreHoldoff`, `Duration`, and `PostHoldoff` map to landing rolls and delayed events. One non-pure condition record remains source-only; eight complex action scripts remain explicit comments.
- EVN `crön` `STR#` news now emits 99 ES `news` definitions. Start events activate independent news near Sol as an ES approximation of EVN global news and activate local news by mapped government; end events remove those locations.
- Startup menu override, `Endless Nova TC` metadata, EVN Trader start, and installed Windows test copy verified.

Extracted images and sounds are intentionally excluded from Git for now. They remain local under `converted-plugin/images/` and `converted-plugin/sounds/`; `.gitignore` keeps them out of commits. The converter and asset scripts still support rebuilding them locally.

## Plans moving forward

1. Validate `öops` event overlap, scheduler behavior, and price reset behavior in-game.
2. Validate date-gated `crön` events in-game; replace landing-time approximations with a lower-overhead scheduler where possible.
3. Complete mission conversion: map remaining generic stellar selectors and `S`/`A`/`M`/`N`/`P`/`T`/`C`/`E`/`H`/`Y`/`U`/`Q` action opcodes where ES gains a tested equivalent, and replace approximation comments with engine behavior.
4. Improve ship and weapon fidelity: loadouts, AI, turrets, ammunition, animations, explosions, sound links, and remaining parser warnings.
5. Map remaining planet and system fields: landing restrictions, tribute thresholds, services, stellar weapons, dead/reanimated states, navigation defaults, and system visibility replacements.
6. Re-enable media packaging after data mappings stabilize, then validate the full plugin from a clean Endless Sky install.
7. Add repeatable converter validation and release packaging, including a documented `git clone --recurse-submodules` workflow.

## Run

From Windows Node.js:

```text
npm install
npm run extract
```

Override source/output paths with `EVN_ROOT` and `EVN_OUTPUT`.

To dump BurgerLib resources into readable JSON now:

```text
perl scripts/extract-burger-resources.pl
```

Output: `parsed-data/burger-resources.json`. It preserves resource type, ID, name, source file, and raw bytes as base64. This is the bridge input for a later BurgerLib-to-NovaParse adapter.

Create NovaParse-compatible resource-fork files from that dump:

```text
node scripts/burger-to-resourcefork.js
```

Output: `parsed-data/novaparse-source/`.

Full pipeline:

```text
npm run extract:all
```

Convert extracted data into an ES plugin:

```text
npm run convert
```

Run extraction plus conversion:

```text
npm run build
```

Convert media assets after extraction and conversion:

```text
npm run assets
```

The asset step uses `vendor/rsrcdump/` for resource-fork `PICT`, `cicn`, and `ppat` images. It decodes EVN `rlëD` sprites directly and converts EVN `snd ` resources to mono, 16-bit, 44.1 kHz WAV files required by Endless Sky. If the bundled Python runtime is not on `PATH`, run `scripts/prepare-media.js` with Node, then run `scripts/extract-assets.py` with Python 3.10+.

Results:

- `parsed-data/burger-resources.json`: local BurgerLib resource dump, raw bytes preserved as base64. Repository copy uses `burger-resources.json.gz`; the converter reads either form.
- `parsed-data/resources.json`: NovaParse resource metadata.
- `parsed-data/normalized.json`: NovaParse normalized gameplay data.
- `parsed-data/summary.json`: resource counts.

Conversion output: `converted-plugin/`. The root also contains `plugin.txt` metadata. The `data/` folder contains ES text for ships, outfits/weapons, planets, systems, shops, fleets, missions/conversations, mission STR# messages, `öops` disasters, `crön` events/schedulers, `STR#` news, and an explosion placeholder. The `images/` folder contains raw extracted resources plus ES aliases under `ship/`, `planet/`, `outfit/`, and `projectile/`; `_menu/endless-nova-title@1x.png` (1024×477) and `_menu/endless-nova-title@2x.png` (2048×954) override the ES menu title and are resized from `_menu/title-source.png`. The `sounds/` folder contains converted WAV files named `evn-<id>.wav`. The `source/` folder contains JSON copies for every detected EVN resource type, including types with no direct ES equivalent. `conversion-manifest.json` records counts, mappings, and asset errors.

The converter follows current Endless Sky data conventions for nested `attributes`, `outfits`, `weapon`, and `fleet` blocks. Supported EVN control-bit expressions and availability rules emit ES conditions; unsupported selectors remain in inactive stubs with source comments. Some EVN PICT resources use formats unsupported by `rsrcdump`; those are listed in `conversion-manifest.json` and do not block the usable assets.

## Installed test copy

The current plugin copy is installed at:

```text
C:\Program Files (x86)\Steam\steamapps\common\Endless Sky\plugins\endless-nova-tc
```

Endless Sky loaded the plugin without mission parser or unrecognized-attribute errors after adding weapon port capacity, fitting ship loadouts to available outfit space, and changing planet `pos` output to ES-compatible landscape data. Ship thumbnail aliases and planet landscape aliases are also generated. Planet records now recover and emit EVN government assignments for 306 planets. EVN dock flags now drive ES landing, outfitter, and shipyard entries. Thirty-five generic tech-tier outfitters and 20 generic tech-tier shipyards are generated. Planet `SpecialTech` values now create 154 dedicated outfitters and 49 dedicated shipyards with exact-tech EVN items. Tech-tier license outfits now gate converted ships and outfits. System records now emit 542 ES trade prices from EVN commodity exchange flags, EVN controlling governments, asteroid fields, 2,708 traffic/reinforcement fleet schedules, and 275 fleet definitions from `sÿst`, `spöb`, `düde`, and `flët` metadata; EVN murk now selects ES system haze artwork on 187 systems, while sensor interference and visibility expressions remain explicit EVN system attributes. Planet records now emit 259 ES tribute entries and 216 defense-fleet mappings; EVN encoded defense waves become total ES tribute-fleet spawns. EVN `nëbu` map decorations remain in `source/nëbu.json` because ES has no direct nebula-region syntax. `düde` probability lists become weighted ES fleet variants; `flët` lead/escort formations become fixed variants using mean escort counts. Mission conversion now emits 194 active missions, 313 inactive stubs, and 543 conversations, including complex availability filters, waypoints, rating gates, cargo/person text, failure/abort paths, control-bit transitions, reputation rewards, real EVN text branch trees, verified outfit/rank/exploration/message actions, and explicit comments for unsafe opcodes. The EVN `.Trader` `chär` template now appears as an `Endless Nova Trader` ES start at Kania / Port Kane with 25,000 credits, a Shuttle, a pilot license, and EVN registration. Plugin folder is now `endless-nova-tc`, with metadata name `Endless Nova TC`; its menu background now overwrites the stock interface with a unique EVN/ES hybrid sprite, `ENDLESS NOVA TC` lettering, and an Endless Sky star accent. The installed copy now uses EVN's 23/6/1177 NC start date, loads 124 converted `crön` events and 99 `STR#` news definitions, and shows no new mission parser warnings.

## EVNToEndlessSky preflight

The EVNToEndlessSky README documents two important manual steps:

- When using its Rezilla XML pipeline, change the `flët/ActivateOn` template field from type `C100` to `T100`. `T100` acts like a C string but advances the parser by 100 bytes, skipping padding in that structure. The checked-in `vendor/evntoes/resourceTemplates/templates.json` already contains this fix for one `ActivateOn` field; other `ActivateOn` fields remain `C100` because they belong to different resource templates.
- Its XML parser can fail when all six XML files are loaded together. Parse five, parse the sixth separately, then combine the JSON manually.

Neither exception applies to the current BurgerLib → NovaParse path: it does not use Rezilla templates or the six XML files. No separate resource-bit edit appears in the EVNToEndlessSky README. The remembered manual “resource bit” is likely the `C100` → `T100` template correction.

The EVNToEndlessSky converter itself currently registers only the `outfits` porter. It is useful as an output reference, but it does not provide complete ship, weapon, planet, system, mission, or government conversion.
