/**
 * Голосовые команды музыки («Включи Земфиру», «Включи альбом …», «Включи что-нибудь спокойное»,
 * «Сделай громче», «Что сейчас играет?»). Поиск делает сервер (`/api/music/voice`, нечёткое
 * сопоставление, транслит, псевдонимы); играет тот же плеер, что и везде (`playMusicQueue`) —
 * второго плеера и второй базы нет. Если подходит несколько вариантов, Sky спрашивает и ждёт
 * ответа («первый», «второй», название) до 60 секунд.
 */
import { apiCall } from '@/core/auth/api';
import { toClientTrack, type ServerTrack } from '@/music/musicApi';
import { playMusicQueue } from '@/music/useMusicSync';
import { usePlayerStore } from '@/player/playerStore';
import type { VoiceCommand } from '@/ai/voiceCommands';

interface Choice { type: string; id: string; title: string; sub?: string }
interface VoiceReply { intent: string; label?: string; items: ServerTrack[]; choices?: Choice[]; reason?: string }

let pending: { choices: Choice[]; at: number } | null = null;
const CHOICE_TTL = 60_000;

const REASONS: Record<string, string> = {
  not_found: 'Я не нашёл такого в музыке Sky',
  empty_catalog: 'В каталоге пока нет треков',
  no_favorites: 'В избранном пока пусто',
  no_playlists: 'У вас пока нет плейлистов',
  empty_playlist: 'Этот плейлист пуст',
  unknown_mood: 'Не понял, какое настроение включить',
  no_match: 'Подходящих треков не нашлось',
  empty_query: 'Скажите, что включить',
};

const play = (r: VoiceReply): string | null => {
  if (!r.items.length) return REASONS[r.reason ?? 'not_found'] ?? 'Ничего не нашлось';
  const pool = r.items.map(toClientTrack);
  playMusicQueue(pool, pool[0].id);
  const first = r.items[0];
  return r.intent === 'track' ? `Включаю: ${first.title} — ${first.artist}` : r.label ? `Включаю: ${r.label}` : null;
};

const ask = (choices: Choice[]): string => {
  pending = { choices: choices.slice(0, 5), at: Date.now() };
  const list = pending.choices.map((c, i) => `${i + 1}) ${c.title}${c.sub ? ` — ${c.sub}` : ''}`).join('; ');
  return `Нашлось несколько вариантов: ${list}. Что включить?`;
};

const resolve = async (kind: string, q: string): Promise<string | null> => {
  const r = await apiCall<VoiceReply>(`/api/music/voice?kind=${kind}&q=${encodeURIComponent(q)}`);
  if (!r.ok || !r.data) {
    if (r.error === 'prime_required') throw new Error('Музыка входит в Sky Prime — оформите подписку');
    throw new Error('Не получилось найти музыку. Проверьте связь');
  }
  if (r.data.choices?.length) return ask(r.data.choices);
  return play(r.data);
};

const choose = async (c: Choice): Promise<string | null> => {
  pending = null;
  const r = await apiCall<VoiceReply>('/api/music/voice/choose', { method: 'POST', body: JSON.stringify({ type: c.type, id: c.id }) });
  if (!r.ok || !r.data) throw new Error('Не получилось включить выбранное');
  return play(r.data);
};

const ORD: [RegExp, number][] = [[/перв|\b1\b|один\b/i, 0], [/втор|\b2\b|два\b/i, 1], [/трет|\b3\b|три\b/i, 2], [/четв|\b4\b|четыре\b/i, 3], [/пят|\b5\b/i, 4]];

/** Ответ на вопрос «Что включить?» — номер или часть названия. */
export const matchChoiceAnswer = (text: string): VoiceCommand | null => {
  if (!pending || Date.now() - pending.at > CHOICE_TTL) { pending = null; return null; }
  const t = text.trim().toLowerCase();
  if (/^(отмена|не надо|ничего|стоп)/.test(t)) { pending = null; return { label: 'Хорошо, не включаю', run: () => undefined }; }
  const list = pending.choices;
  let pick: Choice | undefined;
  for (const [re, i] of ORD) if (re.test(t) && list[i]) { pick = list[i]; break; }
  if (!pick) pick = list.find((c) => t.includes(c.title.toLowerCase()) || (c.sub && t.includes(c.sub.toLowerCase())));
  if (!pick) return null;
  const c = pick;
  return { label: c.title, run: () => choose(c) as Promise<string | void> };
};

const clean = (s: string) => s.replace(/^(пожалуйста|скай|sky)[,\s]*/i, '').replace(/[.!?…,]+$/g, '').trim();

const STEP = 0.15;
const setVol = (fn: (v: number) => number) => {
  const st = usePlayerStore.getState();
  if (!st.item) throw new Error('Сейчас ничего не играет');
  st.setVolume(Math.max(0, Math.min(1, fn(st.volume))));
};

/** Команды управления звуком и «что играет» + запросы «включи …». */
export const matchMusicCommand = (raw: string): VoiceCommand | null => {
  const choice = matchChoiceAnswer(raw);
  if (choice) return choice;
  const t = clean(raw);
  if (t.length > 90) return null;

  if (/^(сделай\s+)?(погромче|громче|увеличь\s+громкость|добавь\s+звук)/i.test(t)) return { label: 'Громче', run: () => setVol((v) => v + STEP) };
  if (/^(сделай\s+)?(потише|тише|уменьши\s+громкость|убавь\s+звук)/i.test(t)) return { label: 'Тише', run: () => setVol((v) => v - STEP) };
  if (/^что\s+(сейчас\s+)?играет|^какой\s+(это\s+)?трек|^что\s+это\s+за\s+(песня|трек)/i.test(t)) {
    return {
      label: 'Сейчас играет',
      run: () => {
        const it = usePlayerStore.getState().item;
        if (!it) return 'Сейчас ничего не играет';
        return it.author ? `Сейчас играет ${it.title} — ${it.author}` : `Сейчас играет ${it.title}`;
      },
    };
  }

  const m = /^(включи|поставь|запусти|сыграй|играй|врубай)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const rest = m[2].trim();
  // «Включи музыку» / «включи что-нибудь» — рассматривает media-правило «продолжить», если уже что-то играет.
  if (/^(музыку|что[\s-]*нибудь|что\s*то|любую\s+музыку|случайн\w+)$/i.test(rest)) {
    // Уже что-то стоит в плеере — «включи музыку» значит «продолжи» (правило управления плеером).
    if (/^музыку$/i.test(rest) && usePlayerStore.getState().item) return null;
    return { label: 'Включаю музыку', run: () => resolve('any_music', '') as Promise<string | void> };
  }
  if (/^(мо[ёе]\s+избранное|избранное|любим\w+)$/i.test(rest)) return { label: 'Избранное', run: () => resolve('favorites', '') as Promise<string | void> };
  let x: RegExpExecArray | null;
  if ((x = /^(?:мой\s+)?плейлист\s+(.+)$/i.exec(rest))) return { label: `Плейлист ${x[1]}`, run: () => resolve('playlist', x![1]) as Promise<string | void> };
  if ((x = /^альбом\s+(.+)$/i.exec(rest))) return { label: `Альбом ${x[1]}`, run: () => resolve('album', x![1]) as Promise<string | void> };
  if ((x = /^(?:песню|трек|композицию)\s+(.+)$/i.exec(rest))) return { label: x[1], run: () => resolve('track', x![1]) as Promise<string | void> };
  if ((x = /^(?:исполнителя|артиста|группу)\s+(.+)$/i.exec(rest))) return { label: x[1], run: () => resolve('artist', x![1]) as Promise<string | void> };
  if ((x = /^(?:что[\s-]*нибудь|музыку|песни)\s+(.+)$/i.exec(rest)) && /спокойн|расслаб|бодр|энергич|груст|работ|учёб|учеб|сон|тихо|chill|relax|focus/i.test(x[1])) {
    return { label: `Музыка: ${x[1]}`, run: () => resolve('mood', `что-нибудь ${x![1]}`) as Promise<string | void> };
  }
  // Не наша команда — раздел («включи кино», «включи подкасты» и т. п.) разберут правила навигации.
  if (/^(кино|фильм|сериал|подкаст|книг|видео|тв\b|tv\b|канал)/i.test(rest)) return null;
  return { label: rest, run: () => resolve('any', rest) as Promise<string | void> };
};
