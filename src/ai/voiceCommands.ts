/**
 * Голосовые команды Sky AI — закрытый список, как ASK_TASKS на сервере
 * (aichat.mjs): распознанная фраза выбирает готовое действие из
 * заранее описанного набора, а не превращается в произвольную
 * инструкцию модели. Само действие — обычный вызов уже существующей
 * навигации (useModuleStore) или уже существующей серверной ручки
 * (petsApi/quickMenuApi), тот же путь, которым «Bloom»/«SkyVideo»
 * уже открываются из других мест интерфейса (см. FeedWidgets.tsx), и
 * тот же путь, которым обычный тап переключает скин/пункт Quick Menu.
 *
 * Никакая команда не меняет чужие данные и не обходит обычные проверки:
 * покупка, смена скина, Quick Menu — везде вызывается та же серверная
 * ручка с той же сессией пользователя, что и при обычном тапе. Все
 * права (владение скином, свой профиль) проверяет сервер, а не эта
 * фраза.
 */
import { useModuleStore, type ModuleKey } from '@/data/state/modules';
import { apiPetsChangeType, apiPetsMarket, apiPetsSetSkin } from '@/pets/petsApi';
import { apiQuickMenuSetItem } from '@/quickmenu/quickMenuApi';

export interface VoiceCommand {
  label: string;
  run: () => void | Promise<void>;
}

const openModule = (m: ModuleKey) => () => useModuleStore.getState().setActiveModule(m);
const openExtras = (tab: string) => () => {
  useModuleStore.getState().setActiveModule('extras');
  useModuleStore.getState().setPendingExtrasTab(tab);
};
const openPets = () => openExtras('pets');
const openSkinsShop = () => () => {
  useModuleStore.getState().setPendingPetsMarket(true);
  openExtras('pets')();
};
const openQuickMenuSettings = () => () => {
  useModuleStore.getState().setPendingProfileSection('settings');
  useModuleStore.getState().setActiveModule('profile');
};

const PET_TYPE_ALIASES: Record<string, string> = {
  'дракон': 'dragon', 'кот': 'cat', 'кошк': 'cat', 'робот': 'robot', 'феникс': 'phoenix',
};
const findPetType = (text: string): string | null => {
  for (const [word, type] of Object.entries(PET_TYPE_ALIASES)) if (text.includes(word)) return type;
  return null;
};

const QUICK_MENU_ALIASES: Record<string, string> = {
  'питомц': 'pets', 'подкаст': 'podcasts', 'подар': 'gifts', 'skyvideo': 'skyvideo', 'скайвидео': 'skyvideo',
  'библиотек': 'library', 'музык': 'player', 'кино': 'watch', 'фильм': 'watch', 'сообщени': 'messenger',
  'мессендж': 'messenger', 'sky ai': 'ai', 'sky\\s*ai': 'ai',
};
const findQuickMenuItem = (text: string): string | null => {
  for (const [word, key] of Object.entries(QUICK_MENU_ALIASES)) if (text.includes(word)) return key;
  return null;
};

interface Rule { test: RegExp; label: string; run: () => void | Promise<void> }

/**
 * Порядок важен: более специфичные фразы — раньше общих, иначе
 * «открой библиотеку книг» поймает не то правило, а «покажи маркет
 * скинов» поймает обычное «покажи питомца» вместо открытия магазина.
 */
const NAV_RULES: Rule[] = [
  { test: /messenger|мессендж|сообщени/i, label: 'Messenger', run: openModule('messages') },
  { test: /маркет\s*скин|магазин\s*скин|скин.*маркет/i, label: 'Маркет скинов', run: openSkinsShop() },
  { test: /питомц/i, label: 'Питомцы', run: openPets() },
  { test: /музык/i, label: 'Музыка', run: openExtras('music') },
  { test: /soundcloud|саундклауд/i, label: 'SkySoundCloud', run: openExtras('soundcloud') },
  { test: /кино|фильм|cinema/i, label: 'Кино', run: openExtras('movies') },
  { test: /подкаст/i, label: 'Подкасты', run: openExtras('podcasts') },
  { test: /книг|sky\s*books/i, label: 'Sky Books', run: openExtras('books') },
  { test: /tv\b|телевизор|sky\s*tv/i, label: 'Sky TV', run: openExtras('tv') },
  { test: /подар|nft/i, label: 'Подарки', run: openExtras('nftgifts') },
  { test: /маркет|market/i, label: 'Sky Market', run: openExtras('market') },
  { test: /билет|tickets/i, label: 'Sky Tickets', run: openExtras('tickets') },
  { test: /skyvideo|скайвидео|видео\b/i, label: 'SkyVideo', run: openModule('video') },
  { test: /библиотек/i, label: 'Библиотека', run: openModule('library') },
  { test: /bloom|блум|ленту|соцсеть/i, label: 'Bloom', run: openModule('bloom') },
  { test: /истори[юи]\b/i, label: 'Истории', run: openModule('stories') },
  { test: /игр[уы]|gaming/i, label: 'Игры', run: openModule('gaming') },
  { test: /профил/i, label: 'Профиль', run: openModule('profile') },
  { test: /уведомлени/i, label: 'Уведомления', run: openModule('notifications') },
  { test: /quick\s*menu|быстр(ое|ое\s*меню|ый\s*доступ)/i, label: 'Quick Menu', run: openQuickMenuSettings() },
];

/** «Смени питомца на дракона» / «переключи питомца на кота». */
const petTypeRule = (text: string): Rule | null => {
  if (!/(смени|переключи|поменяй).*питомц/i.test(text)) return null;
  const type = findPetType(text);
  if (!type) return null;
  return {
    test: /./, label: `Питомец: ${type}`,
    run: async () => { await apiPetsChangeType(type); openPets()(); },
  };
};

/** «Надень скин <название>» — ищем среди уже купленных скинов по имени. */
const wearSkinRule = (text: string): Rule | null => {
  const m = /надень\s+скин\s+(.+)/i.exec(text) ?? /носи\s+скин\s+(.+)/i.exec(text);
  if (!m) return null;
  const query = m[1].trim();
  if (!query) return null;
  return {
    test: /./, label: `Скин: ${query}`,
    run: async () => {
      const items = await apiPetsMarket({ q: query });
      const match = items.find(s => s.owned && s.name.toLowerCase().includes(query.toLowerCase()));
      if (match) await apiPetsSetSkin(match.id);
      openPets()();
    },
  };
};

/** «Добавь питомцев в быстрое меню» / «убери подкасты из быстрого меню». */
const quickMenuItemRule = (text: string): Rule | null => {
  const add = /(добавь|включи).*(быстр(ое)?\s*меню|quick\s*menu)/i.test(text);
  const remove = /(убери|удали|выключи).*(из\s*быстр(ого)?\s*меню|from\s*quick\s*menu|быстр(ое)?\s*меню)/i.test(text);
  if (!add && !remove) return null;
  const key = findQuickMenuItem(text);
  if (!key) return null;
  return {
    test: /./, label: `Quick Menu: ${key} ${add ? 'включён' : 'выключен'}`,
    run: async () => { await apiQuickMenuSetItem(key, add); },
  };
};

const DYNAMIC_RULES: ((text: string) => Rule | null)[] = [petTypeRule, wearSkinRule, quickMenuItemRule];

/** Пусто — фраза не команда, значит это обычный вопрос к Sky AI. */
export const matchVoiceCommand = (text: string): VoiceCommand | null => {
  const clean = text.trim();
  // Команда — короткая фраза-инструкция («открой…», «покажи…», «включи…»,
  // «добавь…», «убери…», «смени…», «надень…»), а не что угодно, где
  // случайно встретилось слово «музыка» посреди длинного предложения.
  if (clean.length > 60) return null;
  if (!/^(открой|покажи|включи|выключи|запусти|перейди|добавь|убери|удали|смени|переключи|поменяй|надень|носи|настрой)/i.test(clean)) return null;

  for (const dynamic of DYNAMIC_RULES) {
    const r = dynamic(clean);
    if (r) return { label: r.label, run: r.run };
  }
  for (const rule of NAV_RULES) {
    if (rule.test.test(clean)) return { label: rule.label, run: rule.run };
  }
  return null;
};
