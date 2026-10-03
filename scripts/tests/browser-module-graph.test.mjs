import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

// These files are loaded as native ES modules by the HTTP editor, without an
// import map or a bundler. A transitive bare package import blocks the entire UI.
test('the editor module graph resolves in a browser without Node or bare package imports', async () => {
  const root = new URL('../../', import.meta.url), queue = [new URL('web/modules/app-runtime.js', root)], visited = new Set(), problems = [];
  while (queue.length) {
    const url = queue.pop(); if (visited.has(url.href)) continue; visited.add(url.href);
    const source = await fs.readFile(url, 'utf8'), ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    for (const statement of ast.body) {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type) || !statement.source) continue;
      const specifier = statement.source.value;
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) { problems.push(`${fileURLToPath(url)} imports ${specifier}`); continue; }
      const resolved = new URL(specifier, url);
      assert.ok(resolved.href.startsWith(root.href), `Browser import escapes repository: ${specifier}`); queue.push(resolved);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(visited.has(new URL('web/modules/app-object-projection.js', root).href), 'Include the real projection UI');
  assert.ok(visited.has(new URL('engine/object-projection-template.mjs', root).href), 'Include shared template helpers');
  assert.ok(visited.size > 30, 'Audit the transitive editor graph');
});
