/* ===============================================================
   PET SKINS  -  система скинов для питомцев
   Покупка за Баллы Прайма
=============================================================== */

export type SkinRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface PetSkin {
  id:          string;
  petId:       string;         // к какому питомцу подходит ('all' = любому)
  name:        string;
  description: string;
  rarity:      SkinRarity;
  pricePoints: number;
  // CSS variables для перекрашивания SVG-питомца
  bodyColor:   string;
  accentColor: string;
  eyeColor:    string;
  extraColor?: string;
  glow:        string;
  badge?:      string;         // emoji бейдж на питомце
}

export const SKIN_RARITY_COLOR: Record<SkinRarity, string> = {
  common:    '#8a8a96',
  rare:      '#4f6ef7',
  epic:      '#a855f7',
  legendary: '#f59e0b',
};

export const SKIN_RARITY_GLOW: Record<SkinRarity, string> = {
  common:    'rgba(138,138,150,0.3)',
  rare:      'rgba(79,110,247,0.5)',
  epic:      'rgba(168,85,247,0.55)',
  legendary: 'rgba(245,158,11,0.6)',
};

export const SKIN_RARITY_LABEL: Record<SkinRarity, string> = {
  common:    'Обычный',
  rare:      'Редкий',
  epic:      'Эпический',
  legendary: 'Легендарный',
};

export const PET_SKINS: PetSkin[] = [
  // -- Cat skins
  {
    id:'cat-purple', petId:'cat-neon', name:'Неоновый',
    description:'Классический фиолетовый окрас Неона',
    rarity:'common', pricePoints:0,
    bodyColor:'#c084fc', accentColor:'#a855f7', eyeColor:'#7c3aed',
    glow:'rgba(168,85,247,0.5)', badge:undefined,
  },
  {
    id:'cat-ocean', petId:'cat-neon', name:'Океанский',
    description:'Синий как глубокий океан',
    rarity:'rare', pricePoints:2000,
    bodyColor:'#60a5fa', accentColor:'#3b82f6', eyeColor:'#1d4ed8',
    glow:'rgba(59,130,246,0.5)',
  },
  {
    id:'cat-fire', petId:'cat-neon', name:'Огненный',
    description:'Горит как пламя! Эпический дроп',
    rarity:'epic', pricePoints:6000,
    bodyColor:'#fb923c', accentColor:'#ef4444', eyeColor:'#dc2626',
    extraColor:'#fde68a', glow:'rgba(239,68,68,0.6)', badge:'🔥',
  },
  {
    id:'cat-gold', petId:'cat-neon', name:'Золотой',
    description:'Легендарный золотой кот. Приносит удачу!',
    rarity:'legendary', pricePoints:15000,
    bodyColor:'#fbbf24', accentColor:'#f59e0b', eyeColor:'#b45309',
    extraColor:'#fef3c7', glow:'rgba(245,158,11,0.7)', badge:'👑',
  },
  // -- Fox skins
  {
    id:'fox-default', petId:'fox-sky', name:'Рыжий',
    description:'Классический рыжий окрас Скай',
    rarity:'common', pricePoints:0,
    bodyColor:'#fb923c', accentColor:'#f97316', eyeColor:'#9a3412',
    glow:'rgba(249,115,22,0.5)',
  },
  {
    id:'fox-arctic', petId:'fox-sky', name:'Арктический',
    description:'Белоснежная арктическая лиса',
    rarity:'rare', pricePoints:2500,
    bodyColor:'#f8fafc', accentColor:'#e2e8f0', eyeColor:'#3b82f6',
    glow:'rgba(148,163,184,0.5)',
  },
  {
    id:'fox-galaxy', petId:'fox-sky', name:'Галактика',
    description:'Лиса из другой галактики. Редчайший скин!',
    rarity:'legendary', pricePoints:20000,
    bodyColor:'#6d28d9', accentColor:'#7c3aed', eyeColor:'#c026d3',
    extraColor:'#4c1d95', glow:'rgba(109,40,217,0.7)', badge:'🌌',
  },
  // -- Dragon skins
  {
    id:'dragon-green', petId:'dragon-mini', name:'Изумрудный',
    description:'Классический изумрудный дракончик',
    rarity:'common', pricePoints:0,
    bodyColor:'#34d399', accentColor:'#10b981', eyeColor:'#065f46',
    glow:'rgba(16,185,129,0.5)',
  },
  {
    id:'dragon-shadow', petId:'dragon-mini', name:'Теневой',
    description:'Тёмный дракон из мрака. Угрожающий вид',
    rarity:'epic', pricePoints:8000,
    bodyColor:'#1e1b4b', accentColor:'#312e81', eyeColor:'#6366f1',
    extraColor:'#4338ca', glow:'rgba(99,102,241,0.6)', badge:'🌑',
  },
  {
    id:'dragon-crimson', petId:'dragon-mini', name:'Багряный',
    description:'Легендарный дракон Апокалипсиса',
    rarity:'legendary', pricePoints:18000,
    bodyColor:'#dc2626', accentColor:'#b91c1c', eyeColor:'#7f1d1d',
    extraColor:'#fca5a5', glow:'rgba(220,38,38,0.7)', badge:'⚔️',
  },
  // -- Bunny skins
  {
    id:'bunny-pink', petId:'bunny-pixel', name:'Розовый',
    description:'Милый розовый кролик Пиксель',
    rarity:'common', pricePoints:0,
    bodyColor:'#fb7185', accentColor:'#f43f5e', eyeColor:'#9f1239',
    glow:'rgba(244,63,94,0.5)',
  },
  {
    id:'bunny-cyber', petId:'bunny-pixel', name:'Кибер',
    description:'Кролик из будущего. Неоновые акценты',
    rarity:'rare', pricePoints:3000,
    bodyColor:'#e2e8f0', accentColor:'#00d4ff', eyeColor:'#0ea5e9',
    extraColor:'#7dd3fc', glow:'rgba(14,165,233,0.6)', badge:'⚡',
  },
  {
    id:'bunny-rainbow', petId:'bunny-pixel', name:'Радужный',
    description:'Весь спектр цветов в одном кролике!',
    rarity:'epic', pricePoints:7500,
    bodyColor:'#f472b6', accentColor:'#a78bfa', eyeColor:'#34d399',
    extraColor:'#fbbf24', glow:'rgba(244,114,182,0.6)', badge:'🌈',
  },
  // -- Shark skins
  {
    id:'shark-reef', petId:'shark-reef', name:'Рифовый',
    description:'Классическая расцветка Риффа',
    rarity:'common', pricePoints:0,
    bodyColor:'#38bdf8', accentColor:'#0ea5e9', eyeColor:'#0c4a6e',
    glow:'rgba(14,165,233,0.5)',
  },
  {
    id:'shark-deep', petId:'shark-reef', name:'Глубоководный',
    description:'Тёмно-синий окрас морских глубин',
    rarity:'rare', pricePoints:2800,
    bodyColor:'#1e3a8a', accentColor:'#1d4ed8', eyeColor:'#60a5fa',
    glow:'rgba(29,78,216,0.55)',
  },
  {
    id:'shark-golden', petId:'shark-reef', name:'Золотая акула',
    description:'Легендарная золотая расцветка',
    rarity:'legendary', pricePoints:17000,
    bodyColor:'#fbbf24', accentColor:'#f59e0b', eyeColor:'#78350f',
    extraColor:'#fef3c7', glow:'rgba(245,158,11,0.7)', badge:'👑',
  },
  // -- Capybara skins
  {
    id:'capybara-brown', petId:'capybara-chill', name:'Классический',
    description:'Природный коричневый окрас Чилла',
    rarity:'common', pricePoints:0,
    bodyColor:'#b45309', accentColor:'#92400e', eyeColor:'#451a03',
    glow:'rgba(180,83,9,0.4)',
  },
  {
    id:'capybara-spa', petId:'capybara-chill', name:'Спа-день',
    description:'С мандаринкой на голове — легендарный релакс',
    rarity:'epic', pricePoints:6500,
    bodyColor:'#d97706', accentColor:'#f59e0b', eyeColor:'#451a03',
    extraColor:'#fb923c', glow:'rgba(245,158,11,0.55)', badge:'🍊',
  },
  // -- Robot skins
  {
    id:'robot-steel', petId:'robot-byte', name:'Стальной',
    description:'Базовая стальная обшивка Байта',
    rarity:'common', pricePoints:0,
    bodyColor:'#94a3b8', accentColor:'#64748b', eyeColor:'#38bdf8',
    glow:'rgba(100,116,139,0.4)',
  },
  {
    id:'robot-hologram', petId:'robot-byte', name:'Голограмма',
    description:'Полупрозрачный голографический корпус',
    rarity:'epic', pricePoints:7200,
    bodyColor:'#22d3ee', accentColor:'#06b6d4', eyeColor:'#a5f3fc',
    extraColor:'#67e8f9', glow:'rgba(34,211,238,0.6)', badge:'✨',
  },
  // -- Ghost skins
  {
    id:'ghost-classic', petId:'ghost-boo', name:'Классический',
    description:'Нежно-сиреневое свечение Бу',
    rarity:'common', pricePoints:0,
    bodyColor:'#e9d5ff', accentColor:'#c4b5fd', eyeColor:'#312e81',
    glow:'rgba(196,181,253,0.45)',
  },
  {
    id:'ghost-midnight', petId:'ghost-boo', name:'Полночный',
    description:'Легендарное тёмно-фиолетовое свечение',
    rarity:'legendary', pricePoints:16000,
    bodyColor:'#4c1d95', accentColor:'#6d28d9', eyeColor:'#c4b5fd',
    extraColor:'#8b5cf6', glow:'rgba(109,40,217,0.7)', badge:'🌙',
  },
  // Universal skins (petId: 'all')
  {
    id:'universal-void', petId:'all', name:'Пустота',
    description:'Тёмный скин для любого питомца. Мистический',
    rarity:'epic', pricePoints:5000,
    bodyColor:'#0f172a', accentColor:'#1e293b', eyeColor:'#818cf8',
    glow:'rgba(129,140,248,0.5)', badge:'🌑',
  },
  {
    id:'universal-crystal', petId:'all', name:'Кристалл',
    description:'Прозрачный кристальный скин. Легендарный!',
    rarity:'legendary', pricePoints:25000,
    bodyColor:'#e0f2fe', accentColor:'#bae6fd', eyeColor:'#0ea5e9',
    extraColor:'#f0f9ff', glow:'rgba(14,165,233,0.8)', badge:'💎',
  },
];

/* -- Storage ----------------------------------------------- */
const SK = 'sky:pet-skins:v1';
const W  = typeof window !== 'undefined';

interface SkinData {
  owned:  string[];   // skin IDs
  active: Record<string, string>;  // petId → skinId
}

const defaultSkinData = (): SkinData => ({
  owned:  PET_SKINS.filter(s => s.pricePoints === 0).map(s => s.id),
  active: {},
});

export const loadSkinData = (): SkinData => {
  if (!W) return defaultSkinData();
  try { return JSON.parse(localStorage.getItem(SK) || 'null') ?? defaultSkinData(); }
  catch { return defaultSkinData(); }
};

export const saveSkinData = (d: SkinData) => {
  if (!W) return;
  try { localStorage.setItem(SK, JSON.stringify(d)); } catch {}
};

export const getActiveSkin = (petId: string, data: SkinData): PetSkin => {
  const skinId = data.active[petId];
  const skin = PET_SKINS.find(s => s.id === skinId && (s.petId === petId || s.petId === 'all'));
  if (skin) return skin;
  // Default: first free skin for this pet
  return PET_SKINS.find(s => s.petId === petId && s.pricePoints === 0)
      ?? PET_SKINS.find(s => s.petId === 'all' && s.pricePoints === 0)
      ?? PET_SKINS[0];
};
