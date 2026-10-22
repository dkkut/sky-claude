/**
 * Сезонные темы: зима, Хэллоуин, лето, осень, весна. Накладываются на светлую/тёмную тему (colorScheme не трогают):
 * свой акцент, оттенок фона и лёгкие украшения (падающие снежинки, листья, лепестки…). «Авто» выбирает тему по дате.
 * Реализация — `applySettings` (store.ts): data-season на <html>, акцент и тёмная палитра инлайном, светлая — CSS в styles.css.
 */
export type Season = 'none' | 'auto' | 'winter' | 'halloween' | 'summer' | 'autumn' | 'spring';
export type SeasonId = Exclude<Season, 'none' | 'auto'>;

export interface SeasonDef {
  label: string;
  emoji: string;
  accent: string;                                       // основной цвет
  accentBg: string;                                     // плашки под акцент
  dark: { bg: string; l1: string; l2: string; l3: string };
  particles: string[];                                  // что «падает»
  rise?: boolean;                                       // летит вверх (пузырьки), а не падает
}

export const SEASONS: Record<SeasonId, SeasonDef> = {
  winter:    { label: 'Зима',      emoji: '❄️', accent: '#7dd3fc', accentBg: 'rgba(125,211,252,0.12)', dark: { bg: '#0a111d', l1: '#101a2b', l2: '#162339', l3: '#1d2d48' }, particles: ['❄', '❅', '❆'] },
  halloween: { label: 'Хэллоуин',  emoji: '🎃', accent: '#fb923c', accentBg: 'rgba(251,146,60,0.14)',  dark: { bg: '#0f0a14', l1: '#1a1022', l2: '#24162e', l3: '#2f1d3b' }, particles: ['🎃', '🦇', '👻'] },
  summer:    { label: 'Лето',      emoji: '☀️', accent: '#fbbf24', accentBg: 'rgba(251,191,36,0.13)',  dark: { bg: '#071a1c', l1: '#0e2527', l2: '#143134', l3: '#1b3f43' }, particles: ['✦', '○', '✧'], rise: true },
  autumn:    { label: 'Осень',     emoji: '🍂', accent: '#f59e0b', accentBg: 'rgba(245,158,11,0.13)',  dark: { bg: '#130e08', l1: '#1d150c', l2: '#281d11', l3: '#342516' }, particles: ['🍂', '🍁', '🍃'] },
  spring:    { label: 'Весна',     emoji: '🌸', accent: '#f472b6', accentBg: 'rgba(244,114,182,0.13)', dark: { bg: '#0a150f', l1: '#102019', l2: '#162c22', l3: '#1d392c' }, particles: ['🌸', '🌼', '🌱'] },
};

export const SEASON_ORDER: SeasonId[] = ['winter', 'halloween', 'summer', 'autumn', 'spring'];

/** Тема по дате: Хэллоуин 24.10–1.11, затем по месяцам (декабрь–февраль зима, март–май весна, июнь–август лето, сентябрь–ноябрь осень). */
export const seasonByDate = (d = new Date()): SeasonId => {
  const m = d.getMonth() + 1; const day = d.getDate();
  if ((m === 10 && day >= 24) || (m === 11 && day === 1)) return 'halloween';
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'autumn';
};

/** Какая тема действует сейчас (null — обычное оформление). */
export const resolveSeason = (s: Season | undefined, d = new Date()): SeasonId | null => {
  if (!s || s === 'none') return null;
  return s === 'auto' ? seasonByDate(d) : (s in SEASONS ? s : null);
};
