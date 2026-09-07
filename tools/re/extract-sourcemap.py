#!/usr/bin/env python3
"""Write every `sourcesContent` entry of a webpack source map to disk.  usage: extract-sourcemap.py app.js.map outdir"""
import collections, json, os, re, sys
m = json.load(open(sys.argv[1])); out = sys.argv[2]; seen = collections.Counter(); n = 0
for s, c in zip(m['sources'], m.get('sourcesContent') or []):
    if not c: continue
    base, _, q = re.sub(r'^webpack:///?', '', s).partition('?'); base = base.lstrip('./')
    if q and not re.fullmatch(r'[0-9a-f]+', q):   # keep vue-loader part names (?vue&type=script...)
        base += '.' + re.sub(r'[^a-z0-9]+', '_', re.sub(r'[0-9a-f]{6,}', '', q).lower()).strip('_')
    seen[base] += 1
    if seen[base] > 1: base = f'{base}.{seen[base]}'
    fp = os.path.join(out, re.sub(r'[^A-Za-z0-9_./@\-]', '_', base)); os.makedirs(os.path.dirname(fp), exist_ok=True)
    open(fp, 'w').write(c); n += 1
print('wrote', n, 'files to', out)
