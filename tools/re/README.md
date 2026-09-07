# Reverse-engineering tooling

How the protocol docs in `docs/reverse-engineering/` were produced. Nothing here needs Node — it runs on a stock Mac
with `jsc` (JavaScriptCore), `python3` and `curl`.

1. `fetch-vendor-bundles.sh <dir>` — downloads the GS HUB shell, the K98 Pro sub-app chunks and the Compx HUB
   mouse tool (plus its published `.map` files) into `<dir>`. The bundles are vendor property and are not committed.
2. `extract-sourcemap.py <app.js.map> <outdir>` — the mouse tool ships `sourcesContent`, so its original Vue/JS
   source can be written straight to disk.
3. `deobf.js` — the K98 Pro protocol library is protected with javascript-obfuscator (rotated string arrays,
   opaque helper objects, dead-code injection). This script parses the bundle with acorn, executes the string-array
   rotation code to recover the tables, resolves scoped decoder aliases, converts `obj["prop"]` to `obj.prop`,
   inlines the helper objects, constant-folds the dead-branch predicates and pretty-prints with astring.

   ```sh
   mkdir lib && cd lib
   curl -sSLO https://cdnjs.cloudflare.com/ajax/libs/acorn/8.12.1/acorn.min.js
   curl -sSLO https://cdnjs.cloudflare.com/ajax/libs/acorn-walk/8.3.3/walk.min.js
   curl -sSL  https://cdn.jsdelivr.net/npm/astring@1.8.6/dist/astring.min.js -o astring.min.js
   cd ..
   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
   "$JSC" tools/re/deobf.js -- k98pro-app/js/index-<hash>.js lib > index.deob.js     # last line is //@stats {...}
   "$JSC" tools/re/deobf.js -- k98pro-app/js/index-<hash>.js --strings lib > strings.json
   ```
   It also pretty-prints non-obfuscated chunks (0 decoders found → plain formatting).
