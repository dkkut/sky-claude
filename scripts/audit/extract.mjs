import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../../server/routes/', import.meta.url).pathname;
const out = new Set();
for (const f of readdirSync(dir)) {
  const src = readFileSync(dir + f, 'utf8');
  // literal paths with method on same line
  for (const m of src.matchAll(/method === '(GET|POST|PUT|PATCH|DELETE)'[^\n]*?(?:url|path|pathname|p) === '([^']+)'/g)) out.add(`${m[1]} ${m[2]}|${f}`);
  for (const m of src.matchAll(/(?:url|path|pathname|p) === '([^']+)'[^\n]*?method === '(GET|POST|PUT|PATCH|DELETE)'/g)) out.add(`${m[2]} ${m[1]}|${f}`);
  // regex paths
  for (const m of src.matchAll(/method === '(GET|POST|PUT|PATCH|DELETE)'[^\n]*?\.match\(\/\^([^\n]+?)\$\/\)/g)) {
    const p = m[2].replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)|\(\[\\w-\]\+\)|\(\[\\w\.-\]\+\)|\(\[\^\/\?\]\+\)|\(\\d\+\)|\([^)]*\)/g, 'ID1');
    out.add(`${m[1]} ${p}|${f}`);
  }
}
const arr = [...out].sort();
writeFileSync(process.argv[2], arr.join('\n'));
console.log(arr.length);
