/* ===============================================================
   SKY i18n — движок сопоставления.

   Ключ словаря — русская строка из исходников, в которой пробелы
   схлопнуты, а подстановки шаблонных строк заменены на {0}, {1} …
   Значение — английская строка с теми же {0}, {1}.

   Порядок поиска для текста узла:
     1. точное совпадение;
     2. шаблон со вставками ({0} дн., Привет, {0}!);
     3. число + слово («5 дня» → «5 days»);
     4. составной текст по разделителям (« · », « — », запятая …);
     5. известное начало или конец + произвольный остаток (имя).
   Что не нашлось — остаётся как есть (пользовательский текст, имена).
=============================================================== */
export const CY = /[А-Яа-яЁё]/;

export const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Pattern { re: RegExp; tpl: string }

const SPLIT = /( · | • | — | – | \| | \/ |, |: |; |\. |\? |! |\n)/;

export class Engine {
  private exact = new Map<string, string>();
  private patterns: Pattern[] = [];
  private starts: [string, string][] = [];
  private ends: [string, string][] = [];
  private cache = new Map<string, string | null>();

  constructor(dict: Record<string, string>) {
    for (const [k, v] of Object.entries(dict)) {
      if (!v) continue;
      if (/\{\d+\}/.test(k)) {
        const parts = k.split(/\{\d+\}/).map(escRe);
        // жадность по краям, ленивость внутри: «{0} из {1}» разбирается без сюрпризов
        const re = new RegExp('^' + parts.join('(.+?)') + '$', 's');
        this.patterns.push({ re, tpl: v });
      } else {
        this.exact.set(k, v);
        if (k.length >= 4) {
          if (/[,:\-–—(]$/.test(k) || k.endsWith(' ')) this.starts.push([k, v]);
          if (/^[(,·•\-–—]/.test(k)) this.ends.push([k, v]);
        }
      }
    }
    // длинные начала проверяем раньше коротких
    this.starts.sort((a, b) => b[0].length - a[0].length);
    this.ends.sort((a, b) => b[0].length - a[0].length);
    // шаблоны с более длинной «опорой» — первыми
    this.patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  }

  private fill(tpl: string, groups: string[]) {
    return tpl.replace(/\{(\d+)\}/g, (_, i) => {
      const g = groups[Number(i)] ?? '';
      return CY.test(g) ? (this.core(g, 1) ?? g) : g;
    });
  }

  private core(text: string, depth = 0): string | null {
    const hit = this.exact.get(text);
    if (hit !== undefined) return hit;

    for (const p of this.patterns) {
      const m = p.re.exec(text);
      if (m) return this.fill(p.tpl, m.slice(1));
    }
    if (depth > 1) return null;

    // число + слово: «5 дня», «12 990 ₽ в месяц»
    const num = /^([\d][\d\s.,:+\-–/%]*)\s+(\D.*)$/.exec(text);
    if (num && CY.test(num[2])) {
      const t = this.core(num[2], depth + 1);
      if (t) return `${num[1]} ${t}`;
    }
    const tail = /^(\D.*?)\s+([\d][\d\s.,:+\-–/%]*)$/.exec(text);
    if (tail && CY.test(tail[1])) {
      const t = this.core(tail[1], depth + 1);
      if (t) return `${t} ${tail[2]}`;
    }

    // составной текст
    const pieces = text.split(SPLIT);
    if (pieces.length > 1) {
      let changed = false;
      const out = pieces.map((p, i) => {
        if (i % 2 === 1 || !CY.test(p)) return p;
        const t = this.core(p.trim(), depth + 1);
        if (t) { changed = true; return t; }
        return p;
      });
      if (changed) return out.join('');
    }

    // известное начало + остаток (имя, число, название)
    for (const [k, v] of this.starts) {
      if (text.length > k.length && text.startsWith(k)) {
        return `${v}${text.slice(k.length)}`;
      }
    }
    for (const [k, v] of this.ends) {
      const kk = k.trim();
      if (kk.length >= 3 && text.length > kk.length && text.endsWith(kk)) {
        return `${text.slice(0, text.length - kk.length)}${v}`;
      }
    }
    return null;
  }

  /** Короткое название из нескольких слов («Тёмный Жетон»): переводим по словам,
   *  но только если переведётся КАЖДОЕ русское слово — иначе это не то, что мы знаем. */
  private words(text: string): string | null {
    const toks = text.split(' ');
    if (toks.length < 2 || toks.length > 5) return null;
    // только «Заглавное Заглавное»: так выглядят сгенерированные названия
    // предметов; имя чата или человека («Группа друзей», «Новости Sky»)
    // сюда попадать не должно.
    if (!toks.every((t) => /^[А-ЯЁ][а-яё]+$/.test(t))) return null;
    const out: string[] = [];
    for (const t of toks) {
      const hit = this.exact.get(t) ?? this.exact.get(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
        ?? this.exact.get(t.toLowerCase());
      if (hit === undefined) return null;
      out.push(hit);
    }
    return out.join(' ');
  }

  /** Перевод ядра строки (без пробелов по краям). null — перевода нет. */
  translateCore(core: string): string | null {
    if (this.cache.has(core)) return this.cache.get(core)!;
    // «…» и «...» в исходниках встречаются вперемешку — словарь знает один вид
    let r = this.core(core);
    if (r === null && core.includes('…')) r = this.core(core.replace(/…/g, '...'));
    if (r === null && core.includes('...')) r = this.core(core.replace(/\.\.\./g, '…'));
    if (r === null) r = this.words(core);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(core, r);
    return r;
  }

  /** Перевод строки с сохранением пробелов по краям. */
  translate(text: string): string | null {
    if (!CY.test(text)) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    const t = this.translateCore(norm(m[2]));
    return t === null ? null : m[1] + t + m[3];
  }

  /** Шаблонный перевод с подстановкой: t('Осталось {0} шт.', 5). */
  format(ruTemplate: string, args: (string | number)[]): string {
    const key = norm(ruTemplate);
    const hit = this.exact.get(key);
    const tpl = hit ?? key;
    return tpl.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
  }
}
