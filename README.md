# EV Nova to Endless Sky

Extraction scaffold for the Windows EV Nova install at `C:\Users\Isaac\EV Nova`.

## Current result

`parsed-data/format-report.json` records the detected file format. The installed files are Windows BurgerLib `.rez` containers (`BRGR`). `extract:all` decodes them with `evnova-utils`, builds NovaParse-compatible resource forks, then parses those files.

`vendor/novaparse/` is the NovaParse source repo, built locally before use.

`vendor/burgerlib/` documents the `BRGR` container format. `vendor/evnova-utils/` supplies a working Perl `ResourceFork` reader for Windows EVN `.rez` files.

`reference/evntoes/` contains selected checked-in outputs from EVNToEndlessSky: its parsed JSON and generated ES data files. These are reference artifacts, not a claim that they came from this Windows install.

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

Conversion output: `converted-plugin/`. The root also contains `plugin.txt` metadata. The `data/` folder contains ES text for ships, outfits/weapons, planets, systems, shops, fleets, and an explosion placeholder. The `images/` folder contains raw extracted resources plus ES aliases under `ship/`, `planet/`, `outfit/`, and `projectile/`; `_menu/endless-nova-title@1x.png` (1024×477) and `_menu/endless-nova-title@2x.png` (2048×954) override the ES menu title and are resized from `_menu/title-source.png`. The `sounds/` folder contains converted WAV files named `evn-<id>.wav`. The `source/` folder contains JSON copies for every detected EVN resource type, including types with no direct ES equivalent. `conversion-manifest.json` records counts, mappings, and asset errors.

The converter follows current Endless Sky data conventions for nested `attributes`, `outfits`, `weapon`, and `fleet` blocks. EVN control-bit expressions and availability rules remain preserved source data until dedicated ES mappings exist. Some EVN PICT resources use formats unsupported by `rsrcdump`; those are listed in `conversion-manifest.json` and do not block the usable assets.

## Installed test copy

The current plugin copy is installed at:

```text
C:\Program Files (x86)\Steam\steamapps\common\Endless Sky\plugins\endless-nova-tc
```

Endless Sky loaded the plugin without parser or unrecognized-attribute errors after adding weapon port capacity, fitting ship loadouts to available outfit space, and changing planet `pos` output to ES-compatible landscape data. Ship thumbnail aliases and planet landscape aliases are also generated. Planet records now recover and emit EVN government assignments for 306 planets. EVN dock flags now drive ES landing, outfitter, and shipyard entries. Thirty-five generic tech-tier outfitters and 20 generic tech-tier shipyards are generated. Planet `SpecialTech` values now create 154 dedicated outfitters and 49 dedicated shipyards with exact-tech EVN items. Tech-tier license outfits now gate converted ships and outfits. System records now emit 542 ES trade prices from EVN commodity exchange flags, EVN controlling governments, asteroid fields, 2,708 traffic/reinforcement fleet schedules, and 275 fleet definitions from `sÿst`, `spöb`, `düde`, and `flët` metadata; EVN murk now selects ES system haze artwork on 187 systems, while sensor interference and visibility expressions remain explicit EVN system attributes. Planet records now emit 259 ES tribute entries and 216 defense-fleet mappings; EVN encoded defense waves become total ES tribute-fleet spawns. EVN `nëbu` map decorations remain in `source/nëbu.json` because ES has no direct nebula-region syntax. `düde` probability lists become weighted ES fleet variants; `flët` lead/escort formations become fixed variants using mean escort counts. Mission catalog stubs preserve 507 EVN missions; 18 simple paid delivery/visit/passenger/escort contracts are active, with EVN boolean availability expressions, 83 control-bit flags, recovered cargo/passenger quantities, EVN deadlines, four special-ship NPC groups, failure/abort bit actions, and completion reputation rewards mapped to ES mission data. Recoverable EVN `dësc` text now emits as 39 ES conversations covering offer, completion, and decline states; complex branch choices and unrecovered mission behavior remain pending. The EVN `.Trader` `chär` template now appears as an `Endless Nova Trader` ES start at Kania / Port Kane with 25,000 credits, a Shuttle, and a pilot license. Plugin folder is now `endless-nova-tc`, with metadata name `Endless Nova TC`; its menu background now overwrites the stock interface with a unique EVN/ES hybrid sprite, `ENDLESS NOVA TC` lettering, and an Endless Sky star accent.

## EVNToEndlessSky preflight

The EVNToEndlessSky README documents two important manual steps:

- When using its Rezilla XML pipeline, change the `flët/ActivateOn` template field from type `C100` to `T100`. `T100` acts like a C string but advances the parser by 100 bytes, skipping padding in that structure. The checked-in `vendor/evntoes/resourceTemplates/templates.json` already contains this fix for one `ActivateOn` field; other `ActivateOn` fields remain `C100` because they belong to different resource templates.
- Its XML parser can fail when all six XML files are loaded together. Parse five, parse the sixth separately, then combine the JSON manually.

Neither exception applies to the current BurgerLib → NovaParse path: it does not use Rezilla templates or the six XML files. No separate resource-bit edit appears in the EVNToEndlessSky README. The remembered manual “resource bit” is likely the `C100` → `T100` template correction.

The EVNToEndlessSky converter itself currently registers only the `outfits` porter. It is useful as an output reference, but it does not provide complete ship, weapon, planet, system, mission, or government conversion.
