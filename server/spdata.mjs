/**
 * Sky Pets: встроенный каталог и правила. Это ДАННЫЕ ПО УМОЛЧАНИЮ — при первом обращении они попадают в таблицы
 * (`ensureSeed`), дальше каталог правится из админки («Конструктор питомцев») без изменения кода. Рисуются встроенные
 * питомцы векторно на клиенте по `art` ({shape, c1, c2, c3}); загруженные — картинкой (`image_id`).
 */
export const CATEGORIES = ['cats', 'dogs', 'rabbits', 'bears', 'pandas', 'foxes', 'frogs', 'birds', 'dragons', 'fantasy', 'space', 'seasonal', 'exclusive'];
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
export const CHARACTERS = ['calm', 'playful', 'curious', 'shy', 'brave', 'sleepy', 'greedy'];
export const SKILLS = ['agility', 'intellect', 'charm', 'strength'];
export const ROOMS = ['living', 'kitchen', 'bath', 'bed', 'play', 'garden'];
export const BASE_ROOMS = ['living', 'kitchen', 'bath', 'bed'];

const sp = (id, name, category, rarity, shape, c1, c2, c3, extra = {}) => ({ id, name, category, rarity, art: { shape, c1, c2, c3 }, ...extra });
export const SPECIES = [
  sp('cat-tabby', 'Полосатик', 'cats', 'common', 'cat', '#f0a35e', '#fff1dc', '#7a4a21', { description: 'Любопытный кот с полосатой шёрсткой.' }),
  sp('cat-snow', 'Снежок', 'cats', 'rare', 'cat', '#f4f6fb', '#ffd6e0', '#8aa0c8', { description: 'Пушистый белый кот, любит тишину.' }),
  sp('dog-spot', 'Пятнышко', 'dogs', 'common', 'dog', '#d9a066', '#fff3e0', '#6b4423', { description: 'Весёлый пёс с пятном на глазу.' }),
  sp('dog-husky', 'Вьюга', 'dogs', 'rare', 'dog', '#9fb4c7', '#ffffff', '#3d4f63', { description: 'Лёгкий на подъём хаски.' }),
  sp('rabbit-cloud', 'Облачко', 'rabbits', 'common', 'rabbit', '#f1e6ff', '#ffc8dd', '#a78bda', { description: 'Мягкий кролик с длинными ушами.' }),
  sp('rabbit-carrot', 'Морковка', 'rabbits', 'rare', 'rabbit', '#ffb27a', '#fff0e0', '#e0743a', { description: 'Рыжий кролик, обожает морковь.' }),
  sp('bear-honey', 'Медовик', 'bears', 'common', 'bear', '#b9834f', '#f1d3a5', '#6b4423', { description: 'Добродушный медвежонок.' }),
  sp('bear-polar', 'Льдинка', 'bears', 'epic', 'bear', '#eef6ff', '#cfe6ff', '#6d93bd', { description: 'Белый мишка с голубым носом.' }),
  sp('panda-bamboo', 'Бамбучик', 'pandas', 'rare', 'panda', '#ffffff', '#2b2b33', '#7ac68e', { description: 'Сонная панда, жуёт бамбук.' }),
  sp('panda-red', 'Огонёк', 'pandas', 'epic', 'panda', '#e98a4f', '#3a2a2a', '#fff0d9', { description: 'Малая панда с пушистым хвостом.' }),
  sp('fox-ember', 'Уголёк', 'foxes', 'common', 'fox', '#f07a3a', '#fff3e6', '#4a2a1a', { description: 'Хитрый лисёнок.' }),
  sp('fox-arctic', 'Метелица', 'foxes', 'epic', 'fox', '#e8f0ff', '#ffffff', '#7f9bd1', { description: 'Полярная лисица.' }),
  sp('frog-lily', 'Лилия', 'frogs', 'common', 'frog', '#7bd389', '#d9f7de', '#2f8a4a', { description: 'Прыгучая лягушка.' }),
  sp('frog-dart', 'Радужка', 'frogs', 'epic', 'frog', '#4db6e8', '#ffe066', '#e84d7a', { description: 'Яркая древесная лягушка.' }),
  sp('bird-sparrow', 'Чирик', 'birds', 'common', 'bird', '#c8a36b', '#fff0d4', '#6b4a22', { description: 'Любопытный воробей.' }),
  sp('bird-phoenix', 'Феникс', 'birds', 'legendary', 'bird', '#ff7a3a', '#ffd34d', '#c8201f', { description: 'Огненная птица.' }),
  sp('dragon-mint', 'Мятный дракончик', 'dragons', 'rare', 'dragon', '#7fe0c0', '#d6fff0', '#2f9f7f', { description: 'Малыш-дракон, дышит искрами.' }),
  sp('dragon-royal', 'Королевский дракон', 'dragons', 'legendary', 'dragon', '#8a5cf0', '#e0d1ff', '#ffd34d', { description: 'Редкий дракон фиолетового цвета.' }),
  sp('fantasy-unicorn', 'Единорожка', 'fantasy', 'epic', 'unicorn', '#ffe6f4', '#c9a6ff', '#ff8fc1', { description: 'Единорог с радужной гривой.' }),
  sp('fantasy-slime', 'Слаймик', 'fantasy', 'common', 'blob', '#8be0f0', '#d7f8ff', '#3aa6c4', { description: 'Мягкое желейное существо.' }),
  sp('space-alien', 'Звёздик', 'space', 'rare', 'alien', '#b3a6ff', '#e4defc', '#5e4fd0', { description: 'Маленький гость с другой планеты.' }),
  sp('space-comet', 'Комета', 'space', 'epic', 'blob', '#6fa8ff', '#fff6a6', '#2f5fd0', { description: 'Светящийся космический малыш.' }),
  sp('season-snowman', 'Снежок-зимовик', 'seasonal', 'rare', 'blob', '#ffffff', '#dff1ff', '#f08a3a', { season: 'winter', description: 'Зимний питомец.', cost_coins: 0 }),
  sp('season-pumpkin', 'Тыковка', 'seasonal', 'rare', 'blob', '#ff9a3a', '#ffd9a6', '#5a8a2f', { season: 'halloween', description: 'Осенний питомец-тыква.' }),
  sp('excl-aurora', 'Аврора', 'exclusive', 'legendary', 'unicorn', '#7fffe0', '#a6b8ff', '#ff9ae6', { exclusive: true, description: 'Эксклюзив событий Sky.' }),
];
// Эволюции: уровень, на котором питомец может эволюционировать (условие — действие `evolve`)
export const EVOLUTIONS = { 'cat-tabby': ['cat-snow', 15], 'dog-spot': ['dog-husky', 15], 'dragon-mint': ['dragon-royal', 25], 'fantasy-slime': ['fantasy-unicorn', 20] };

const egg = (id, name, kind, rarity, hatch, coins, points, drops, extra = {}) => ({ id, name, kind, rarity, hatch_seconds: hatch, price_coins: coins, price_points: points, drops, art: { c1: extra.c1 ?? '#ffe9b8', c2: extra.c2 ?? '#f0a35e', dots: extra.dots ?? '#ffffff' }, ...extra });
export const EGGS = [
  egg('egg-common', 'Обычное яйцо', 'common', 'common', 300, 60, 0, { 'cat-tabby': 30, 'dog-spot': 30, 'rabbit-cloud': 20, 'bear-honey': 15, 'frog-lily': 15, 'bird-sparrow': 15, 'fox-ember': 15, 'fantasy-slime': 10 }, { c1: '#ffe9b8', c2: '#f0a35e' }),
  egg('egg-blessing', 'Благословляющее яйцо', 'blessing', 'rare', 900, 0, 0, { 'cat-tabby': 20, 'dog-spot': 20, 'rabbit-carrot': 20, 'panda-bamboo': 10, 'cat-snow': 12, 'dog-husky': 12, 'fox-ember': 15 }, { c1: '#fff7c2', c2: '#ffd34d', buyable: false, description: 'Дарится за задания и достижения.' }),
  egg('egg-rare', 'Редкое яйцо', 'rare', 'rare', 1800, 250, 0, { 'cat-snow': 20, 'dog-husky': 20, 'rabbit-carrot': 20, 'panda-bamboo': 15, 'dragon-mint': 10, 'space-alien': 12 }, { c1: '#d6ecff', c2: '#4aa3ff' }),
  egg('egg-epic', 'Эпическое яйцо', 'epic', 'epic', 3600, 900, 0, { 'bear-polar': 20, 'panda-red': 20, 'fox-arctic': 20, 'frog-dart': 20, 'fantasy-unicorn': 12, 'space-comet': 12 }, { c1: '#ead6ff', c2: '#9b5cf0' }),
  egg('egg-legend', 'Легендарное яйцо', 'legendary', 'legendary', 14400, 0, 400, { 'bird-phoenix': 40, 'dragon-royal': 40, 'fantasy-unicorn': 20, 'fox-arctic': 20 }, { c1: '#fff0b8', c2: '#ff8a3a' }),
  egg('egg-premium', 'Премиум-яйцо', 'premium', 'epic', 1200, 0, 150, { 'bear-polar': 20, 'panda-red': 20, 'fantasy-unicorn': 15, 'dragon-mint': 20, 'space-alien': 15, 'frog-dart': 15 }, { c1: '#ffd9ec', c2: '#ff5fa8' }),
  egg('egg-winter', 'Зимнее яйцо', 'seasonal', 'rare', 1200, 200, 0, { 'season-snowman': 60, 'fox-arctic': 20, 'cat-snow': 20 }, { season: 'winter', c1: '#e8f6ff', c2: '#7fc3f0' }),
  egg('egg-event', 'Яйцо событий', 'event', 'legendary', 3600, 0, 0, { 'excl-aurora': 30, 'dragon-royal': 35, 'bird-phoenix': 35 }, { buyable: false, c1: '#d8fff2', c2: '#5fe0c0', description: 'Выдаётся только на событиях.' }),
];

const item = (id, kind, name, category, rarity, coins, effect, extra = {}) => ({ id, kind, name, category, rarity, price_coins: coins, price_points: extra.points ?? 0, effect, art: { icon: extra.icon ?? kind, c1: extra.c1 ?? '#ffc861' }, ...extra });
export const ITEMS = [
  item('food-kibble', 'food', 'Сухой корм', 'Корм', 'common', 5, { satiety: 25, xp: 5 }, { icon: 'bone', description: 'Простой корм.' }),
  item('food-fish', 'food', 'Рыбка', 'Корм', 'common', 12, { satiety: 40, fun: 5, xp: 8 }, { icon: 'fish', c1: '#7ac0ff' }),
  item('food-cake', 'food', 'Тортик', 'Корм', 'rare', 40, { satiety: 30, fun: 25, xp: 15 }, { icon: 'cake', c1: '#ff9ec8' }),
  item('med-herbs', 'food', 'Целебные травы', 'Здоровье', 'common', 25, { health: 40, xp: 6 }, { icon: 'leaf', c1: '#7bd389' }),
  item('toy-ball', 'toy', 'Мячик', 'Игрушки', 'common', 20, { fun: 20, xp: 6 }, { icon: 'ball', c1: '#ff7a7a' }),
  item('toy-rope', 'toy', 'Верёвка', 'Игрушки', 'common', 25, { fun: 18, skill: 'strength', skillXp: 1 }, { icon: 'rope', c1: '#c89b5e' }),
  item('toy-puzzle', 'toy', 'Головоломка', 'Игрушки', 'rare', 60, { fun: 15, skill: 'intellect', skillXp: 2, xp: 10 }, { icon: 'puzzle', c1: '#8aa0ff' }),
  item('toy-star', 'toy', 'Звёздный волчок', 'Игрушки', 'epic', 150, { fun: 30, xp: 20 }, { icon: 'star', c1: '#ffd34d' }),
  item('acc-bow', 'accessory', 'Бантик', 'Аксессуары', 'common', 30, { slot: 'head' }, { icon: 'bow', c1: '#ff7aa8' }),
  item('acc-crown', 'accessory', 'Корона', 'Аксессуары', 'epic', 300, { slot: 'head' }, { icon: 'crown', c1: '#ffd34d' }),
  item('cloth-scarf', 'clothes', 'Шарф', 'Одежда', 'common', 45, { slot: 'neck' }, { icon: 'scarf', c1: '#ff6b6b' }),
  item('bed-basic', 'bed', 'Уютная лежанка', 'Мебель', 'common', 80, { energyRegen: 0.25 }, { icon: 'bed', c1: '#a6c8ff' }),
  item('bed-royal', 'bed', 'Королевская кровать', 'Мебель', 'epic', 400, { energyRegen: 0.7 }, { icon: 'bed', c1: '#c9a6ff' }),
  item('bowl-basic', 'bowl', 'Миска', 'Мебель', 'common', 40, { feedBonus: 0.1 }, { icon: 'bowl', c1: '#ffb27a' }),
  item('furn-sofa', 'furniture', 'Диван', 'Мебель', 'common', 120, {}, { icon: 'sofa', c1: '#ff9ec8' }),
  item('furn-trainer', 'furniture', 'Тренажёр ловкости', 'Мебель', 'rare', 200, { skill: 'agility', skillBonus: 1 }, { icon: 'gym', c1: '#7bd389' }),
  item('decor-plant', 'decor', 'Растение', 'Декор', 'common', 35, {}, { icon: 'plant', c1: '#7bd389' }),
  item('decor-lamp', 'decor', 'Лампа', 'Декор', 'common', 50, {}, { icon: 'lamp', c1: '#ffe08a' }),
  item('wall-sky', 'interior', 'Обои «Небо»', 'Интерьеры', 'common', 60, { wall: '#cfe8ff' }, { icon: 'wall', c1: '#cfe8ff' }),
  item('wall-rose', 'interior', 'Обои «Розовые»', 'Интерьеры', 'common', 60, { wall: '#ffd9ea' }, { icon: 'wall', c1: '#ffd9ea' }),
  item('wall-mint', 'interior', 'Обои «Мята»', 'Интерьеры', 'common', 60, { wall: '#d6f5e6' }, { icon: 'wall', c1: '#d6f5e6' }),
  item('floor-wood', 'interior', 'Пол «Дерево»', 'Интерьеры', 'common', 60, { floor: '#e2b887' }, { icon: 'floor', c1: '#e2b887' }),
  item('floor-gray', 'interior', 'Пол «Камень»', 'Интерьеры', 'common', 60, { floor: '#c9ccd6' }, { icon: 'floor', c1: '#c9ccd6' }),
  item('house-play', 'house', 'Пристройка «Игровая»', 'Расширение', 'rare', 300, { room: 'play' }, { icon: 'door', c1: '#ffb27a' }),
  item('house-garden', 'house', 'Пристройка «Сад»', 'Расширение', 'rare', 300, { room: 'garden' }, { icon: 'door', c1: '#7bd389' }),
];

export const TASKS = [
  { id: 'd-feed', title: 'Покормить питомца', kind: 'daily', action: 'feed', target: 2, reward: { coins: 15, xp: 10 }, sort: 1 },
  { id: 'd-play', title: 'Поиграть с питомцем', kind: 'daily', action: 'play', target: 2, reward: { coins: 15, xp: 10 }, sort: 2 },
  { id: 'd-bath', title: 'Искупать питомца', kind: 'daily', action: 'bathe', target: 1, reward: { coins: 10 }, sort: 3 },
  { id: 'd-walk', title: 'Сходить на прогулку', kind: 'daily', action: 'walk', target: 1, reward: { coins: 20, items: { 'food-fish': 1 } }, sort: 4 },
  { id: 'w-care', title: 'Ухаживать за питомцами 20 раз', kind: 'weekly', action: 'any', target: 20, reward: { coins: 120, eggs: { 'egg-blessing': 1 } }, sort: 10 },
  { id: 'w-teach', title: 'Научить питомца новому', kind: 'weekly', action: 'teach', target: 3, reward: { coins: 80, items: { 'toy-puzzle': 1 } }, sort: 11 },
  { id: 'j-together', title: 'Совместный уход: 10 действий вместе', kind: 'joint', action: 'joint', target: 10, reward: { coins: 150, eggs: { 'egg-blessing': 1 } }, sort: 20 },
];

/** Достижения: условие считает сервер по данным, награду каждый владелец получает один раз (`sp_ach_claims`). */
export const ACHIEVEMENTS = [
  { key: 'first_pet', title: 'Первый питомец', scope: 'player', reward: { coins: 50 } },
  { key: 'collect_5', title: 'Коллекционер: 5 питомцев', scope: 'player', reward: { coins: 150 } },
  { key: 'collect_10', title: 'Коллекционер: 10 питомцев', scope: 'player', reward: { coins: 400, eggs: { 'egg-rare': 1 } } },
  { key: 'first_shared', title: 'Первый совместный питомец', scope: 'pet', shared: true, reward: { coins: 100, eggs: { 'egg-blessing': 1 } } },
  { key: 'joint_days_3', title: '3 дня ухода вместе', scope: 'pet', shared: true, reward: { coins: 80 } },
  { key: 'joint_days_7', title: '7 дней ухода вместе', scope: 'pet', shared: true, reward: { coins: 200, items: { 'toy-star': 1 } } },
  { key: 'joint_days_30', title: '30 дней ухода вместе', scope: 'pet', shared: true, reward: { coins: 800, eggs: { 'egg-epic': 1 } } },
  { key: 'joint_actions_100', title: '100 совместных действий', scope: 'pet', shared: true, reward: { coins: 300 } },
  { key: 'shared_level_10', title: 'Совместный питомец 10 уровня', scope: 'pet', shared: true, reward: { coins: 250, items: { 'acc-crown': 1 } } },
  { key: 'shared_rare', title: 'Редкий совместный питомец', scope: 'pet', shared: true, reward: { coins: 300 } },
  { key: 'level_10', title: 'Питомец 10 уровня', scope: 'pet', reward: { coins: 120 } },
];

/** Что открывается с уровнем (информационная лента: клиент включает анимации и слоты по уровню). */
export const UNLOCKS = { 3: 'Эмоция «радость»', 5: 'Анимация «прыжок»', 8: 'Слот аксессуара', 10: 'Эмоция «любовь»', 15: 'Анимация «танец»', 20: 'Слот одежды', 25: 'Особая поза для фото' };
export const xpFor = (level) => 100 + 60 * (level - 1);
export const levelReward = (level) => ({ coins: 20 + 5 * level, ...(level % 5 === 0 ? { items: { 'toy-star': 1 } } : {}), ...(level % 10 === 0 ? { eggs: { 'egg-rare': 1 } } : {}) });
