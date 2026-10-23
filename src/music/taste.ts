/**
 * Вкус слушателя и «сборки волны».
 *
 * Считается только по тому, что человек реально делал: история прослушиваний (свежее весомее) и избранное.
 * Никаких внешних данных и разбора звука: «настроение» трека выводится из его жанра (так и сказано в интерфейсе).
 */
export interface TasteTrack { id: string; title: string; artist: string; genre?: string; plays?: number }

export interface Taste {
  total: number;                                    // сколько «сигналов» учтено (0 — рекомендовать нечего)
  genres: { genre: string; share: number }[];       // доли жанров, по убыванию, сумма ≈ 1
  artists: { artist: string; score: number }[];     // исполнители по весу, по убыванию
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();
const g = (t: TasteTrack) => norm(t.genre) || 'другое';

/** history — от самых свежих к старым. Избранное весит как три прослушивания, свежесть гасит вес постепенно. */
export const buildTaste = (history: TasteTrack[], favorites: TasteTrack[]): Taste => {
  const genre = new Map<string, number>(); const artist = new Map<string, number>(); let total = 0;
  const add = (t: TasteTrack, w: number) => {
    genre.set(g(t), (genre.get(g(t)) ?? 0) + w);
    const a = norm(t.artist); if (a) artist.set(a, (artist.get(a) ?? 0) + w);
    total += w;
  };
  history.forEach((t, i) => add(t, 1 / (1 + i * 0.04)));
  favorites.forEach((t) => add(t, 3));
  const names = new Map<string, string>(); [...history, ...favorites].forEach((t) => { if (norm(t.artist)) names.set(norm(t.artist), t.artist); });
  return {
    total,
    genres: [...genre].map(([k, v]) => ({ genre: k, share: total ? v / total : 0 })).sort((a, b) => b.share - a.share),
    artists: [...artist].map(([k, v]) => ({ artist: names.get(k) ?? k, score: v })).sort((a, b) => b.score - a.score),
  };
};

/** Рекомендация: жанры и исполнители вкуса выше, ещё не слышанное — немного выше, популярное — чуть-чуть. */
export const recommend = (pool: TasteTrack[], taste: Taste, heard: Set<string>, limit = 40): TasteTrack[] => {
  const gs = new Map(taste.genres.map((x) => [x.genre, x.share])); const top = taste.artists[0]?.score || 1;
  const as = new Map(taste.artists.map((x) => [norm(x.artist), x.score / top]));
  const score = (t: TasteTrack) => (gs.get(g(t)) ?? 0) * 3 + (as.get(norm(t.artist)) ?? 0) * 1.5 + (heard.has(t.id) ? 0 : 0.5) + Math.log1p(t.plays ?? 0) * 0.08;
  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, limit);
};

/* ── Настроение по жанру ─────────────────────────────────────────────── */
export const MOODS = [
  { id: 'calm',   name: 'Спокойное',     re: /ambient|lo-?fi|classic|классик|jazz|джаз|acoustic|акуст|chill|чилл|инструмент|instrumental|folk|фолк/ },
  { id: 'sad',    name: 'Грустное',      re: /blues|блюз|sad|груст|indie|инди|soul|соул|slow|слоу|emo|эмо|баллад|ballad/ },
  { id: 'energy', name: 'Энергичное',    re: /rock|рок|metal|метал|punk|панк|hip-?hop|хип-?хоп|rap|рэп|drum|драм|trap|трэп|hard|жест/ },
  { id: 'dance',  name: 'Танцевальное',  re: /pop|поп|dance|данс|house|хаус|disco|диско|electro|электро|techno|техно|synth|синт/ },
  { id: 'focus',  name: 'Для фокуса',    re: /ambient|lo-?fi|classic|классик|instrumental|инструмент|synthwave|электрон/ },
] as const;

export const moodOf = (t: TasteTrack) => MOODS.filter((m) => m.re.test(norm(t.genre)));
