#!/usr/bin/env node
/**
 * Проверка словаря перевода: какие русские строки в src/ не имеют
 * английского перевода в src/i18n/en.json.
 *
 *     npm run i18n:check            # список непереведённых
 *     npm run i18n:check -- --json  # то же, JSON (для скриптов)
 *
 * Ключ словаря — русская строка, в которой пробелы схлопнуты, а
 * подстановки шаблонных строк заменены на {0}, {1} … Работает так же,
 * как разбор в src/i18n/engine.ts. Код возврата 1, если есть
 * непереведённое пользовательское — можно ставить в CI.
 *
 * Не считаются: комментарии, строки без кириллицы, пути ../docs/…, а
 * также строки внутри <style>/GLSL (длиннее 600 символов).
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CY = /[А-Яа-яЁё]/;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const dict = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en.json'), 'utf8'));

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p);
  }
};
walk(join(ROOT, 'src'));

/* Не интерфейс: подсказка для Sky AI, раскладка экранной клавиатуры и
   окончания, которые подставляются в уже переведённые шаблоны. */
const IGNORE = new Set(['по-русски', 'по-английски', 'а', 'ы', 'я', 'и', 'е', 'ое', 'ых', 'ЙЦУКЕНГШЩЗХ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ']);
const IGNORE_PREFIX = ['Ты — семейный финансовый и бытовой ассистент'];

const missing = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (raw) => {
    const k = norm(raw);
    if (!k || !CY.test(k) || k.length > 600 || /^\.\.\/\.\.\/docs\//.test(k)) return;
    if (k in dict || IGNORE.has(k) || IGNORE_PREFIX.some((p) => k.startsWith(p))) return;
    if (!missing.has(k)) missing.set(k, f.replace(`${ROOT}/`, ''));
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) add(n.text);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) {
      let i = 0; let t = n.head.text;
      for (const sp of n.templateSpans) t += `{${i++}}` + sp.literal.text;
      add(t);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify([...missing].map(([k, f]) => ({ key: k, file: f })), null, 2));
} else if (missing.size === 0) {
  console.log('i18n: все русские строки имеют перевод.');
} else {
  console.log(`i18n: без перевода ${missing.size} строк(и). Добавьте их в src/i18n/en.json:\n`);
  for (const [k, f] of missing) console.log(`  ${f}\n    ${JSON.stringify(k)}`);
}
process.exit(missing.size ? 1 : 0);
