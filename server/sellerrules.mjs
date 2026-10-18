/**
 * Sky Market: правила допуска к торговле.
 *
 * ЕДИНСТВЕННОЕ место, где решается, кто и что может продавать. Ни
 * интерфейс, ни отдельные ручки этого не решают: они только спрашивают
 * `evaluateListing` / `kindMayDo` и показывают причину отказа.
 *
 * Три слоя, и порядок важен:
 *
 *   1. ЖЁСТКИЙ НИЖНИЙ ПРЕДЕЛ (HARD_RULES ниже, зашит в код). Кто в
 *      принципе может заниматься каким видом торговли при выбранном
 *      налоговом статусе. Настройками администрации НЕ отключается и не
 *      расширяется — иначе «настраиваемые правила» позволили бы
 *      обойти ограничения, ради которых они существуют.
 *
 *   2. ПРАВИЛА КАТЕГОРИЙ (CATEGORY_DEFAULTS в коде + строки
 *      market_trade_rules). Администрация может ТОЛЬКО сужать допуск
 *      (оставить подмножество статусов, выключить категорию),
 *      добавлять требуемые документы и включать ручную проверку.
 *
 *   3. НАСТРОЙКИ МОДЕРАЦИИ (market_settings): предмодерация всех
 *      карточек, предел числа товаров у физлица.
 *
 * ВАЖНО О ЗАКОНЕ. Таблицы ниже — продуктовая политика Sky, собранная из
 * общих принципов (самозанятый не перепродаёт купленное, физлицо не
 * ведёт систематическую торговлю, часть категорий требует документов
 * или маркировки). Это НЕ юридическое заключение и не замена
 * консультации юриста: точные требования зависят от вида товара,
 * схемы поставки и режима налогообложения и меняются. Поэтому
 * спорное уходит на ручную проверку, а перечни документов и категорий
 * с маркировкой настраиваются без правки кода. Sky не интегрирован с
 * ФНС, ЕГРИП/ЕГРЮЛ, «Честным знаком» или таможней, и ни один экран не
 * должен говорить обратное: проверка здесь — ручная.
 */
import { query } from './db.mjs';

/* ─── Справочники ──────────────────────────────────────────────────── */

export const KINDS = ['individual', 'npd', 'ip', 'legal'];
export const KIND_LABEL = {
  individual: 'Физическое лицо', npd: 'Самозанятый (НПД)', ip: 'ИП', legal: 'Юридическое лицо',
};

/** Что продавец собирается продавать — «тип деятельности». */
export const ACTIVITIES = ['personal_items', 'own_production', 'resale', 'services'];
export const ACTIVITY_LABEL = {
  personal_items: 'Личные вещи (в том числе бывшие в употреблении)',
  own_production: 'Товары собственного производства',
  resale: 'Перепродажа приобретённых товаров',
  services: 'Услуги',
};

/** Источник конкретного товара (то же, что activity, но на уровне карточки). */
export const ITEM_SOURCES = ['personal', 'own_production', 'resale'];
export const ITEM_CONDITIONS = ['new', 'used'];
export const MARKING_DECLARED = ['not_required', 'required', 'unsure'];

const SOURCE_TO_ACTIVITY = {
  personal: 'personal_items', own_production: 'own_production', resale: 'resale',
};

export const DOC_TYPES = {
  npd_certificate: 'Справка о постановке на учёт самозанятого (НПД)',
  egrip_extract: 'Выписка из ЕГРИП',
  egrul_extract: 'Выписка из ЕГРЮЛ',
  authority_doc: 'Документ, подтверждающий полномочия представителя',
  certificate: 'Сертификат или декларация соответствия',
  permit: 'Разрешительный документ',
  importer_info: 'Сведения об импортёре / ввозе',
  origin_proof: 'Подтверждение происхождения товара',
  marking_proof: 'Подтверждение маркировки',
  premises_doc: 'Документ на помещение (право пользования)',
  other: 'Другой документ',
};

/** Документы, обязательные при подаче заявки, по статусу. */
export const APPLICATION_DOCS = {
  individual: [],
  npd: ['npd_certificate'],
  ip: ['egrip_extract'],
  legal: ['egrul_extract'],
};

/** Продавцу-физлицу в рамках «личных вещей» хватает этой границы; выше — повторная проверка. */
export const DEFAULT_SETTINGS = {
  premoderation: 'risky',          // 'risky' | 'all'
  individualMaxProducts: 30,       // продуктовая граница «это уже не личные вещи»
};

/* ─── Жёсткий нижний предел (не настраивается) ─────────────────────── */

/**
 * Какие виды деятельности допустимы при статусе. Сюда не дотягивается ни
 * одна настройка администрации.
 */
const HARD_ACTIVITIES = {
  individual: ['personal_items'],
  npd: ['personal_items', 'own_production', 'services'],
  ip: ['personal_items', 'own_production', 'resale', 'services'],
  legal: ['personal_items', 'own_production', 'resale', 'services'],
};

const RESALE_NEEDS_STATUS = 'Перепродажа приобретённых товаров требует статуса ИП или юридического лица.';

/**
 * Может ли статус заниматься такой деятельностью. Возвращает человеческую
 * причину отказа — её показывают в форме.
 */
export const activityAllowed = (kind, activity) => {
  if (!KINDS.includes(kind)) return { ok: false, error: 'bad_kind', message: 'Неизвестный статус продавца.' };
  if (!ACTIVITIES.includes(activity)) return { ok: false, error: 'bad_activity', message: 'Неизвестный вид деятельности.' };
  if (HARD_ACTIVITIES[kind].includes(activity)) return { ok: true };
  if (activity === 'resale') {
    return { ok: false, error: 'resale_needs_status', message: RESALE_NEEDS_STATUS };
  }
  if (kind === 'individual') {
    return {
      ok: false, error: 'business_needs_status',
      message: 'Регулярная продажа собственных изделий или услуг — предпринимательская деятельность. '
        + 'Оформите самозанятость (НПД), ИП или юридическое лицо.',
    };
  }
  return { ok: false, error: 'activity_not_allowed', message: 'Этот вид деятельности для выбранного статуса недоступен.' };
};

/** Статусы, которым вообще можно заявку на ПВЗ. */
export const PVZ_KINDS = ['ip', 'legal'];

/* ─── Форматы реквизитов (настоящие контрольные суммы) ─────────────── */

const digits = (v) => String(v ?? '').replace(/\s+/g, '');

/** ИНН: 10 цифр (организация) или 12 (физлицо/ИП) с контрольными разрядами. */
export const validInn = (raw, { length } = {}) => {
  const s = digits(raw);
  if (!/^\d+$/.test(s)) return false;
  if (length && s.length !== length) return false;
  const calc = (w) => {
    let sum = 0;
    for (let i = 0; i < w.length; i += 1) sum += Number(s[i]) * w[i];
    return (sum % 11) % 10;
  };
  if (s.length === 10) return calc([2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(s[9]);
  if (s.length === 12) {
    return calc([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(s[10])
      && calc([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === Number(s[11]);
  }
  return false;
};

/** ОГРН: 13 цифр, контрольная — остаток от деления первых 12 на 11. */
export const validOgrn = (raw) => {
  const s = digits(raw);
  if (!/^\d{13}$/.test(s)) return false;
  return Number(BigInt(s.slice(0, 12)) % 11n % 10n) === Number(s[12]);
};

/** ОГРНИП: 15 цифр, контрольная — остаток от деления первых 14 на 13. */
export const validOgrnip = (raw) => {
  const s = digits(raw);
  if (!/^\d{15}$/.test(s)) return false;
  return Number(BigInt(s.slice(0, 14)) % 13n % 10n) === Number(s[14]);
};

export const validPhone = (v) => /^\+?[0-9][0-9 ()\-]{6,20}$/.test(String(v ?? '').trim());
export const validEmail = (v) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v ?? '').trim());
export const validCountry = (v) => /^[A-Z]{2}$/.test(String(v ?? ''));

/* ─── Анкеты по статусам ───────────────────────────────────────────── */

/**
 * Поля анкеты. Одно описание обслуживает и сервер (что обязательно),
 * и клиент (что нарисовать): расходиться им не из чего.
 */
export const FORMS = {
  individual: [
    { key: 'fullName', label: 'ФИО', required: true, max: 120 },
    { key: 'phone', label: 'Телефон', required: true, max: 30, type: 'phone' },
    { key: 'email', label: 'Почта', required: false, max: 200, type: 'email' },
  ],
  npd: [
    { key: 'fullName', label: 'ФИО', required: true, max: 120 },
    { key: 'inn', label: 'ИНН (12 цифр)', required: true, max: 12, type: 'inn12' },
    { key: 'phone', label: 'Телефон', required: true, max: 30, type: 'phone' },
    { key: 'email', label: 'Почта', required: false, max: 200, type: 'email' },
  ],
  ip: [
    { key: 'fullName', label: 'ФИО предпринимателя', required: true, max: 120 },
    { key: 'inn', label: 'ИНН (12 цифр)', required: true, max: 12, type: 'inn12' },
    { key: 'ogrnip', label: 'ОГРНИП (15 цифр)', required: true, max: 15, type: 'ogrnip' },
    { key: 'phone', label: 'Телефон', required: true, max: 30, type: 'phone' },
    { key: 'email', label: 'Почта', required: true, max: 200, type: 'email' },
  ],
  legal: [
    { key: 'orgName', label: 'Полное наименование организации', required: true, max: 250 },
    { key: 'inn', label: 'ИНН (10 цифр)', required: true, max: 10, type: 'inn10' },
    { key: 'ogrn', label: 'ОГРН (13 цифр)', required: true, max: 13, type: 'ogrn' },
    { key: 'orgPhone', label: 'Телефон организации', required: true, max: 30, type: 'phone' },
    { key: 'orgEmail', label: 'Почта организации', required: true, max: 200, type: 'email' },
    { key: 'repName', label: 'ФИО представителя', required: true, max: 120 },
    { key: 'repPosition', label: 'Должность представителя', required: true, max: 120 },
    // Если представитель — руководитель, доверенность не нужна.
    { key: 'repIsHead', label: 'Представитель — руководитель организации', required: false, type: 'bool' },
  ],
};

const typeError = {
  phone: 'Проверьте телефон.',
  email: 'Проверьте адрес почты.',
  inn12: 'ИНН физлица/ИП — 12 цифр с верной контрольной суммой.',
  inn10: 'ИНН организации — 10 цифр с верной контрольной суммой.',
  ogrn: 'ОГРН — 13 цифр с верной контрольной суммой.',
  ogrnip: 'ОГРНИП — 15 цифр с верной контрольной суммой.',
};

/**
 * Привести присланные поля анкеты к чистому виду и проверить формат.
 * `strict: false` — для черновика: пустое допустимо, мусор нет.
 */
export const cleanForm = (kind, input, { strict, lenient = false }) => {
  const out = {};
  const problems = [];
  for (const f of FORMS[kind] ?? []) {
    const raw = input?.[f.key];
    if (f.type === 'bool') { out[f.key] = raw === true; continue; }
    const v = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, f.max ?? 200);
    const filled = v.length > 0;
    if (!filled) {
      if (f.required && strict) problems.push({ field: f.key, message: `Заполните поле «${f.label}».` });
      out[f.key] = '';
      continue;
    }
    let ok = true;
    // Черновик (lenient): формат и контрольные суммы не проверяем — иначе опечатка блокирует загрузку документов; строго проверяется при отправке.
    if (lenient) { out[f.key] = v; continue; }
    if (f.type === 'phone') ok = validPhone(v);
    else if (f.type === 'email') ok = validEmail(v);
    else if (f.type === 'inn12') ok = validInn(v, { length: 12 });
    else if (f.type === 'inn10') ok = validInn(v, { length: 10 });
    else if (f.type === 'ogrn') ok = validOgrn(v);
    else if (f.type === 'ogrnip') ok = validOgrnip(v);
    if (!ok) problems.push({ field: f.key, message: `${f.label}: ${typeError[f.type] ?? 'проверьте значение.'}` });
    out[f.key] = v;
  }
  return { fields: out, problems };
};

/** Какие документы нужны к заявке при заданных полях. */
export const requiredApplicationDocs = (kind, fields) => {
  const need = [...(APPLICATION_DOCS[kind] ?? [])];
  if (kind === 'legal' && fields?.repIsHead !== true) need.push('authority_doc');
  return need;
};

/* ─── Правила категорий ────────────────────────────────────────────── */

/**
 * Ориентиры по категориям. Это стартовая политика Sky, не закон:
 * администрация настраивает её в market_trade_rules.
 *
 * `docsWhenNew` — документы нужны, когда товар НОВЫЙ и не из личных
 * вещей. Подержанные личные вещи документов не требуют.
 */
export const CATEGORY_DEFAULTS = {
  electronics: { docsWhenNew: ['certificate'], markingPossible: false, manualReview: false },
  clothing:    { docsWhenNew: [],              markingPossible: true,  manualReview: false },
  home:        { docsWhenNew: [],              markingPossible: false, manualReview: false },
  beauty:      { docsWhenNew: ['certificate'], markingPossible: true,  manualReview: false },
  sports:      { docsWhenNew: [],              markingPossible: false, manualReview: false },
  books:       { docsWhenNew: [],              markingPossible: false, manualReview: false },
  toys:        { docsWhenNew: ['certificate'], markingPossible: false, manualReview: false },
  food:        { docsWhenNew: ['certificate'], markingPossible: true,  manualReview: true,
                 allowedKinds: ['npd', 'ip', 'legal'] },
  other:       { docsWhenNew: [],              markingPossible: false, manualReview: false },
};

export const loadRules = async () => {
  const { rows } = await query('SELECT * FROM market_trade_rules');
  const map = new Map();
  for (const r of rows) map.set(r.rule_key, r);
  return map;
};

export const loadSettings = async () => {
  const { rows } = await query('SELECT key, value FROM market_settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key === 'premoderation' && ['risky', 'all'].includes(r.value)) out.premoderation = r.value;
    if (r.key === 'individualMaxProducts' && Number.isInteger(r.value) && r.value >= 1 && r.value <= 1000) {
      out.individualMaxProducts = r.value;
    }
  }
  return out;
};

/** Итоговое правило категории: умолчания кода, суженные строкой из базы. */
export const effectiveCategoryRule = (category, rules) => {
  const base = CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.other;
  const row = rules?.get?.(`category:${category}`);
  let allowedKinds = base.allowedKinds ?? KINDS;
  if (row?.allowed_kinds) allowedKinds = allowedKinds.filter((k) => row.allowed_kinds.includes(k));
  const docsWhenNew = [...new Set([...(base.docsWhenNew ?? []), ...(row?.required_docs ?? [])])]
    .filter((d) => DOC_TYPES[d]);
  return {
    disabled: Boolean(row?.disabled),
    allowedKinds,
    docsWhenNew,
    markingPossible: Boolean(base.markingPossible || row?.marking_possible),
    manualReview: Boolean(base.manualReview || row?.manual_review),
    note: row?.note ?? '',
  };
};

/* ─── Главная проверка карточки ────────────────────────────────────── */

/**
 * Можно ли публиковать эту карточку и что для этого нужно.
 *
 * seller: { status, verification, taxKind }  (из market_sellers)
 * product: поля карточки как в таблице (snake_case)
 * docs:   принятые/ожидающие документы товара [{ doc_type, status }]
 * ctx:    { rules, settings, activeCount }
 *
 * Возвращает:
 *   blockers   — без этого публиковать нельзя (объясняем и говорим, что сделать);
 *   review     — публикация только после ручной проверки;
 *   requiredDocs / missingDocs — какие документы нужны и каких не хватает.
 */
export const evaluateListing = ({ seller, product, docs = [], ctx }) => {
  const blockers = [];
  const review = [];
  const block = (code, message) => blockers.push({ code, message });
  const needsReview = (code, message) => review.push({ code, message });

  /* — Продавец — */
  const v = seller.verification;
  if (seller.status === 'suspended' || v === 'suspended') {
    block('seller_suspended', 'Магазин приостановлен администрацией.');
  } else if (v === 'reverify') {
    block('reverification_required', 'Магазин ждёт повторной проверки. Обновите и отправьте заявку.');
  } else if (!['approved', 'legacy'].includes(v) || seller.status !== 'active') {
    block('seller_not_verified', 'Заявка продавца ещё не одобрена. Публикация товаров станет доступна после проверки.');
  }

  /* — Источник товара и статус — */
  const marketType = product.market_type;
  const source = product.item_source;
  const kind = seller.taxKind; // у старых магазинов null — нижний предел к ним не применяется
  if (!source || !ITEM_SOURCES.includes(source)) {
    block('source_required', 'Укажите, чей это товар: личная вещь, собственное производство или перепродажа.');
  } else if (kind) {
    const activity = marketType === 'service' ? 'services' : SOURCE_TO_ACTIVITY[source];
    const ok = activityAllowed(kind, activity);
    if (!ok.ok) block(ok.error, ok.message);
    else if (!(seller.activities ?? []).includes(activity)) {
      block('activity_not_approved',
        `В вашей заявке не подтверждён вид деятельности «${ACTIVITY_LABEL[activity]}». Подайте запрос на изменение.`);
    }
  }
  if (!product.item_condition && marketType === 'standard') {
    block('condition_required', 'Укажите состояние товара: новый или бывший в употреблении.');
  }
  if (kind === 'individual' && source === 'personal' && product.item_condition === 'new' && marketType === 'standard') {
    needsReview('individual_new_goods', 'Новые товары у физлица проверяются вручную: это может быть торговля, а не продажа личных вещей.');
  }
  if (kind === 'individual' && (ctx.activeCount ?? 0) > (ctx.settings.individualMaxProducts)) {
    block('individual_limit',
      `У физлица не может быть больше ${ctx.settings.individualMaxProducts} активных товаров. `
      + 'Регулярная торговля требует статуса самозанятого, ИП или юрлица — подайте запрос на изменение статуса.');
  }

  /* — Категория — */
  const category = marketType === 'standard' ? product.category : null;
  let rule = null;
  if (category) {
    rule = effectiveCategoryRule(category, ctx.rules);
    if (rule.disabled) block('category_disabled', 'Эта категория временно закрыта для публикации.');
    if (kind && !rule.allowedKinds.includes(kind)) {
      block('category_not_allowed', `Категория недоступна для статуса «${KIND_LABEL[kind]}».`);
    }
    if (rule.manualReview) needsReview('category_review', 'Категория проверяется вручную.');
  }

  /* — Происхождение и доставка (для физических товаров) — */
  if (marketType === 'standard') {
    if (!validCountry(product.origin_country)) block('origin_required', 'Укажите страну происхождения товара.');
    if (!validCountry(product.ship_from_country)) block('ship_from_required', 'Укажите страну, из которой отправляется заказ.');
    if (!validCountry(product.item_location_country)) block('location_required', 'Укажите, где находится товар.');
    const abroad = (c) => validCountry(c) && c !== 'RU';
    if (abroad(product.ship_from_country) || abroad(product.item_location_country)) {
      if (String(product.import_info ?? '').trim().length < 10) {
        block('import_info_required', 'Для товара за рубежом опишите, как он ввозится и доставляется (не менее 10 символов).');
      }
      needsReview('foreign_goods', 'Товар из-за рубежа проверяется вручную: ввоз и документы подтверждаются модератором, автоматической таможенной проверки нет.');
    }
    if (product.intl_shipping === true && !product.delivery_days_max) {
      block('delivery_days_required', 'Для международной доставки укажите ориентировочный срок.');
    }
    if (product.delivery_days_min && product.delivery_days_max
      && product.delivery_days_min > product.delivery_days_max) {
      block('delivery_days_bad', 'Минимальный срок доставки больше максимального.');
    }
  }

  /* — Документы и маркировка — */
  const have = new Set(docs.filter((d) => d.status !== 'rejected').map((d) => d.doc_type));
  const accepted = new Set(docs.filter((d) => d.status === 'accepted').map((d) => d.doc_type));
  const required = new Set();
  if (rule && product.item_condition === 'new' && source !== 'personal') {
    for (const d of rule.docsWhenNew) required.add(d);
  }
  if (rule?.markingPossible) {
    if (!product.marking_declared) {
      block('marking_declared_required', 'Укажите, подлежит ли товар обязательной маркировке.');
    } else if (product.marking_declared === 'required') {
      required.add('marking_proof');
      if (kind === 'npd') {
        block('npd_marked_goods', 'Самозанятые не торгуют товарами с обязательной маркировкой: для них нужен статус ИП или юрлица.');
      }
    } else if (product.marking_declared === 'unsure') {
      needsReview('marking_unsure', 'Нужна ручная проверка: не ясно, подлежит ли товар маркировке.');
    }
  }
  const missingDocs = [...required].filter((d) => !have.has(d));
  for (const d of missingDocs) block(`doc_${d}`, `Приложите документ: ${DOC_TYPES[d]}.`);
  const pendingDocs = [...required].filter((d) => have.has(d) && !accepted.has(d));
  if (pendingDocs.length) needsReview('docs_pending', 'Документы ждут ручной проверки модератора.');

  if (ctx.settings.premoderation === 'all') needsReview('premoderation_all', 'Включена предмодерация всех карточек.');

  return {
    ok: blockers.length === 0,
    blockers,
    review,
    requiredDocs: [...required],
    missingDocs,
    // Прямая публикация без модератора допустима только если нет ни блокировок, ни причин для проверки.
    autoPublish: blockers.length === 0 && review.length === 0,
  };
};

/** Сводка «что вы можете продавать» для кабинета. */
export const sellerCapabilities = (kind, activities = []) => {
  if (!kind) return null;
  return {
    kind,
    activities: ACTIVITIES.map((a) => ({
      key: a,
      label: ACTIVITY_LABEL[a],
      allowedForStatus: activityAllowed(kind, a).ok,
      approved: activities.includes(a),
      reason: activityAllowed(kind, a).ok ? undefined : activityAllowed(kind, a).message,
    })),
    pvz: PVZ_KINDS.includes(kind),
  };
};
