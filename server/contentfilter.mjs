/* Фильтры контента: мат, 18+, наркотики, запрещёнка, терроризм, ненависть, самоповреждение, мошенничество.
 *
 * ЧЕСТНО: это эвристика на словарях, а не понимание смысла. Она ловит прямые слова и типичные
 * обходы (латинские «двойники» букв, цифры вместо букв, неверная раскладка, разделители между
 * буквами, растянутые буквы, звёздочки), но не поймёт намёк, жаргон, которого нет в словаре,
 * и картинку. Ошибки возможны в обе стороны: слишком редкие слова пропускаются, редкие
 * безобидные формы могут совпасть. Окончательное слово за человеком (очередь удержаний).
 *
 * Файл НЕ зависит от БД в части разбора (`inspectText`) — его можно проверять без сервера.
 * Настройки и очередь — ниже, в части «хранилище». */

export const CATEGORIES = ['profanity', 'adult', 'drugs', 'contraband', 'terror', 'hate', 'selfharm', 'scam', 'custom'];
export const ACTIONS = ['off', 'mask', 'moderate', 'block'];
const SEVERITY = { allow: 0, off: 0, mask: 1, moderate: 2, block: 3 };

export const DEFAULT_ACTIONS = {
  profanity: 'mask',
  adult: 'moderate',
  drugs: 'block',
  contraband: 'block',
  terror: 'block',
  hate: 'moderate',
  selfharm: 'moderate',
  scam: 'moderate',
  custom: 'moderate',
};

/* ── Нормализация ────────────────────────────────────────────────── */

const ZERO_WIDTH = /[​-‏⁠﻿­͏᠎]/g;
const COMBINING = /[̀-ͯ]/g;

const LAT2CYR = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  i: 'и', u: 'у', r: 'р', n: 'н', l: 'л', s: 'с', d: 'д', g: 'г', z: 'з', f: 'ф', w: 'ш', v: 'в', j: 'й', q: 'к',
};
const CYR2LAT = {
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
  и: 'i', л: 'l', д: 'd', г: 'g', з: 'z', ф: 'f', ш: 'w', й: 'j', п: 'n',
};
const DIGIT_CYR = { 0: 'о', 3: 'з', 4: 'ч', 6: 'б', 8: 'в', 1: 'и' };
const DIGIT_LAT = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };
const SYM_CYR = { '@': 'а', $: 'с' };
const SYM_LAT = { '@': 'a', $: 's' };

// Клавиатурные раскладки: английская → русская и обратно.
const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN2RU = {}; const RU2EN = {};
for (let i = 0; i < EN_KEYS.length; i += 1) { EN2RU[EN_KEYS[i]] = RU_KEYS[i]; RU2EN[RU_KEYS[i]] = EN_KEYS[i]; }

const LAT2CYR_ALT = { ...LAT2CYR, p: 'п', n: 'п', b: 'б', y: 'й', h: 'х' };
const TRANSLIT_DI = [['shch', 'щ'], ['sch', 'щ'], ['kh', 'х'], ['zh', 'ж'], ['ch', 'ч'], ['sh', 'ш'], ['ts', 'ц'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'е'], ['ye', 'е'], ['ja', 'я'], ['ju', 'ю']];
const TRANSLIT = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', y: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц', w: 'в', x: 'кс', j: 'й', q: 'к' };
const translit = (w) => {
  let r = w;
  for (const [a, b] of TRANSLIT_DI) r = r.split(a).join(b);
  return Array.from(r, (c) => TRANSLIT[c] ?? c).join('');
};

const mapChars = (s, map) => Array.from(s, (c) => map[c] ?? c).join('');
const collapse = (s) => s.replace(/(.)\1+/gu, '$1');
const MASK_CHARS = /[*#@$%^&+]/g;

export const baseNormalize = (s) => String(s ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/й/g, '\u0001')
  .replace(ZERO_WIDTH, '')
  .normalize('NFD').replace(COMBINING, '').normalize('NFC')
  .replace(/\u0001/g, 'й')
  .replace(/ё/g, 'е');

const hasLat = (s) => /[a-z]/.test(s);
const hasCyr = (s) => /[а-я]/.test(s);

/** Варианты одного слова для проверки. */
export const wordVariants = (w) => {
  const out = new Set();
  const add = (x) => { if (x && x.length >= 2) { out.add(x); out.add(collapse(x)); } };
  add(w);
  const nm = w.replace(MASK_CHARS, '');
  add(nm);
  // всё, что похоже на кириллицу: латинские двойники, цифры, символы
  add(mapChars(mapChars(mapChars(w, SYM_CYR), DIGIT_CYR), LAT2CYR).replace(MASK_CHARS, ''));
  add(mapChars(mapChars(mapChars(w, SYM_CYR), DIGIT_CYR), LAT2CYR_ALT).replace(MASK_CHARS, ''));
  if (/^[a-z0-9@$]+$/.test(w) && hasLat(w)) add(translit(mapChars(mapChars(w, SYM_LAT), DIGIT_LAT)));
  add(mapChars(mapChars(mapChars(w, { '@': 'u', $: 's' }), DIGIT_LAT), CYR2LAT).replace(MASK_CHARS, ''));
  // всё, что похоже на латиницу: кириллические двойники, цифры, символы
  add(mapChars(mapChars(mapChars(w, SYM_LAT), DIGIT_LAT), CYR2LAT).replace(MASK_CHARS, ''));
  // неверная раскладка
  if (/^[a-z\[\];',.`]{3,}$/.test(w)) add(mapChars(w, EN2RU));
  if (/^[а-яъ]{3,}$/.test(w)) add(mapChars(w, RU2EN));
  // слово, набранное по-русски латиницей-двойниками и цифрами, уже покрыто выше
  return [...out];
};

/** Слова текста. «х у й», «х.у.й», «х*у*й» склеиваются в одно слово. */
const TOKEN_RE = /[\p{L}\p{N}*@$#%^&+]+/gu;
const SINGLE_GAP = /^[\s.\-_*,/\\|~'`·•]+$/;

export const tokenize = (original) => {
  const text = baseNormalize(original);
  const raw = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (!/[\p{L}\p{N}]/u.test(m[0])) continue;
    raw.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  }
  // склейка последовательностей одиночных букв
  const merged = [];
  for (let i = 0; i < raw.length;) {
    const isSingle = (t) => /^[\p{L}]$/u.test(t.w);
    if (isSingle(raw[i])) {
      let j = i; let w = raw[i].w;
      while (j + 1 < raw.length && isSingle(raw[j + 1]) && SINGLE_GAP.test(text.slice(raw[j].end, raw[j + 1].start))) { j += 1; w += raw[j].w; }
      if (j - i >= 2) { merged.push({ w, start: raw[i].start, end: raw[j].end }); i = j + 1; continue; }
    }
    merged.push(raw[i]); i += 1;
  }
  return { text, tokens: merged };
};

/* ── Словари ─────────────────────────────────────────────────────── */

const PREF = 'не|ни|по|на|за|от|вы|до|об|под|про|пере|при|раз|рас|вз|из|ис|воз|с|у|о|в|съ|объ|пре|пред|над|без|бес|со|ко|в|вс|подъ|взъ';
// [категория, вес, основа (после приставок), «только целиком слово»?]
const WORD_RULES = [
  // — мат (русский) —
  ['profanity', 2, 'ху[йеяию]|хуй\\p{L}*|хуев|хуяч|хуяр', false],
  ['profanity', 2, 'п[ие]зд', false],
  ['profanity', 2, 'еб(?:ан|ат|ал|ну|уч|ут|ыр|ля|ли|ет|ись|ло|ыч|ну|ну)', false],
  ['profanity', 2, 'ебл[аоуи]', false],
  ['profanity', 2, 'бля(?:ть|т|д|ц)?|хй|пзд|пздц|пздец|нахй|похй|бл', true],
  ['profanity', 2, 'бляд\\p{L}*|блять\\p{L}*', false],
  ['profanity', 2, 'муд[аоие]к|мудил|мудозвон', false],
  ['profanity', 2, 'пид[оа]р|пидр|педик', false],
  ['profanity', 2, 'залуп', false],
  ['profanity', 2, 'гандон|гондон', false],
  ['profanity', 2, 'шлюх|шалав', false],
  ['profanity', 2, 'сука|суки|суку|суке|сукой|сукин\\p{L}*|сучк\\p{L}*|сучар\\p{L}*|сучь\\p{L}*', true],
  ['profanity', 2, 'хуесос|хуила|хуета', false],
  ['profanity', 1, 'говн\\p{L}*|дерьм\\p{L}*|жоп\\p{L}*|срать|сран\\p{L}*', false],
  ['profanity', 1, 'дроч\\p{L}*|манд[аеуы]|мандавош\\p{L}*', false],
  // — мат (английский) —
  ['profanity', 2, 'fuck\\p{L}*|motherfuck\\p{L}*', false],
  ['profanity', 2, 'bitch\\p{L}*|cunt\\p{L}*|asshole\\p{L}*|bastard', false],
  ['profanity', 2, 'shit\\p{L}*'  , false],
  ['profanity', 1, 'whore|slut\\p{L}*|dickhead|cock(?:sucker)?', false],
  // — 18+ —
  ['adult', 2, 'порн\\p{L}*|porn\\p{L}*|хентай|hentai|onlyfans|pornhub|xvideos|вебкам\\p{L}*|camgirl|нюдс|nudes?', false],
  ['adult', 2, 'эротич\\p{L}*|эротик\\p{L}*|erotic\\p{L}*|интимн\\p{L}*', false],
  ['adult', 2, 'проститут\\p{L}*|эскорт\\p{L}*|индивидуалк\\p{L}*', false],
  ['adult', 2, 'минет\\p{L}*|куннилингус|анальн\\p{L}*|оральн\\p{L}*|оргазм\\p{L}*|мастурб\\p{L}*', false],
  ['adult', 1, 'секс\\p{L}*|sex\\p{L}*|голы[еойих]+|обнаж[её]н\\p{L}*|трах\\p{L}*|сиськ\\p{L}*|жопа', false],
  ['adult', 1, 'xxx|18плюс', true],
  // — наркотики —
  ['drugs', 2, 'героин\\p{L}*|кокаин\\p{L}*|амфетамин\\p{L}*|метамфетамин\\p{L}*|мефедрон\\p{L}*|мефик\\p{L}*|гашиш\\p{L}*|марихуан\\p{L}*', false],
  ['drugs', 2, 'амф|героин|cocaine|heroin|methamphetamine|mdma|мдма|лсд|lsd|экстази|ecstasy', true],
  ['drugs', 2, 'спайс\\p{L}*|ганджа|гандж\\p{L}*|бошки|бошек|дезоморфин\\p{L}*|альфа-?пвп|a-?pvp|метадон\\p{L}*|опиум\\p{L}*|барбитурат\\p{L}*', false],
  ['drugs', 1, 'закладк\\p{L}*|шишки|травк\\p{L}*|план(?:чик)?|трамадол\\p{L}*|наркот\\p{L}*|наркоман\\p{L}*|веществ[аоу]?', false],
  // — запрещёнка —
  ['contraband', 2, 'обнал\\p{L}*|дропы|дроп(?:ов)?|пробив\\p{L}*|скимм\\p{L}*|кардинг\\p{L}*|фишинг\\p{L}*', false],
  ['contraband', 2, 'тротил|гексоген|детонатор\\p{L}*|взрывчатк\\p{L}*|самопал\\p{L}*|нелегальн\\p{L}*|контрафакт\\p{L}*|краден\\p{L}*', false],
  ['contraband', 1, 'порох|пистолет\\p{L}*|автомат\\p{L}*|ствол\\p{L}*|гранат\\p{L}*|патрон\\p{L}*|оружи\\p{L}*', false],
  ['contraband', 1, 'ддос|ddos|ботнет\\p{L}*|сливы?|слив\\p{L}*|поддельн\\p{L}*|фальшив\\p{L}*|левые|левый', false],
  // — терроризм и экстремизм —
  ['terror', 2, 'терракт\\p{L}*|теракт\\p{L}*|игил|isis|дайш|аль-?каид\\p{L}*|талибан\\p{L}*|смертник\\p{L}*|шахид\\p{L}*|заминир\\p{L}*', false],
  ['terror', 2, 'скулшутинг|columbine|колумбин\\p{L}*|шутинг', false],
  ['terror', 1, 'джихад\\p{L}*|взорва[тьл]\\p{L}*|бомб[аыуе]|боевик\\p{L}*|экстремист\\p{L}*|террорист\\p{L}*|вербовк\\p{L}*|расстрел\\p{L}*|зиг|хайль|1488', false],
  // — ненависть —
  ['hate', 2, 'нигг?ер\\p{L}*|nigg\\p{L}*|черномаз\\p{L}*|чурк\\p{L}*|чурбан\\p{L}*|хач\\p{L}*|узкоглаз\\p{L}*|жидяр\\p{L}*|жидов\\p{L}*|пархат\\p{L}*', false],
  ['hate', 1, 'жид|хохл\\p{L}*|москал\\p{L}*|хохол|кацап\\p{L}*|даун|дебил|дегенерат\\p{L}*|выродк\\p{L}*', true],
  ['hate', 1, 'сдохн\\p{L}*|сдохни|тупорыл\\p{L}*', false],
  // — самоповреждение —
  ['selfharm', 1, 'суицид\\p{L}*|самоубийств\\p{L}*|повеситься|вскрыть\\p{L}*|самоповрежд\\p{L}*', false],
  // — мошенничество —
  ['scam', 1, 'хайп\\p{L}*|пирамид\\p{L}*|мошенник\\p{L}*|развод\\p{L}*', false],
];

const WORD_RULES_RE = WORD_RULES.map(([cat, w, stem, whole], i) => ({
  id: `w${i}`, cat, w,
  re: new RegExp(`^(?:${PREF})*(?:${stem})${whole ? '$' : ''}`, 'u'),
}));

// Безобидные слова, которые начинаются как запрещённые основы.
const WORD_OK = [
  /^(?:раз|от|с|по|за)?хуй?дан/u, /^сукно|^сукна|^суконн/u, /^оскорб|^употреб|^потреб|^требл|^погреб|^вреб/u,
  /^психу/u, /^страху/u, /^хлеб/u, /^ребят|^ребен|^ребр/u, /^кремл/u, /^дебит/u, /^дебют/u, /^дебрь/u,
  /^автомат(?:ическ|изац|изир|ик)/u, /^патронат/u, /^патронаж/u, /^оружейн/u, /^ствол(?:ов)?[ауы]?$/u,
  /^планшет|^планет|^планир|^планк|^план(?:ы|а|е|у|ом|ов)?$/u, /^дроп(?:шиппинг|ы)?$/u,
  /^слив(?:ки|ок|ать|ает|ах)$|^сливочн|^сливов|^слива$|^сливе$/u, /^левый?$/u, /^вещество$/u, /^веществ(?:а|у|ом|е|ами)$/u,
  /^голы[хмй]$|^голыш/u, /^жидк|^жидок/u, /^даунлоад|^даунтаун/u, /^сексапильн/u,
  /^ху[йеяию]ст|^хуан|^хуже/u, /^wassup|^shiitake|^cocktail|^cockpit|^peacock|^hancock|^scunthorpe|^assassin|^assistant|^class|^glass|^grass|^mass|^pass|^bass/u,
];

/* ── Фразы (проверяются на всём тексте) ──────────────────────────── */

const B0 = '(?<![\\p{L}\\p{N}])';
const B1 = '(?![\\p{L}\\p{N}])';
const PHRASES = [
  ['drugs', 2, 'куп(?:лю|ить|и)\\s+(?:\\p{L}+\\s+){0,2}(?:героин|кокаин|мефедрон|амфетамин|гашиш|марихуан|наркот|спайс|траву|шишки|лсд|мдма)'],
  ['drugs', 2, '(?:продам|продаю|продажа|закладки|доставка|опт)\\s+(?:\\p{L}+\\s+){0,2}(?:героин|кокаин|мефедрон|амфетамин|гашиш|марихуан|наркот|спайс|траву|шишки)'],
  ['drugs', 2, 'как\\s+(?:сделать|приготовить|варить|сварить|изготовить)\\s+(?:\\p{L}+\\s+){0,2}(?:мефедрон|амфетамин|наркот|метамфетамин|героин|кокаин)'],
  ['contraband', 2, 'куп(?:лю|ить)\\s+(?:\\p{L}+\\s+){0,2}(?:пистолет|автомат|ствол|гранат|патроны|оружие|ружье|взрывчат)'],
  ['contraband', 2, '(?:поддельн|фальшив|левы)\\p{L}*\\s+(?:документ|паспорт|прав[аы]|справк|диплом|деньги|купюр|карт)'],
  ['contraband', 2, '(?:куп(?:лю|ить)|сдела(?:ть|ю)|нарисую)\\s+(?:\\p{L}+\\s+){0,2}(?:диплом|справк|права|паспорт|больничн)'],
  ['contraband', 2, '(?:слив|пробив)\\s+(?:по\\s+)?(?:баз|номер|паспорт|данн|адрес)'],
  ['contraband', 2, '(?:взлом|взломаю|взломать)\\s+(?:\\p{L}+\\s+){0,1}(?:аккаунт|страниц|телефон|почт|вк|инст)'],
  ['contraband', 2, 'как\\s+(?:сделать|собрать|изготовить)\\s+(?:\\p{L}+\\s+){0,2}(?:бомб|взрывчат|самопал|глушител|ствол)'],
  ['terror', 2, 'как\\s+(?:сделать|собрать|изготовить)\\s+(?:\\p{L}+\\s+){0,2}(?:бомбу|взрывчат|самодельн\\p{L}*\\s+взрывн)'],
  ['terror', 2, '(?:взорву|взорвём|взорвем|убью|убьём|убьем|расстреляю|расстреляем)\\s+(?:\\p{L}+\\s+){0,2}(?:школ|метро|вокзал|торговый|тц|людей|всех|толпу|мечеть|церковь|синагог)'],
  ['terror', 2, '(?:вступай|вступить|присоединяйся|присоединиться)\\s+(?:\\p{L}+\\s+){0,2}(?:джихад|игил|боевик|террорист|исламск\\p{L}*\\s+государств)'],
  ['terror', 2, 'sieg\\s*heil|зиг\\s*хайль|14\\s*/?\\s*88'],
  ['hate', 2, '(?:смерть|убивай(?:те)?|убить|убьём|убьем)\\s+(?:всем\\s+)?(?:\\p{L}+\\s+){0,1}(?:евреям|чёрным|черным|геям|мусульманам|русским|украинцам|кавказцам|гомосекам)'],
  ['hate', 2, 'убей(?:те)?\\s+(?:себя|их|его|ее|её)|сдохни(?:те)?\\s'],
  ['selfharm', 2, 'как\\s+(?:покончить|убить)\\s+(?:с\\s+)?(?:собой|себя)|способ\\p{L}*\\s+суицид|хочу\\s+умереть|не\\s+хочу\\s+жить'],
  ['scam', 2, '(?:заработок|доход|прибыль)\\s+(?:\\p{L}+\\s+){0,1}(?:без\\s+вложений|гарантирован\\p{L}*|от\\s+\\d+\\s*(?:тыс|к|000))'],
  ['scam', 2, 'гарантированн\\p{L}*\\s+(?:доход|прибыл|заработок|выигрыш)|быстр\\p{L}*\\s+деньги|удвоим\\s+(?:ваш\\p{L}*\\s+)?(?:деньги|вложен|вклад)|кредит\\s+без\\s+(?:отказа|проверки)'],
  ['scam', 2, '(?:переведи|переведите|скинь|скиньте)\\s+(?:\\p{L}+\\s+){0,2}(?:код\\s+из\\s+смс|смс\\s+код|cvv|пин-?код|пароль)'],
  ['adult', 2, '(?:только|для)\\s+(?:для\\s+)?взросл\\p{L}*|18\\s*\\+|18\\s+плюс|\\+\\s*18|для\\s+совершеннолетн\\p{L}*|nsfw'],
  ['adult', 2, '(?:интим|секс)\\s*-?\\s*(?:услуг|знакомств|общени|чат|видео|фото)'],
  ['adult', 2, 'продам\\s+(?:\\p{L}+\\s+){0,1}(?:фото|видео)\\s+(?:\\p{L}+\\s+){0,1}(?:голые|интим|эротик|18)'],
];
const PHRASE_RE = PHRASES.map(([cat, w, src], i) => ({ id: `p${i}`, cat, w, re: new RegExp(`${B0}(?:${src})`, 'u') }));

// Смягчающий контекст: новости, профилактика, образование. Вес категории уменьшается на 1.
const SOFTEN = new RegExp(`${B0}(?:борьб\\p{L}*|профилактик\\p{L}*|вред\\p{L}*|зависимост\\p{L}*|лечени\\p{L}*|реабилитац\\p{L}*|запрещ\\p{L}*|осужд\\p{L}*|арест\\p{L}*|задерж\\p{L}*|приговор\\p{L}*|статья|уголовн\\p{L}*|полици\\p{L}*|мвд|фсб|новост\\p{L}*|history|news|prevention|rehab|education|урок|реферат|доклад|помощь|телефон\\s+доверия)${B1}`, 'u');
// Усиливающий контекст «продажа/связь».
const SALE = new RegExp(`${B0}(?:куп(?:лю|ить|и)|продам|продаю|продажа|цена|заказать|заказ|доставк\\p{L}*|телеграм\\p{L}*|тг|tg|whatsapp|ватсап|вотсап|в\\s+наличии|опт|розница|скидк\\p{L}*|клад)${B1}`, 'u');
const SALE_CATS = new Set(['drugs', 'contraband']);
const SOFT_CATS = new Set(['drugs', 'terror', 'hate', 'adult', 'selfharm', 'contraband', 'scam']);
const THRESHOLD = 2;

/* ── Разбор ──────────────────────────────────────────────────────── */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Свои слова администрации: одно слово (основа в начале слова) или фраза. */
const compileCustom = (list) => (Array.isArray(list) ? list : []).flatMap((c, i) => {
  const word = baseNormalize(c?.word).replace(/\s+/g, ' ').trim();
  if (word.length < 3 || word.length > 60) return [];
  const w = [1, 2].includes(Number(c?.weight)) ? Number(c.weight) : 2;
  const cat = CATEGORIES.includes(c?.category) ? c.category : 'custom';
  const body = escapeRe(word).replace(/ /g, '\\s+');
  return [{ id: `c${i}`, cat, w, re: new RegExp(`${B0}${body}`, 'u'), phrase: true }];
});

const compileAllow = (list) => new Set((Array.isArray(list) ? list : []).map((x) => baseNormalize(x).trim()).filter(Boolean));

const sampleOf = (s) => (s.length <= 2 ? '**' : `${s[0]}${'*'.repeat(Math.min(6, s.length - 2))}${s[s.length - 1]}`);

/** @returns {{ hits: {category:string, score:number, samples:string[]}[], spans:{start:number,end:number,category:string}[], text:string }} */
export const scan = (original, opts = {}) => {
  const { text, tokens: allTokens } = tokenize(String(original ?? '').slice(0, 20000));
  const tokens = allTokens.slice(0, 3000);
  const custom = compileCustom(opts.customWords);
  const allow = compileAllow(opts.allowWords);
  const strong = {}; const weak = {}; const samples = {}; const used = {}; const spans = [];
  const bump = (cat, w, key, sample) => {
    used[cat] ??= new Set();
    if (used[cat].has(key)) return;
    used[cat].add(key);
    if (w >= 2) strong[cat] = (strong[cat] ?? 0) + w; else weak[cat] = (weak[cat] ?? 0) + w;
    (samples[cat] ??= []).push(sample);
  };

  for (const t of tokens) {
    if (allow.has(t.w) || WORD_OK.some((r) => r.test(t.w))) continue;
    const variants = wordVariants(t.w);
    if (variants.some((v) => allow.has(v))) continue;
    let strongest = null;
    for (const v of variants) {
      if (WORD_OK.some((r) => r.test(v))) continue;
      for (const r of WORD_RULES_RE) {
        if (r.re.test(v)) { if (!strongest || r.w > strongest.w) strongest = r; }
      }
    }
    if (strongest) {
      bump(strongest.cat, strongest.w, `${strongest.id}:${t.w}`, sampleOf(t.w));
      spans.push({ start: t.start, end: t.end, category: strongest.cat });
    }
  }

  // Раскладка: целые «слова» из клавиш английской раскладки, включая знаки (",kznm" = «блять»).
  for (const chunk of text.split(/\s+/)) {
    if (chunk.length < 3 || !/^[a-z\[\];',.`]+$/.test(chunk) || !/[a-z]{2}/.test(chunk)) continue;
    const conv = mapChars(chunk, EN2RU);
    for (const m2 of conv.matchAll(/[а-я]+/gu)) {
      if (allow.has(m2[0])) continue;
      const vs = [m2[0], collapse(m2[0])];
      let best = null;
      for (const v of vs) {
        if (WORD_OK.some((r) => r.test(v))) continue;
        for (const r of WORD_RULES_RE) if (r.re.test(v) && (!best || r.w > best.w)) best = r;
      }
      if (best) { bump(best.cat, best.w, `${best.id}:L${m2[0]}`, sampleOf(m2[0])); const at = text.indexOf(chunk); if (at >= 0) spans.push({ start: at, end: at + chunk.length, category: best.cat }); }
    }
  }

  // Фразы — по тексту в нескольких видах: обычном, с двойниками букв, без разделителей между короткими словами.
  const textViews = new Set([text, collapse(text)]);
  textViews.add(mapChars(mapChars(mapChars(text, SYM_CYR), DIGIT_CYR), LAT2CYR));
  textViews.add(text.replace(/(?<=[\p{L}])[.\-_*,]+(?=[\p{L}])/gu, ''));
  if (/^[a-z0-9\s\[\];',.`]+$/.test(text)) textViews.add(mapChars(text, EN2RU));
  for (const view of textViews) {
    for (const r of [...PHRASE_RE, ...custom]) {
      const m = r.re.exec(view);
      if (m) bump(r.cat, r.w, r.id, sampleOf(m[0].replace(/\s+/g, ' ').slice(0, 12)));
    }
  }

  // Контекст.
  const soft = SOFTEN.test(text);
  const sale = SALE.test(text);
  const hits = [];
  for (const cat of new Set([...Object.keys(strong), ...Object.keys(weak)])) {
    // слабые слова вместе дают не больше одного очка: «пистолет» и «патроны» — ещё не запрещёнка
    let sc = (strong[cat] ?? 0) + Math.min(weak[cat] ?? 0, 1);
    if (SALE_CATS.has(cat) && sale && sc >= 1) sc += 1;
    if (SOFT_CATS.has(cat) && soft && !sale && sc < 6) sc -= 2;
    if (sc >= THRESHOLD) hits.push({ category: cat, score: sc, samples: samples[cat].slice(0, 3) });
  }
  return { hits, spans: spans.filter((s) => hits.some((h) => h.category === s.category)), text };
};

const maskOriginal = (original, spans) => {
  // spans — позиции в baseNormalize(original); длина строки при нормализации может отличаться,
  // поэтому маскируем по словам оригинала заново.
  const src = String(original ?? '');
  const norm = baseNormalize(src);
  if (norm.length !== src.length) {
    // позиции съехали — маскируем слова оригинала по месту, сравнив их нормализованные формы
    const wanted = new Set(spans.map((s) => norm.slice(s.start, s.end)));
    return src.replace(TOKEN_RE, (w) => (wanted.has(baseNormalize(w)) ? '*'.repeat(Math.min(w.length, 8)) : w));
  }
  let out = ''; let last = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < last) continue;
    out += src.slice(last, s.start) + '*'.repeat(Math.min(s.end - s.start, 8));
    last = s.end;
  }
  return out + src.slice(last);
};

/** Итог по набору настроек.
 * @returns {{ action:'allow'|'mask'|'moderate'|'block', categories:string[], hits:any[], mask:(s:string)=>string }} */
export const inspectText = (original, settings = {}) => {
  const actions = { ...DEFAULT_ACTIONS, ...(settings.actions ?? {}) };
  if (settings.enabled === false) return { action: 'allow', categories: [], hits: [], mask: (s) => s };
  const r = scan(original, settings);
  let worst = 'allow'; const categories = [];
  const fired = [];
  for (const h of r.hits) {
    const a = ACTIONS.includes(actions[h.category]) ? actions[h.category] : 'off';
    if (a === 'off') continue;
    categories.push(h.category); fired.push({ ...h, action: a });
    if (SEVERITY[a] > (SEVERITY[worst] ?? 0)) worst = a;
  }
  const maskCats = new Set(fired.filter((f) => f.action === 'mask').map((f) => f.category));
  return {
    action: worst, categories, hits: fired,
    mask: (s) => (maskCats.size ? maskOriginal(s, r.spans.filter((sp) => maskCats.has(sp.category))) : s),
  };
};

/** Несколько полей сразу (название, текст, теги): проверяется каждое поле и их склейка. */
export const inspectMany = (parts, settings) => {
  const fields = parts.map((p) => (p == null ? p : String(p)));
  const each = fields.map((p) => (p ? inspectText(p, settings) : null));
  const list = [...each.filter(Boolean)];
  const joined = fields.filter(Boolean);
  if (joined.length > 1) list.push(inspectText(joined.join('\n'), settings));
  let worst = 'allow'; const cats = new Set(); const hits = [];
  for (const r of list) {
    if (SEVERITY[r.action] > SEVERITY[worst]) worst = r.action;
    r.categories.forEach((c) => cats.add(c));
    hits.push(...r.hits);
  }
  return { action: worst, categories: [...cats], hits, maskFields: fields.map((p, i) => (each[i] ? each[i].mask(p) : p)) };
};
