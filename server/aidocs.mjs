/**
 * Текст из офисных документов — без единой сторонней библиотеки.
 *
 * Почему так. DOCX и XLSX — это zip-архив с XML внутри, и чтобы
 * достать оттуда текст, хватает zlib, который в Node уже есть.
 * Тянуть ради этого пакет разбора документов в образ сервера, который
 * держит переписку и деньги, — плохой размен: каждая зависимость это
 * ещё один автор, которому приходится доверять, и ещё один путь
 * обновления, за которым надо следить.
 *
 * Что здесь НЕ делается, и намеренно:
 *
 *   • не выполняется ничего из документа. Макросы, формулы, внешние
 *     ссылки и OLE-вложения не трогаются вовсе — мы читаем только
 *     текстовые узлы;
 *   • не разбираются вложенные архивы и не ходим ни по одной ссылке
 *     из документа: документ с ссылкой на внутренний адрес сервера —
 *     обычный приём, и единственная защита от него — не ходить;
 *   • имена записей внутри архива никуда не попадают, кроме сравнения
 *     со списком нужных. Zip умеет хранить путь ../../etc/passwd, и
 *     распаковка «как есть» этим и опасна. Мы ничего не распаковываем
 *     на диск — только читаем в память нужные записи.
 *
 * Пределы на размер стоят и до распаковки, и после: архив в сто
 * килобайт разжимается в гигабайты, если его для этого и собирали.
 */
import { inflateRawSync } from 'node:zlib';

/** Сколько распакованного текста берём из одного документа. */
const MAX_UNPACKED = 12 * 1024 * 1024;
/** И сколько знаков текста отдаём дальше. */
export const MAX_DOC_CHARS = 200_000;

/* ─── Чтение zip ───────────────────────────────────────────────────
   Читается центральный каталог с конца файла: так надёжнее, чем идти
   по локальным заголовкам, — они бывают без размеров. */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

const findEocd = (buf) => {
  /* Комментарий архива — до 64 КБ, дальше искать незачем. */
  const from = Math.max(0, buf.length - 66 * 1024);
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
};

/**
 * Список записей архива: имя, способ сжатия, смещение и размеры.
 * Ничего не распаковывает — только читает оглавление.
 */
const readEntries = (buf) => {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (count > 5000 || pos >= buf.length) return null;

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) break;
    const method = buf.readUInt16LE(pos + 10);
    const compressed = buf.readUInt32LE(pos + 20);
    const uncompressed = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push({ name, method, compressed, uncompressed, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
};

/** Достать одну запись по имени. Имя сверяется точно, не по образцу. */
const readEntry = (buf, entries, wanted) => {
  const e = entries.find((x) => x.name === wanted);
  if (!e) return null;
  if (e.uncompressed > MAX_UNPACKED) return null;

  /* Локальный заголовок: его длина переменная, поэтому смещение самих
     данных считается по нему, а не берётся из оглавления. */
  const lo = e.localOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const end = start + e.compressed;
  if (end > buf.length) return null;

  const slice = buf.subarray(start, end);
  try {
    if (e.method === 0) return slice;
    if (e.method === 8) {
      const out = inflateRawSync(slice, { maxOutputLength: MAX_UNPACKED });
      return out;
    }
  } catch {
    /* Битый или нарочно испорченный архив — не наша забота, просто
       не разбираем. */
    return null;
  }
  return null;
};

/* ─── XML в текст ─────────────────────────────────────────────────
   Полноценный разбор XML тут не нужен и вреден: нам нужны только
   текстовые узлы, а всякая обработка сущностей и внешних ссылок — это
   ровно то место, где живут дыры вроде «миллиард смешков» и чтения
   локальных файлов. Поэтому теги просто выбрасываются. */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const unescapeXml = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
  if (code[0] === '#') {
    const n = code[1] === 'x' || code[1] === 'X'
      ? parseInt(code.slice(2), 16)
      : parseInt(code.slice(1), 10);
    /* Только осмысленные знаки: подставлять управляющие символы по
       номеру — способ протащить их дальше. */
    return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
  }
  return ENTITIES[code] ?? ' ';
});

const stripTags = (xml, breakOn) => {
  let out = xml;
  /* Абзацы и строки превращаем в переводы строк до того, как выкинем
     теги: иначе весь документ слипнется в одну строку. */
  for (const tag of breakOn) {
    out = out.replace(new RegExp(`</${tag}>`, 'g'), '\n');
  }
  out = out.replace(/<[^>]*>/g, '');
  return unescapeXml(out)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/* ─── Форматы ─────────────────────────────────────────────────────── */

/** Word: текст лежит в word/document.xml. */
const fromDocx = (buf, entries) => {
  const doc = readEntry(buf, entries, 'word/document.xml');
  if (!doc) return null;
  return stripTags(doc.toString('utf8'), ['w:p', 'w:br']);
};

/**
 * Excel: строки лежат отдельно от ячеек.
 *
 * Общие строки — в sharedStrings.xml, а лист ссылается на них
 * номером. Поэтому сначала читаем словарь, потом листы.
 */
const fromXlsx = (buf, entries) => {
  const sharedRaw = readEntry(buf, entries, 'xl/sharedStrings.xml');
  const shared = [];
  if (sharedRaw) {
    const xml = sharedRaw.toString('utf8');
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml)) !== null && shared.length < 200_000) {
      shared.push(stripTags(m[1], []));
    }
  }

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .slice(0, 24);
  if (!sheets.length) return null;

  const lines = [];
  for (const sheet of sheets) {
    const raw = readEntry(buf, entries, sheet.name);
    if (!raw) continue;
    const xml = raw.toString('utf8');
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let row;
    while ((row = rowRe.exec(xml)) !== null && lines.length < 50_000) {
      const cells = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cell;
      while ((cell = cellRe.exec(row[1])) !== null) {
        const attrs = cell[1];
        const inner = cell[2];
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (/\bt="s"/.test(attrs)) {
          const idx = Number(vMatch?.[1]);
          cells.push(Number.isInteger(idx) ? (shared[idx] ?? '') : '');
        } else if (/\bt="inlineStr"/.test(attrs)) {
          cells.push(stripTags(inner, []));
        } else {
          cells.push(unescapeXml(vMatch?.[1] ?? '').trim());
        }
      }
      const line = cells.join('\t').trim();
      if (line) lines.push(line);
    }
  }
  return lines.join('\n').trim();
};

/** PowerPoint: текст разбросан по слайдам. */
const fromPptx = (buf, entries) => {
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    .slice(0, 200);
  if (!slides.length) return null;

  const parts = [];
  slides.forEach((s, i) => {
    const raw = readEntry(buf, entries, s.name);
    if (!raw) return;
    const body = stripTags(raw.toString('utf8'), ['a:p']);
    if (body) parts.push(`— Слайд ${i + 1} —\n${body}`);
  });
  return parts.join('\n\n').trim();
};

/**
 * Достать текст из документа.
 *
 * Тип определяет вызывающий — по первым байтам, а не по расширению.
 * Возвращает { text } либо { error }.
 */
export const extractText = (buf, kind) => {
  if (kind === 'text') {
    const s = buf.toString('utf8');
    /* Если в «тексте» попадаются нулевые байты, это не текст, а
       двоичный файл с подходящим расширением. */
    if (s.includes('\u0000')) return { error: 'unsupported_type' };
    return { text: s.slice(0, MAX_DOC_CHARS) };
  }

  const entries = readEntries(buf);
  if (!entries) return { error: 'unsupported_type' };

  let out = null;
  if (kind === 'docx') out = fromDocx(buf, entries);
  else if (kind === 'xlsx') out = fromXlsx(buf, entries);
  else if (kind === 'pptx') out = fromPptx(buf, entries);
  else return { error: 'unsupported_type' };

  if (out === null) return { error: 'unsupported_type' };
  if (!out.trim()) return { error: 'empty_document' };
  return { text: out.slice(0, MAX_DOC_CHARS), truncated: out.length > MAX_DOC_CHARS };
};

/**
 * Какой это документ на самом деле.
 *
 * Office-форматы — это zip, поэтому одной подписи мало: различить их
 * можно только по тому, что лежит внутри. Присланный Content-Type и
 * расширение здесь не участвуют.
 */
export const sniffDocument = (buf) => {
  if (!buf || buf.length < 8) return null;

  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { kind: 'pdf', mime: 'application/pdf' };
  }

  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
  if (isZip) {
    const entries = readEntries(buf);
    if (!entries) return null;
    const has = (name) => entries.some((e) => e.name === name);
    if (has('word/document.xml')) {
      return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
    if (entries.some((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))) {
      return { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }
    if (entries.some((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))) {
      return { kind: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    }
    /* Просто zip — не разбираем: внутри может быть что угодно, и
       «посмотри, что в архиве» это уже другая работа. */
    return null;
  }

  /* Остаётся текст. Признаём им только то, что целиком читается как
     UTF-8 и не содержит нулевых байтов: иначе «текстом» окажется
     исполняемый файл. */
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  if (head.includes(0)) return null;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(head);
  if (decoded.includes('\ufffd')) return null;
  return { kind: 'text', mime: 'text/plain' };
};
