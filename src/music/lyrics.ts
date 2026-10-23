/**
 * Разбор текста песни. Поддерживаются метки времени в общепринятом
 * виде — [мм:сс] или [мм:сс.дд]; строки без меток показываются просто
 * как текст, без подсветки по ходу песни.
 */
export const parseTimedLyrics = (raw: string): { t: number; text: string }[] => {
  const lines = String(raw ?? '').split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const out: { t: number; text: string }[] = [];
  for (const line of lines) {
    const m = /^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]\s*(.*)$/.exec(line);
    if (m) {
      const t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 100 : 0);
      out.push({ t, text: m[4] });
    } else {
      out.push({ t: out.length === 0 ? 0 : -1, text: line });
    }
  }
  // Если меток нет вовсе, оставляем строки без времени: подсветки не
  // будет, но текст человек прочитает.
  return out.every(l => l.t < 0 || l.t === 0) ? out.map(l => ({ ...l, t: 0 })) : out.filter(l => l.t >= 0);
};
