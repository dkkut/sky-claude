/**
 * Настройки эквалайзера и профиля звука (на этом устройстве).
 * Сам граф Web Audio живёт в audioLevels.ts — у <audio> его можно построить только один раз.
 * Файлы играют такими, какими загружены: сервер ничего не перекодирует, поэтому «качество» здесь —
 * это обработка при воспроизведении, а не выбор битрейта.
 */

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const EQ_RANGE = 12;

export type ProfileId = 'original' | 'balanced' | 'night';
export const PROFILES: Record<ProfileId, { name: string; hint: string; comp: null | { threshold: number; ratio: number; knee: number; attack: number; release: number } }> = {
  original: { name: 'Оригинал', hint: 'Без обработки: звук такой, как в файле.', comp: null },
  balanced: { name: 'Ровная громкость', hint: 'Мягко выравнивает тихие и громкие места.', comp: { threshold: -24, ratio: 3, knee: 24, attack: 0.01, release: 0.25 } },
  night: { name: 'Ночной', hint: 'Сильнее сжимает динамику — удары и пики не будят.', comp: { threshold: -34, ratio: 8, knee: 18, attack: 0.005, release: 0.3 } },
};

export const EQ_PRESETS: { id: string; name: string; bands: number[] }[] = [
  { id: 'flat', name: 'Плоский', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Бас', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Вокал', bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'rock', name: 'Рок', bands: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4] },
  { id: 'pop', name: 'Поп', bands: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  { id: 'electro', name: 'Электроника', bands: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5] },
  { id: 'classic', name: 'Классика', bands: [3, 2, 1, 0, 0, 0, -1, -1, 2, 3] },
  { id: 'treble', name: 'Высокие', bands: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6] },
];

export interface FxSettings { eqOn: boolean; bands: number[]; profile: ProfileId }
const KEY = 'sky:audiofx:v1';
const DEFAULT: FxSettings = { eqOn: false, bands: EQ_FREQS.map(() => 0), profile: 'original' };

const clamp = (n: unknown) => Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number.isFinite(Number(n)) ? Math.round(Number(n) * 2) / 2 : 0));

const load = (): FxSettings => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT;
    const bands = Array.isArray(raw.bands) && raw.bands.length === EQ_FREQS.length ? raw.bands.map(clamp) : DEFAULT.bands;
    const profile: ProfileId = raw.profile in PROFILES ? raw.profile : 'original';
    return { eqOn: !!raw.eqOn, bands, profile };
  } catch { return DEFAULT; }
};

let cur = load();
const subs = new Set<(s: FxSettings) => void>();

export const getFx = () => cur;
/** Нужна ли обработка вообще: если нет, граф Web Audio можно не строить. */
export const fxActive = (s: FxSettings = cur) => (s.eqOn && s.bands.some((b) => b !== 0)) || s.profile !== 'original';

export const setFx = (patch: Partial<FxSettings>) => {
  cur = { ...cur, ...patch, bands: (patch.bands ?? cur.bands).map(clamp) };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* хранилище недоступно — настройка живёт до перезагрузки */ }
  subs.forEach((fn) => fn(cur));
};

export const subscribeFx = (fn: (s: FxSettings) => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
