/**
 * Разбор файла субтитров.
 *
 * Автор приносит расшифровку тем файлом, который у него уже есть, —
 * WebVTT или SRT из любого расшифровщика. Форматы различаются мелочами
 * (шапка, номера строк, запятая вместо точки в долях секунды), поэтому
 * разбираем оба одним проходом, а не заводим два разбора.
 *
 * Разбор идёт в браузере только затем, чтобы показать автору, что
 * получилось, до отправки. Настоящая проверка всё равно на сервере: он
 * отбрасывает строки с отрицательным временем, с концом раньше начала
 * и пустые, и считает, сколько принял.
 */

export interface ParsedCue { start: number; end: number; text: string; speaker?: string }

/** «00:01:02.500», «01:02,500» и «62.5» — всё это одно и то же время. */
const parseStamp = (raw: string): number | null => {
  const s = raw.trim().replace(',', '.');
  const parts = s.split(':');
  if (parts.length > 3) return null;
  let sec = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0) return null;
    sec = sec * 60 + n;
  }
  return Number.isFinite(sec) ? sec : null;
};

const TIME_LINE = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/**
 * Имя говорящего: «Ведущий: слова» или тег <v Ведущий>. Берём только
 * если оно короткое и перед двоеточием нет знаков конца предложения —
 * иначе «И вот что важно: …» превратилось бы в говорящего.
 */
const splitSpeaker = (line: string): { speaker?: string; text: string } => {
  const tag = /^<v\s+([^>]{1,40})>\s*/.exec(line);
  if (tag) return { speaker: tag[1].trim(), text: line.slice(tag[0].length).trim() };
  const at = line.indexOf(':');
  if (at > 0 && at <= 24) {
    const name = line.slice(0, at).trim();
    if (name && !/[.!?…]/.test(name) && name.split(/\s+/).length <= 3) {
      return { speaker: name, text: line.slice(at + 1).trim() };
    }
  }
  return { text: line };
};

/** Разметка внутри строки субтитров нам не нужна: мы рисуем текст сами. */
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

export const parseSubtitles = (raw: string): ParsedCue[] => {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: ParsedCue[] = [];

  let i = 0;
  while (i < lines.length) {
    const m = TIME_LINE.exec(lines[i]);
    if (!m) { i += 1; continue; }
    const start = parseStamp(m[1]);
    const end = parseStamp(m[2]);
    i += 1;

    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !TIME_LINE.test(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    if (start === null || end === null || end <= start) continue;

    const joined = stripTags(body.join(' ').replace(/\s+/g, ' '));
    if (!joined) continue;
    const { speaker, text: clean } = splitSpeaker(joined);
    if (!clean) continue;
    out.push({ start, end, text: clean, speaker });
  }

  // Порядок по времени: файлы из разных расшифровщиков бывают
  // перемешаны, а подсветка текущей строки ищет делением пополам и
  // требует возрастания.
  return out.sort((a, b) => a.start - b.start);
};
