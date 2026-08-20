# Conversion references

- [EV Nova Resource Bible](https://andrews05.github.io/evstuff/guides/evnbible.html)
- [NovaParse](https://github.com/mattsoulanille/NovaParse)
- [EVNToEndlessSky](https://github.com/edelventhal/EVNToEndlessSky)
- [BurgerLib](https://github.com/Olde-Skuul/burgerlib)
- [evnova-utils](https://github.com/vasi/evnova-utils)
- [Endless Sky](https://github.com/endless-sky/endless-sky)

Useful constraints from the Bible:

- Resource IDs start at 128; many cross-resource fields use zero-based indexes instead of IDs.
- Plug-ins override same-numbered resources loaded from Nova Files.
- Core conversion resources include `dësc`, `oütf`, `shïp`, `spöb`, `sÿst`, and `wëap`; missions and control-bit expressions need separate handling.
- Resource types use MacRoman characters, not plain ASCII spellings.

EVNToEndlessSky preflight:

- Rezilla template export requires `flët/ActivateOn`: change `C100` to `T100`.
- Six XML inputs may need split parsing, followed by manual JSON merge.
- Current repo converter registers only `outfits`; full ES conversion still needs additional porters.
- Current BurgerLib → NovaParse bridge bypasses both XML-specific steps.
