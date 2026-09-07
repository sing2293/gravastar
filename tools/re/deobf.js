// deobf.js — javascript-obfuscator string-array deobfuscator + pretty printer, runs under jsc.
// usage: jsc deobf.js -- <input.js> [--strings] [libDir]   (libDir holds acorn.min.js, walk.min.js, astring.min.js; default '.')
const TOOLS = (arguments.length > 1 && !arguments[arguments.length - 1].startsWith('--')) ? arguments[arguments.length - 1] : '.';
load(TOOLS + '/acorn.min.js'); load(TOOLS + '/walk.min.js'); load(TOOLS + '/astring.min.js');
const walk = acorn.walk;
const inputPath = arguments[0];
const dumpStrings = arguments[1] === '--strings';
const src = readFile(inputPath);
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
const stats = { arrays: 0, decoders: 0, iifes: 0, replaced: 0, missing: 0, dotified: 0, helpersInlined: 0, aliasesRemoved: 0 };
const isFn = n => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const isScope = n => isFn(n) || (n && n.type === 'Program');

// 1. string array functions
const arrayFns = new Map();
for (const st of ast.body) {
  if (st.type === 'FunctionDeclaration' && st.params.length === 0 && st.body.body.length === 2) {
    const [a, b] = st.body.body;
    if (a.type === 'VariableDeclaration' && a.declarations.length === 1 && a.declarations[0].init && a.declarations[0].init.type === 'ArrayExpression'
      && a.declarations[0].init.elements.length > 3 && a.declarations[0].init.elements.every(e => e && e.type === 'Literal' && typeof e.value === 'string')
      && b.type === 'ReturnStatement') arrayFns.set(st.id.name, st);
  }
}
// 2. decoders
const decoders = new Map();
for (const st of ast.body) {
  if (st.type === 'FunctionDeclaration' && st.params.length === 2 && st.body.body.length === 2) {
    const [a, b] = st.body.body;
    const init = a.type === 'VariableDeclaration' && a.declarations[0].init;
    if (init && init.type === 'CallExpression' && init.callee.type === 'Identifier' && arrayFns.has(init.callee.name) && b.type === 'ReturnStatement') {
      let offset = null;
      walk.simple(b, { AssignmentExpression(n) { if (n.operator === '-=' && n.right.type === 'Literal' && typeof n.right.value === 'number') offset = n.right.value; } });
      if (offset !== null) decoders.set(st.id.name, { arr: init.callee.name, offset, node: st });
    }
  }
}
// 3. rotation IIFEs
const iifes = [];
for (const st of ast.body) {
  if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression' && isFn(st.expression.callee) && st.expression.arguments.length === 0) {
    let usesDec = false, usesArr = false;
    walk.simple(st.expression.callee.body, { Identifier(n) { if (decoders.has(n.name)) usesDec = true; if (arrayFns.has(n.name)) usesArr = true; } });
    if (usesDec && usesArr) iifes.push(st);
  }
}
stats.arrays = arrayFns.size; stats.decoders = decoders.size; stats.iifes = iifes.length;

// 4. evaluate the self-contained obfuscation code to get the rotated tables
const decoded = new Map();
if (decoders.size) {
  const parts = [];
  for (const [, n] of arrayFns) parts.push(src.slice(n.start, n.end));
  for (const [, d] of decoders) parts.push(src.slice(d.node.start, d.node.end));
  for (const s of iifes) parts.push(src.slice(s.start, s.end));
  (0, eval)(parts.join('\n'));
  for (const [name, d] of decoders) {
    const arr = globalThis[d.arr]();
    const m = new Map();
    for (let i = 0; i < arr.length; i++) { try { m.set(d.offset + i, globalThis[name](d.offset + i)); } catch (e) { } }
    decoded.set(name, m);
  }
}
if (dumpStrings) { const o = {}; for (const [k, m] of decoded) { o[k] = {}; for (const [i, s] of m) o[k][i] = s; } print(JSON.stringify(o, null, 1)); }
else {
  // 5. scope-aware alias resolution
  const aliasesByScope = new Map(), paramsByScope = new Map(), shadowByScope = new Map();
  function patNames(p, out) { if (!p) return; switch (p.type) { case 'Identifier': out.add(p.name); break; case 'ObjectPattern': p.properties.forEach(pr => patNames(pr.type === 'RestElement' ? pr.argument : pr.value, out)); break; case 'ArrayPattern': p.elements.forEach(e => patNames(e, out)); break; case 'RestElement': patNames(p.argument, out); break; case 'AssignmentPattern': patNames(p.left, out); break; } }
  const nearestScope = anc => { for (let i = anc.length - 2; i >= 0; i--) if (isScope(anc[i])) return anc[i]; return ast; };
  walk.fullAncestor(ast, (node, st, anc) => {
    if (isFn(node)) { const s = new Set(); node.params.forEach(p => patNames(p, s)); paramsByScope.set(node, s); }
    if (node.type === 'VariableDeclarator') {
      const scope = nearestScope(anc);
      if (node.id.type === 'Identifier' && node.init && node.init.type === 'Identifier') {
        if (!aliasesByScope.has(scope)) aliasesByScope.set(scope, new Map());
        aliasesByScope.get(scope).set(node.id.name, node.init.name);
      } else { const s = new Set(); patNames(node.id, s); if (!shadowByScope.has(scope)) shadowByScope.set(scope, new Set()); s.forEach(x => shadowByScope.get(scope).add(x)); }
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id && !decoders.has(node.id.name) && !arrayFns.has(node.id.name)) { const scope = nearestScope(anc); if (!shadowByScope.has(scope)) shadowByScope.set(scope, new Set()); shadowByScope.get(scope).add(node.id.name); }
  });
  function resolve(name, chain) {
    let cur = name, startIdx = 0;
    for (let depth = 0; depth < 25; depth++) {
      let found = false;
      for (let i = startIdx; i < chain.length; i++) {
        const s = chain[i], al = aliasesByScope.get(s);
        if (al && al.has(cur)) { cur = al.get(cur); startIdx = i; found = true; break; }
        const pm = paramsByScope.get(s); if (pm && pm.has(cur)) return null;
        const sh = shadowByScope.get(s); if (sh && sh.has(cur)) return null;
      }
      if (!found) return decoders.has(cur) ? cur : null;
    }
    return null;
  }
  const chainOf = anc => { const c = []; for (let i = anc.length - 2; i >= 0; i--) if (isScope(anc[i])) c.push(anc[i]); return c; };
  const toLiteral = (node, v) => { for (const k of Object.keys(node)) if (k !== 'start' && k !== 'end') delete node[k]; node.type = 'Literal'; node.value = v; node.raw = JSON.stringify(v); };
  walk.fullAncestor(ast, (node, st, anc) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.arguments.length >= 1 && node.arguments.length <= 2 && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'number') {
      const d = resolve(node.callee.name, chainOf(anc));
      if (d) { const v = decoded.get(d).get(node.arguments[0].value); if (v !== undefined) { toLiteral(node, v); stats.replaced++; } else stats.missing++; }
    }
  });
  // 6. dotify
  const RESERVED = new Set('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await'.split(' '));
  const isIdent = s => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) && !RESERVED.has(s);
  walk.full(ast, node => {
    if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string' && isIdent(node.property.value)) { node.computed = false; node.property = { type: 'Identifier', name: node.property.value }; stats.dotified++; }
    if ((node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && node.computed && node.key.type === 'Literal' && typeof node.key.value === 'string' && isIdent(node.key.value)) { node.computed = false; node.key = { type: 'Identifier', name: node.key.value }; stats.dotified++; }
  });
  // 7. inline opaque helper objects — iterated, since helper objects reference each other
  const clone = n => JSON.parse(JSON.stringify(n));
  const KEYRE = /^[A-Za-z]{5}$/;
  function usesThis(n) { let t = false; walk.full(n, x => { if (x.type === 'ThisExpression' || (x.type === 'Identifier' && x.name === 'arguments')) t = true; }); return t; }
  function countIdent(n, name) { let c = 0; walk.full(n, (x, s, type) => { if (type === 'Identifier' && x.name === name) c++; }); return c; }
  function assignedTo(scope, name) { let t = false; walk.full(scope, x => {
    if (x.type === 'AssignmentExpression' && ((x.left.type === 'MemberExpression' && x.left.object.type === 'Identifier' && x.left.object.name === name) || (x.left.type === 'Identifier' && x.left.name === name))) t = true;
    if (x.type === 'UpdateExpression' && x.argument.type === 'MemberExpression' && x.argument.object.type === 'Identifier' && x.argument.object.name === name) t = true;
  }); return t; }
  function subst(n, params, args) {
    if (!n || typeof n !== 'object') return n;
    if (Array.isArray(n)) return n.map(x => subst(x, params, args));
    if (n.type === 'Identifier') { const i = params.indexOf(n.name); return i >= 0 ? clone(args[i]) : n; }
    const out = {};
    for (const k of Object.keys(n)) {
      if (n.type === 'MemberExpression' && !n.computed && k === 'property') out[k] = n[k];
      else if (n.type === 'Property' && !n.computed && k === 'key') out[k] = n[k];
      else out[k] = subst(n[k], params, args);
    }
    return out;
  }
  const replaceNode = (node, repl) => { for (const k of Object.keys(node)) delete node[k]; Object.assign(node, repl); };
  let helpersByScope = new Map();
  function collectHelpers() {
    helpersByScope = new Map();
    walk.fullAncestor(ast, (node, st, anc) => {
      if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !node.init || node.init.type !== 'ObjectExpression') return;
      const props = node.init.properties;
      const okKey = p => p.type === 'Property' && !p.computed && (p.key.type === 'Identifier' || p.key.type === 'Literal') && KEYRE.test(String(p.key.name ?? p.key.value));
      const nOk = props.filter(okKey).length;
      if (!props.length || nOk < 1 || nOk * 2 < props.length) return;
      if (!props.some(p => okKey(p) && /[A-Z]/.test(String(p.key.name ?? p.key.value).slice(1)))) return;
      const scope = nearestScope(anc);
      if (assignedTo(scope, node.id.name)) return;
      const map = new Map();
      for (const p of props) {
        if (!okKey(p)) continue;
        const key = String(p.key.name ?? p.key.value), v = p.value;
        if (v.type === 'Literal') map.set(key, { kind: 'lit', node: v });
        else if (v.type === 'FunctionExpression' && !v.async && !v.generator && v.params.every(q => q.type === 'Identifier') && v.body.body.length === 1 && v.body.body[0].type === 'ReturnStatement' && v.body.body[0].argument && !usesThis(v.body.body[0].argument)
          && v.params.every(q => countIdent(v.body.body[0].argument, q.name) <= 1)) map.set(key, { kind: 'fn', params: v.params.map(q => q.name), expr: v.body.body[0].argument });
      }
      if (!map.size) return;
      if (!helpersByScope.has(scope)) helpersByScope.set(scope, new Map());
      helpersByScope.get(scope).set(node.id.name, { map, decl: node });
    });
  }
  function inlineHelpers() {
    let n = 0; if (!helpersByScope.size) return 0;
    walk.fullAncestor(ast, (node, st, anc) => {
      const chain = chainOf(anc);
      const lookup = objName => { for (const s of chain) { const h = helpersByScope.get(s); if (h && h.has(objName)) return h.get(objName); } return null; };
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed && node.callee.object.type === 'Identifier' && node.callee.property.type === 'Identifier') {
        const h = lookup(node.callee.object.name); if (!h) return;
        const e = h.map.get(node.callee.property.name); if (!e || e.kind !== 'fn' || e.params.length !== node.arguments.length) return;
        replaceNode(node, subst(clone(e.expr), e.params, node.arguments)); n++;
      } else if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.property.type === 'Identifier') {
        const parent = anc[anc.length - 2]; if (parent && parent.type === 'CallExpression' && parent.callee === node) return;
        if (parent && parent.type === 'AssignmentExpression' && parent.left === node) return;
        const h = lookup(node.object.name); if (!h) return;
        const e = h.map.get(node.property.name); if (!e || e.kind !== 'lit') return;
        replaceNode(node, clone(e.node)); n++;
      }
    });
    stats.helpersInlined += n; return n;
  }
  // 7b. constant-fold literal comparisons and prune dead branches (obfuscator dead-code injection)
  stats.folded = 0; stats.pruned = 0;
  const litOf = n => n && n.type === 'Literal' ? { v: n.value } : (n && n.type === 'UnaryExpression' && n.operator === '!' && n.argument.type === 'Literal' ? { v: !n.argument.value } : null);
  function foldConstants() {
    let changed = 0;
    walk.full(ast, node => {
      if (node.type === 'BinaryExpression') {
        const a = litOf(node.left), b = litOf(node.right);
        if (a && b && ['===', '!==', '==', '!='].includes(node.operator)) {
          const v = node.operator === '===' ? a.v === b.v : node.operator === '!==' ? a.v !== b.v : node.operator === '==' ? a.v == b.v : a.v != b.v;
          toLiteral(node, v); changed++; stats.folded++;
        }
      } else if (node.type === 'UnaryExpression' && node.operator === '!' && node.argument.type === 'Literal' && typeof node.argument.value === 'boolean') {
        toLiteral(node, !node.argument.value); changed++; stats.folded++;
      } else if (node.type === 'LogicalExpression' && node.left.type === 'Literal' && typeof node.left.value === 'boolean') {
        const keepRight = node.operator === '&&' ? node.left.value : node.operator === '||' ? !node.left.value : null;
        if (keepRight !== null) { const r = keepRight ? node.right : node.left; replaceNode(node, clone(r)); changed++; stats.folded++; }
      } else if (node.type === 'ConditionalExpression' && node.test.type === 'Literal' && typeof node.test.value === 'boolean') {
        replaceNode(node, clone(node.test.value ? node.consequent : node.alternate)); changed++; stats.pruned++;
      } else if (node.type === 'IfStatement' && node.test.type === 'Literal' && typeof node.test.value === 'boolean') {
        const br = node.test.value ? node.consequent : node.alternate;
        replaceNode(node, br ? clone(br) : { type: 'EmptyStatement' }); changed++; stats.pruned++;
      }
    });
    return changed;
  }
  for (let round = 0; round < 10; round++) {
    collectHelpers();
    const a = inlineHelpers(), b = foldConstants();
    stats.rounds = round + 1;
    if (!a && !b) break;
  }
  walk.full(ast, node => { if (node.type === 'BlockStatement' || node.type === 'Program') node.body = node.body.filter(s => s.type !== 'EmptyStatement'); });
  // 8. remove dead obfuscation nodes + unused aliases/helpers
  const dead = new Set([...iifes, ...[...arrayFns.values()], ...[...decoders.values()].map(d => d.node)]);
  ast.body = ast.body.filter(st => !dead.has(st));
  function pruneDeclarators(scope, pred) {
    walk.full(scope, node => {
      if (node.type !== 'VariableDeclaration') return;
      node.declarations = node.declarations.filter(d => !pred(d, scope));
    });
  }
  for (const [scope, al] of aliasesByScope) {
    const names = new Set([...al.entries()].filter(([k, v]) => resolve(k, [scope, ...(scope === ast ? [] : [ast])]) || decoders.has(v)).map(([k]) => k));
    if (!names.size) continue;
    const decls = [];
    walk.full(scope, node => { if (node.type === 'VariableDeclaration') decls.push(node); });
    for (const decl of decls) decl.declarations = decl.declarations.filter(d => {
      if (d.id.type !== 'Identifier' || !names.has(d.id.name) || !d.init || d.init.type !== 'Identifier') return true;
      const refs = countIdent(scope, d.id.name) - 1; if (refs > 0) return true; stats.aliasesRemoved++; return false;
    });
  }
  for (const [scope, hs] of helpersByScope) {
    const decls = []; walk.full(scope, node => { if (node.type === 'VariableDeclaration') decls.push(node); });
    for (const decl of decls) decl.declarations = decl.declarations.filter(d => { if (d.id.type !== 'Identifier' || !hs.has(d.id.name) || hs.get(d.id.name).decl !== d) return true; return countIdent(scope, d.id.name) - 1 > 0; });
  }
  walk.full(ast, node => { if (node.type === 'BlockStatement' || node.type === 'Program') node.body = node.body.filter(s => !(s.type === 'VariableDeclaration' && s.declarations.length === 0)); });
  print(astring.generate(ast, { indent: '  ' }));
  print('//@stats ' + JSON.stringify(stats));
}
