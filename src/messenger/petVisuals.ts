/* ===============================================================
   PET VISUALS — чисто косметический слой для реальных типов питомцев.

   Сервер (server/pets.mjs) ничего не знает про эмодзи, анимации
   настроений или звуки — там только id/name/species/color/rarity.
   Раньше (src/messenger/petData.ts) ровно эти же 12 id были локальным
   мок-каталогом с emoji/moods/sounds, который теперь сеется на сервер
   как стартовый каталог (SEED_TYPES в pets.mjs). Здесь та же роспись
   оставлена как чисто фронтовая декорация для тех же id — чтобы не
   терять анимации, которые уже были, — плюс запасной вариант для
   новых типов, которые когда-нибудь создаст админка.

   Ничего отсюда не уходит на сервер и не влияет на прогрессию/цены.
=============================================================== */
import type { PetMood } from './petsApi';

export interface PetVisual {
  emoji: string;
  sounds: string[];
  moods: Record<PetMood, string[]>;
}

const V = (emoji: string, sounds: string[], moods: Partial<Record<PetMood, string[]>>): PetVisual => ({
  emoji, sounds,
  moods: {
    idle: moods.idle ?? [emoji],
    happy: moods.happy ?? [emoji],
    excited: moods.excited ?? [emoji],
    sleepy: moods.sleepy ?? [emoji],
    love: moods.love ?? [emoji],
    angry: moods.angry ?? [emoji],
  },
});

const KNOWN: Record<string, PetVisual> = {
  'cat-neon': V('🐱', ['Мяу~', 'Пурр-пурр ♡', '*топочет лапками*', 'Мр-р-р', '*виляет хвостом*'], {
    idle: ['🐱', '😺', '🐾'], happy: ['😸', '🎉😸', '😻'], excited: ['😼', '⚡😼', '🌟😺'],
    sleepy: ['😴🐱', '💤😸', 'zz🐱'], love: ['😻', '💜🐱', '🐱💜'],
  }),
  'fox-sky': V('🦊', ['*гав!*', 'Аф-аф~', '*нюхает воздух*', 'Ка-ка-ка!', '*вертит хвостом*'], {
    idle: ['🦊', '🍂🦊', '🦊✨'], happy: ['🤩🦊', '🦊🎊', '😄🦊'], excited: ['🦊⚡', '🔥🦊', '🦊💥'],
    sleepy: ['💤🦊', '😴🦊', '🦊zzz'], love: ['🦊💛', '💝🦊', '🦊🧡'],
  }),
  'dragon-mini': V('🐲', ['*фыркает огнём*', 'Р-р-р!', '*машет крылышками*', 'РАРР!', '*пускает искры*'], {
    idle: ['🐲', '🐉', '🌿🐲'], happy: ['🐲🎉', '🔥🐲', '🐲⭐'], excited: ['💚🐲', '🐲💨', '⚡🐲'],
    sleepy: ['😪🐲', '💤🐲', '🐲😴'], love: ['🐲💚', '💝🐲', '🐲🌸'],
  }),
  'bunny-pixel': V('🐰', ['*топ-топ*', 'Чпок!', '*тычет носом*', '*уши торчком*', 'Вжуух!'], {
    idle: ['🐰', '🐇', '🌸🐰'], happy: ['🥰🐰', '🐰🎈', '🎀🐇'], excited: ['🐰💨', '⚡🐇', '🐰🏃'],
    sleepy: ['😴🐰', '💤🐇', '🐰zzz'], love: ['🐰❤️', '💗🐇', '🐰💕'],
  }),
  'wolf-void': V('🐺', ['*АУВУУ!*', 'Ворчит...', '*принюхивается*', 'Р-р-р', '*смотрит в душу*'], {
    idle: ['🐺', '🌑🐺', '🐺✨'], happy: ['🐺🎉', '😊🐺', '🌟🐺'], excited: ['🐺🔥', '⚡🐺', '💜🐺'],
    sleepy: ['😴🐺', '💤🐺', '🌙🐺'], love: ['🐺💜', '💝🐺', '🐺🫂'],
  }),
  'panda-zen': V('🐼', ['*хрустит бамбуком*', 'Ням-ням', '*зевает*', 'Ку-уу', '*кувыркается*'], {
    idle: ['🐼', '🎋🐼', '🐼🌿'], happy: ['🐼😊', '🐼🎉', '😄🐼'], excited: ['🐼⚡', '🎊🐼', '🐼🌟'],
    sleepy: ['😴🐼', '🐼💤', 'zzz🐼'], love: ['🐼💚', '💝🐼', '🐼🫶'],
  }),
  'unicorn-sky': V('🦄', ['✨✨✨', '*сыпет искрами*', 'Нейааа!', '*скачет по облакам*', '🌈🌈'], {
    idle: ['🦄', '🌈🦄', '✨🦄✨'], happy: ['🦄🎉', '🌟🦄', '🦄💫'], excited: ['🦄⚡', '🔮🦄', '🦄🌈'],
    sleepy: ['😴🦄', '💤✨', '🦄zzz'], love: ['🦄💖', '💝🦄', '🦄💗'],
  }),
  'penguin-ice': V('🐧', ['*скользит*', 'Гу-гу!', '*хлопает ластами*', 'Квак!', '*ныряет*'], {
    idle: ['🐧', '❄️🐧', '🐧🌊'], happy: ['🐧🎉', '😄🐧', '🐧🎊'], excited: ['🐧💨', '⚡🐧', '🐧🏄'],
    sleepy: ['😴🐧', '💤🐧', '🐧zzz'], love: ['🐧💙', '💝🐧', '🐧🫶'],
  }),
  'shark-reef': V('🦈', ['*щёлкает зубами*', 'Буль-буль~', '*делает круг*', '*выпускает пузыри*', 'Хлюп!'], {
    idle: ['🦈', '🌊🦈', '🦈💧'], happy: ['🦈🎉', '😊🦈', '🦈✨'], excited: ['🦈💨', '⚡🦈', '🦈🌊'],
    sleepy: ['😴🦈', '💤🦈', '🦈zzz'], love: ['🦈💙', '💝🦈', '🦈🫧'],
  }),
  'capybara-chill': V('🦫', ['*жуёт травинку*', 'Хрю~', '*ложится на бок*', '*моргает медленно*', 'Мнэ...'], {
    idle: ['🦫', '🌾🦫', '🦫💧'], happy: ['🦫😊', '🦫🎉', '😄🦫'], excited: ['🦫⚡', '🦫🎊', '✨🦫'],
    sleepy: ['😴🦫', '🦫💤', 'zzz🦫'], love: ['🦫🧡', '💝🦫', '🦫🫶'],
  }),
  'robot-byte': V('🤖', ['*бип-боп*', '01001000 01101001', '*жужжит сервоприводом*', 'Бзз!', '*мигает лампочкой*'], {
    idle: ['🤖', '⚙️🤖', '🤖💠'], happy: ['🤖✨', '🤖🎉', '😄🤖'], excited: ['🤖⚡', '🔋🤖', '🤖💥'],
    sleepy: ['😴🤖', '🤖💤', 'zzz🤖'], love: ['🤖💙', '💝🤖', '🤖🫶'],
  }),
  'ghost-boo': V('👻', ['Бу-у-у~', '*просвечивает*', '*парит на месте*', 'У-у-у!', '*исчезает и появляется*'], {
    idle: ['👻', '🌙👻', '👻✨'], happy: ['👻🎉', '😊👻', '👻💫'], excited: ['👻⚡', '🔮👻', '👻🌟'],
    sleepy: ['😴👻', '💤👻', '👻zzz'], love: ['👻💜', '💝👻', '👻🫶'],
  }),
};

/** Эвристика по виду (`species`) для типов, которых админка завела
 *  сама — у них нет записи выше, но, скорее всего, похожий вид уже
 *  встречался. Если нет и этого — общая запасная роспись. */
const SPECIES_FALLBACK: { test: RegExp; emoji: string }[] = [
  { test: /кот|кош/i, emoji: '🐱' }, { test: /лис/i, emoji: '🦊' }, { test: /драк/i, emoji: '🐲' },
  { test: /кролик|зайц/i, emoji: '🐰' }, { test: /волк/i, emoji: '🐺' }, { test: /панд/i, emoji: '🐼' },
  { test: /единор/i, emoji: '🦄' }, { test: /пингв/i, emoji: '🐧' }, { test: /акул/i, emoji: '🦈' },
  { test: /капибар/i, emoji: '🦫' }, { test: /робот|дроид/i, emoji: '🤖' }, { test: /привид|призрак/i, emoji: '👻' },
  { test: /сова/i, emoji: '🦉' }, { test: /медв/i, emoji: '🐻' }, { test: /собак|щен/i, emoji: '🐶' },
  { test: /дельфин/i, emoji: '🐬' }, { test: /тигр/i, emoji: '🐯' }, { test: /лев/i, emoji: '🦁' },
];

const GENERIC: PetVisual = V('🐾', ['*издаёт звук*', '*реагирует*', '*смотрит с интересом*'], {
  idle: ['🐾', '✨🐾'], happy: ['🐾😊', '🎉🐾'], excited: ['🐾⚡', '🐾💥'],
  sleepy: ['😴🐾', '💤🐾'], love: ['🐾💖', '💝🐾'], angry: ['🐾💢'],
});

export const petVisual = (typeId: string, species?: string): PetVisual => {
  const known = KNOWN[typeId];
  if (known) return known;
  if (species) {
    const hit = SPECIES_FALLBACK.find((f) => f.test.test(species));
    if (hit) return V(hit.emoji, GENERIC.sounds, GENERIC.moods);
  }
  return GENERIC;
};

export const RARITY_VISUAL: Record<string, { label: string; color: string; glow: string }> = {
  common: { label: 'Обычный', color: '#8a8a96', glow: 'rgba(138,138,150,0.3)' },
  uncommon: { label: 'Необычный', color: '#22c55e', glow: 'rgba(34,197,94,0.35)' },
  rare: { label: 'Редкий', color: '#3b82f6', glow: 'rgba(59,130,246,0.35)' },
  epic: { label: 'Эпический', color: '#a855f7', glow: 'rgba(168,85,247,0.4)' },
  legendary: { label: 'Легендарный', color: '#f59e0b', glow: 'rgba(245,158,11,0.5)' },
  mythic: { label: 'Мифический', color: '#ec4899', glow: 'rgba(236,72,153,0.5)' },
  secret: { label: 'Секретный', color: '#0f172a', glow: 'rgba(129,140,248,0.5)' },
};
