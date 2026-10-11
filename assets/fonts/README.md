# Report font

`NotoSansSC-Regular.ttf` and `NotoSansSC-Bold.ttf` are static instances of the Simplified Chinese variable TrueType font from the Noto CJK project (weights 400 and 700).

- Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf
- License: SIL Open Font License 1.1, included in `OFL.txt`.
- The font is loaded locally and embedded into generated PDF reports. Report generation does not fetch remote resources.

The static instances avoid variable/synthetic font Type 3 fallbacks in Chromium PDF export. They were generated with `fontTools.varLib.instancer.instantiateVariableFont(font, {"wght": weight}, inplace=True, updateFontNames=True)`. The body and header explicitly embed the regular face; headings embed the bold face. The original font license applies to these instances.
