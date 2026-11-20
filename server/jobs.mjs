/**
 * Sky Работа — самостоятельная вкладка поиска работы (не часть Sky GO и не Sky Авто). Это ядро: справочники, компании, вакансии, поиск, избранное, резюме.
 * Отклики, переписка, жалобы и администрирование — в `jobsapps.mjs`.
 *
 * Принципы:
 *  • Sky ID/профиль — единственная личность; новых учётных записей нет. Деньги (платные вакансии, продвижение) — только с кошелька Sky внутри одной транзакции.
 *  • Каждая вакансия проходит модерацию (draft → pending → published). Автопроверка на мошенничество (`scan`): требование денег у соискателя и контакты вне Sky
 *    в тексте отклоняются, «слишком хорошо, чтобы быть правдой» и странные зарплаты уходят модератору с пометками.
 *  • Резюме принадлежит человеку: согласие на обработку данных обязательно, текст и контакты зашифрованы, видимость public | applied | hidden,
 *    искать публичные резюме могут только проверенные работодатели, кандидат видит, кто его резюме открывал. Контакты работодатель получает лишь когда кандидат открыл их в отклике.
 *  • Проверка работодателя ручная (ИНН/пояснение → сотрудник); реестры ФНС не подключены, интерфейс так и говорит.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { inTx } from './gocore.mjs';
import { notifyGift } from './giftnotify.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { wallet } from './wallet.mjs';
import { checkContent, blockedReply } from './contentfilterstore.mjs';

export const err = (error, extra = {}) => ({ error, ...extra });
export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const line = (v, max) => clean(v, max).replace(/\s+/g, ' ');
export const newId = (p) => `${p}-${crypto.randomUUID()}`;
export const note = (to, title, body, ref) => notifyGift(to, 'jobs', title, body, ref).catch(() => {});
export const log = (actor, action, target = '', detail = '') => query('INSERT INTO job_log (actor, action, target, detail) VALUES ($1,$2,$3,$4)', [actor, action, target, clean(detail, 300)]).catch(() => {});

export const SCHEDULE = { full_day: 'Полный день', shift: 'Сменный график', flexible: 'Гибкий график', remote: 'Удалённо', rotation: 'Вахта' };
export const EMPLOYMENT = { full: 'Полная занятость', part: 'Частичная занятость', project: 'Проектная работа', internship: 'Стажировка' };
export const EXPERIENCE = { none: 'Без опыта', '1_3': '1–3 года', '3_6': '3–6 лет', '6_plus': 'Более 6 лет' };
export const APP_STATUS = { sent: 'Отправлен', viewed: 'Просмотрен', invited: 'Приглашение', interview: 'Собеседование', rejected: 'Отказ', offer: 'Предложение о работе', hired: 'Принят' };
export const REPORT_REASONS = { scam: 'Мошенничество', payment_demand: 'Требуют деньги', fake_company: 'Ненастоящая компания', discrimination: 'Дискриминация', spam: 'Спам', personal_data: 'Утечка личных данных', other: 'Другое' };

/* ─── Защита от мошеннических вакансий и сообщений ─── */
const NO_INVEST = /без\s+вложени/giu;
const PAY = /(предоплат|залог|взнос|депозит|за\s+трудоустройств|(оплат|внес|внеси|заплат|перевед|перевод)[а-яё]*\s+(за\s+)?(обучен|оформлен|страховк|медкниж|спецодежд|форм[уы]|курс|комплект|доступ|регистрац|пропуск)|вложени[яеий]|купит[еь]\s+(у\s+нас|комплект|набор|товар|оборудовани))/iu;
const CONTACT = /(https?:\/\/|www\.|t\.me\/|@[a-z0-9_]{4,}|\b(telegram|телеграм|whatsapp|ватсап|вацап|viber|вайбер)\b|[\w.+-]+@[\w-]+\.[\w.]+|(\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})/iu;
const TOO_GOOD = /((лёгк|легк)[а-яё]*\s+заработ|заработ[а-яё]*\s+без\s+(опыта|усили)|быстр[а-яё]*\s+деньги|работа\s+на\s+дому\s+без|\d[\d\s]{3,}\s*(₽|руб)[а-я.]*\s+в\s+(день|сутки)|доход\s+от\s+\d[\d\s]{5,})/iu;
const SECRET = /(\b(?:\d[ -]?){15,18}\d\b|\bcvv\b|\bcvc\b|пин[-\s]?код|код\s+из\s+(смс|sms|сообщени)|пароль|парол[ьяю]\s+от|сид[-\s]?фраз|seed\s*phrase|паспорт[а-я]*\s*(серия|№|номер)?\s*\d{4}\s*\d{6})/iu;
/** Разбор текста вакансии: block — отклонить сразу, flags — отправить модератору с пометками. */
export const scan = (text) => {
  const t = String(text ?? '').replace(NO_INVEST, ' ');
  if (PAY.test(t)) return { block: 'payment_demand', flags: [] };
  if (CONTACT.test(t)) return { block: 'contact_in_text', flags: [] };
  const flags = []; if (TOO_GOOD.test(t)) flags.push('too_good_to_be_true');
  return { block: null, flags };
};
/** Сообщения: деньги и секреты запрещены всем; контакты вне Sky работодателю — только после согласия кандидата. */
export const scanMessage = (text, { fromEmployer, contactsOpen }) => {
  const t = String(text ?? '').replace(NO_INVEST, ' ');
  if (SECRET.test(t)) return 'secret_in_message';
  if (PAY.test(t)) return 'payment_demand';
  if (fromEmployer && !contactsOpen && CONTACT.test(t)) return 'contact_not_allowed';
  return null;
};
export const hasPersonalSecret = (text) => SECRET.test(String(text ?? ''));

/* ─── Настройки и справочники ─── */
let setMemo = { at: 0, v: null };
export const settings = async (force = false) => {
  if (!force && setMemo.v && Date.now() - setMemo.at < 10_000) return setMemo.v;
  const r = (await query('SELECT * FROM job_settings WHERE id')).rows[0];
  setMemo = { at: Date.now(), v: { freeVacancies: r.free_vacancies, vacancyPriceRub: r.vacancy_price_rub, promoPriceRub: r.promo_price_rub, vacancyDays: r.vacancy_days, resumesNeedVerified: r.resumes_need_verified } };
  return setMemo.v;
};
export const dropSettingsCache = () => { setMemo = { at: 0, v: null }; };
export const categories = async ({ all = false } = {}) => ({ categories: (await query(`SELECT id, name, sort, hidden FROM job_categories ${all ? '' : 'WHERE NOT hidden'} ORDER BY sort, name`)).rows });
export const config = async () => ({ ok: true, schedule: SCHEDULE, employment: EMPLOYMENT, experience: EXPERIENCE, appStatus: APP_STATUS, reportReasons: REPORT_REASONS, settings: await settings(), ...(await categories()) });

export const blockedProfile = async (me) => (await query('SELECT reason FROM job_profile_blocks WHERE profile_id = $1', [me])).rows[0] ?? null;
const guard = async (me) => ((await blockedProfile(me)) ? err('blocked') : null);

/* ─── Компания работодателя ─── */
const httpsUrl = (v) => { const s = String(v ?? '').trim(); if (!s) return ''; try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 300) : null; } catch { return null; } };
export const VERIFY_LABEL = { none: 'Не проверен', pending: 'Проверка идёт', verified: 'Проверен Sky', rejected: 'Проверка не пройдена' };
const companyShape = (c) => c && { id: c.id, name: c.name, about: c.about, city: c.city, site: c.site, status: c.status, blockReason: c.status === 'blocked' ? c.block_reason : '', verifyStatus: c.verify_status, verifyLabel: VERIFY_LABEL[c.verify_status], verifyReason: c.verify_status === 'rejected' ? c.verify_reason : '', verified: c.verify_status === 'verified' };
export const myCompany = async (me) => ({ ok: true, company: companyShape((await query('SELECT * FROM job_companies WHERE owner_id = $1', [me])).rows[0]) ?? null });
export const saveCompany = async (me, body) => {
  const g = await guard(me); if (g) return g;
  const name = line(body?.name, 80); if (name.length < 2) return err('bad_field', { field: 'name' });
  const site = httpsUrl(body?.site); if (site === null) return err('bad_field', { field: 'site' });
  const about = clean(body?.about, 1500); const city = line(body?.city, 80);
  const v = await checkContent('job_company', me, [name, about]); if (v.action === 'block') return blockedReply(v);
  const cur = (await query('SELECT * FROM job_companies WHERE owner_id = $1', [me])).rows[0];
  if (cur?.status === 'blocked') return err('blocked');
  if (cur) {
    // смена названия у проверенной компании сбрасывает проверку: проверялась именно эта организация
    const rename = cur.name !== name && cur.verify_status === 'verified';
    await query(`UPDATE job_companies SET name=$2, about=$3, city=$4, site=$5, verify_status = CASE WHEN $6 THEN 'none' ELSE verify_status END, updated_at=now() WHERE id=$1`, [cur.id, name, about, city, site, rename]);
  } else await query('INSERT INTO job_companies (id, owner_id, name, about, city, site) VALUES ($1,$2,$3,$4,$5,$6)', [newId('jco'), me, name, about, city, site]);
  return myCompany(me);
};
export const requestVerify = async (me, body) => {
  const g = await guard(me); if (g) return g;
  const c = (await query('SELECT * FROM job_companies WHERE owner_id = $1', [me])).rows[0]; if (!c) return err('no_company');
  if (c.status === 'blocked') return err('blocked');
  if (c.verify_status === 'verified') return err('already_verified');
  if (c.verify_status === 'pending') return { ok: true, duplicate: true };
  const inn = String(body?.inn ?? '').replace(/\s/g, ''); if (!/^(\d{10}|\d{12})$/.test(inn)) return err('bad_field', { field: 'inn' });
  const text = clean(body?.note, 600); if (text.length < 10) return err('bad_field', { field: 'note' });
  await query(`UPDATE job_companies SET verify_status='pending', verify_claim_enc=$2, verify_reason='', verify_submitted_at=now(), updated_at=now() WHERE id=$1`, [c.id, encryptSecret(JSON.stringify({ inn, note: text }))]);
  void import('./staffnotify.mjs').then((m) => m.notifyStaff('job_employer', { title: 'Работодатель просит проверку', body: c.name, dedupe: `${c.id}:${Date.now() >> 16}`, except: me })).catch(() => {});
  return myCompany(me);
};

/* ─── Вакансии ─── */
const salaryOf = (b) => {
  const n = (v) => (v === '' || v == null ? null : Number(v));
  const f = n(b?.salaryFrom); const t = n(b?.salaryTo);
  for (const x of [f, t]) if (x != null && (!Number.isInteger(x) || x < 0 || x > 100_000_000)) return null;
  if (f != null && t != null && t < f) return null;
  return { f, t };
};
const vacShape = (r, extra = {}) => ({ id: r.id, title: r.title, categoryId: r.category_id, city: r.city, remote: r.remote, salaryFrom: r.salary_from, salaryTo: r.salary_to,
  schedule: r.schedule, scheduleLabel: SCHEDULE[r.schedule], employment: r.employment, employmentLabel: EMPLOYMENT[r.employment], experience: r.experience, experienceLabel: EXPERIENCE[r.experience],
  status: r.status, publishedAt: r.published_at?.toISOString?.() ?? null, promoted: Boolean(r.promoted_until && r.promoted_until > new Date()), ...extra });
const COMPANY_COLS = 'c.id AS company_id, c.name AS company_name, c.verify_status, c.city AS company_city';

export const saveVacancy = async (me, id, body) => {
  const g = await guard(me); if (g) return g;
  const co = (await query('SELECT * FROM job_companies WHERE owner_id = $1', [me])).rows[0]; if (!co) return err('no_company');
  if (co.status === 'blocked') return err('blocked');
  const title = line(body?.title, 100); if (title.length < 3) return err('bad_field', { field: 'title' });
  const cat = String(body?.categoryId ?? ''); if (!(await query('SELECT 1 FROM job_categories WHERE id = $1 AND NOT hidden', [cat])).rows[0]) return err('bad_field', { field: 'categoryId' });
  const sal = salaryOf(body); if (!sal) return err('bad_field', { field: 'salary' });
  const pick = (v, set, d) => (v === undefined ? d : v in set ? v : null);
  const schedule = pick(body?.schedule, SCHEDULE, 'full_day'); const employment = pick(body?.employment, EMPLOYMENT, 'full'); const experience = pick(body?.experience, EXPERIENCE, 'none');
  if (!schedule || !employment || !experience) return err('bad_field', { field: 'enum' });
  const description = clean(body?.description, 5000); const requirements = clean(body?.requirements, 2000); const conditions = clean(body?.conditions, 2000);
  const remote = Boolean(body?.remote) || schedule === 'remote'; const city = line(body?.city, 80);
  if (!remote && !city) return err('bad_field', { field: 'city' });
  const all = [title, description, requirements, conditions].join('\n');
  const sc = scan(all); if (sc.block) return err(sc.block);
  const cf = await checkContent('job', me, [title, description, requirements, conditions]); if (cf.action === 'block') return blockedReply(cf);
  const flags = [...sc.flags]; if (cf.action === 'moderate') flags.push('content_filter');
  if (sal.f != null && sal.f > 1_000_000) flags.push('salary_extreme'); if (sal.f && sal.t && sal.t > sal.f * 5) flags.push('salary_wide');
  if (co.verify_status !== 'verified' && flags.length) flags.push('unverified_employer');
  if (id) {
    const cur = (await query('SELECT * FROM job_vacancies WHERE id = $1 AND company_id = $2', [id, co.id])).rows[0]; if (!cur) return err('not_found');
    if (cur.status === 'closed' || cur.status === 'blocked') return err('bad_state');
    // правка опубликованной или ожидающей вакансии возвращает её в черновик: на витрине — только проверенный текст
    await query(`UPDATE job_vacancies SET title=$2, category_id=$3, city=$4, remote=$5, salary_from=$6, salary_to=$7, schedule=$8, employment=$9, experience=$10, description=$11, requirements=$12, conditions=$13, flags=$14,
        status = CASE WHEN status IN ('published','pending') THEN 'draft' ELSE status END, updated_at = now() WHERE id=$1`, [id, title, cat, city, remote, sal.f, sal.t, schedule, employment, experience, description, requirements, conditions, flags]);
    return { ok: true, id, returnedToDraft: ['published', 'pending'].includes(cur.status) };
  }
  if ((await query(`SELECT count(*)::int AS n FROM job_vacancies WHERE company_id = $1 AND created_at > now() - interval '24 hours'`, [co.id])).rows[0].n >= 20) return err('too_many_requests');
  const nid = newId('jvc');
  await query(`INSERT INTO job_vacancies (id, company_id, title, category_id, city, remote, salary_from, salary_to, schedule, employment, experience, description, requirements, conditions, flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [nid, co.id, title, cat, city, remote, sal.f, sal.t, schedule, employment, experience, description, requirements, conditions, flags]);
  return { ok: true, id: nid };
};

/** Отправка на проверку. Свыше бесплатного числа открытых вакансий — платно (цену задаёт администрация), списание и статус — одна транзакция. */
export const submitVacancy = async (me, id) => {
  const g = await guard(me); if (g) return g;
  const st = await settings(true);
  const res = await inTx(async (c) => {
    const co = (await c.query('SELECT * FROM job_companies WHERE owner_id = $1 FOR UPDATE', [me])).rows[0]; if (!co) return err('no_company');
    if (co.status === 'blocked') return err('blocked');
    const v = (await c.query('SELECT * FROM job_vacancies WHERE id = $1 AND company_id = $2 FOR UPDATE', [String(id ?? ''), co.id])).rows[0]; if (!v) return err('not_found');
    if (v.status === 'pending') return { ok: true, duplicate: true };
    if (!['draft', 'rejected'].includes(v.status)) return err('bad_state');
    if (v.description.length < 50) return err('incomplete', { missing: ['Описание не короче 50 знаков'] });
    const active = (await c.query(`SELECT count(*)::int AS n FROM job_vacancies WHERE company_id = $1 AND status IN ('pending','published') AND id <> $2`, [co.id, v.id])).rows[0].n;
    let paid = 0;
    if (active >= st.freeVacancies) {
      if (st.vacancyPriceRub <= 0) return err('vacancy_limit', { limit: st.freeVacancies });
      const s = await wallet.spendIn(c, me, st.vacancyPriceRub, 'jobs_vacancy', `Sky Работа: вакансия «${v.title}»`, `jobv:${v.id}`);
      if (s.error) return err(s.error === 'insufficient_funds' ? 'insufficient_funds' : 'payment_failed', { priceRub: st.vacancyPriceRub });
      paid = st.vacancyPriceRub;
    }
    await c.query(`UPDATE job_vacancies SET status='pending', submitted_at=now(), reject_reason='', paid_rub=$2, updated_at=now() WHERE id=$1`, [v.id, paid]);
    return { ok: true, paidRub: paid, title: v.title, flagged: v.flags.length > 0 };
  });
  if (res.ok && !res.duplicate) void import('./staffnotify.mjs').then((m) => m.notifyStaff('job_vacancy', { title: res.flagged ? 'Вакансия на проверке (есть пометки)' : 'Вакансия на проверке', body: res.title, dedupe: `${id}:${Date.now() >> 14}`, except: me })).catch(() => {});
  return res;
};
export const closeVacancy = async (me, id) => {
  const r = await query(`UPDATE job_vacancies v SET status='closed', updated_at=now() FROM job_companies c WHERE v.id=$1 AND c.id=v.company_id AND c.owner_id=$2 AND v.status IN ('draft','pending','published','rejected') RETURNING v.id`, [String(id ?? ''), me]);
  return r.rowCount ? { ok: true } : err('not_found');
};
export const promoteVacancy = async (me, id) => {
  const g = await guard(me); if (g) return g;
  const st = await settings(true); if (st.promoPriceRub <= 0) return err('promotion_unavailable');
  return inTx(async (c) => {
    const v = (await c.query(`SELECT v.* FROM job_vacancies v JOIN job_companies co ON co.id = v.company_id WHERE v.id = $1 AND co.owner_id = $2 AND co.status = 'active' FOR UPDATE OF v`, [String(id ?? ''), me])).rows[0];
    if (!v) return err('not_found'); if (v.status !== 'published') return err('bad_state');
    const s = await wallet.spendIn(c, me, st.promoPriceRub, 'jobs_promo', `Sky Работа: продвижение «${v.title}» на 7 дней`, `jobp:${v.id}:${Date.now()}`);
    if (s.error) return err(s.error === 'insufficient_funds' ? 'insufficient_funds' : 'payment_failed', { priceRub: st.promoPriceRub });
    await c.query(`UPDATE job_vacancies SET promoted_until = GREATEST(now(), COALESCE(promoted_until, now())) + interval '7 days', updated_at = now() WHERE id = $1`, [v.id]);
    return { ok: true, priceRub: st.promoPriceRub };
  });
};
export const myVacancies = async (me) => {
  const { rows } = await query(`SELECT v.*, c.verify_status,
      (SELECT count(*)::int FROM job_applications a WHERE a.vacancy_id = v.id) AS apps, (SELECT count(*)::int FROM job_applications a WHERE a.vacancy_id = v.id AND a.status = 'sent') AS apps_new
    FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE c.owner_id = $1 ORDER BY v.updated_at DESC LIMIT 200`, [me]);
  return { ok: true, vacancies: rows.map((r) => vacShape(r, { description: r.description, requirements: r.requirements, conditions: r.conditions, rejectReason: r.reject_reason, flags: r.flags, apps: r.apps, appsNew: r.apps_new, promotedUntil: r.promoted_until?.toISOString() ?? null, expiresAt: r.expires_at?.toISOString() ?? null, views: r.views })) };
};

/* ─── Публичный поиск ─── */
const VISIBLE = `v.status = 'published' AND (v.expires_at IS NULL OR v.expires_at > now()) AND c.status = 'active'`;
const SQLIKE = (s) => `%${String(s).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`;
export const searchVacancies = async (me, q = {}) => {
  const vals = [me]; let w = VISIBLE;
  const add = (sql, v) => { vals.push(v); w += ` AND ${sql.replace('?', `$${vals.length}`)}`; };
  if (q.q) { vals.push(SQLIKE(q.q)); w += ` AND (v.title ILIKE $${vals.length} OR v.description ILIKE $${vals.length} OR c.name ILIKE $${vals.length})`; }
  if (q.category) add('v.category_id = ?', String(q.category));
  if (q.city) add('(v.city ILIKE ? OR v.remote)', SQLIKE(q.city));
  if (q.schedule && q.schedule in SCHEDULE) add('v.schedule = ?', q.schedule);
  if (q.employment && q.employment in EMPLOYMENT) add('v.employment = ?', q.employment);
  if (q.experience && q.experience in EXPERIENCE) add('v.experience = ?', q.experience);
  if (q.remote === '1') w += ' AND v.remote';
  const sal = Number(q.salary); if (Number.isInteger(sal) && sal > 0) add('(COALESCE(v.salary_to, v.salary_from) >= ?)', sal);
  if (q.fav === '1') w += ' AND EXISTS (SELECT 1 FROM job_favs f WHERE f.vacancy_id = v.id AND f.profile_id = $1)';
  const limit = 30; const offset = Math.max(0, Math.min(5000, Number(q.offset) || 0));
  const { rows } = await query(`SELECT v.*, ${COMPANY_COLS}, EXISTS (SELECT 1 FROM job_favs f WHERE f.vacancy_id = v.id AND f.profile_id = $1) AS fav,
      (SELECT status FROM job_applications a WHERE a.vacancy_id = v.id AND a.applicant_id = $1) AS my_status
    FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE ${w}
    ORDER BY (v.promoted_until > now()) DESC NULLS LAST, v.published_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, vals);
  return { ok: true, more: rows.length > limit, vacancies: rows.slice(0, limit).map((r) => vacShape(r, { company: { id: r.company_id, name: r.company_name, verified: r.verify_status === 'verified' }, fav: r.fav, myStatus: r.my_status, snippet: r.description.slice(0, 160) })) };
};
export const getVacancy = async (me, id) => {
  const r = (await query(`SELECT v.*, ${COMPANY_COLS}, c.about AS company_about, c.site AS company_site, c.owner_id, EXISTS (SELECT 1 FROM job_favs f WHERE f.vacancy_id = v.id AND f.profile_id = $2) AS fav,
      (SELECT status FROM job_applications a WHERE a.vacancy_id = v.id AND a.applicant_id = $2) AS my_status, (SELECT id FROM job_applications a WHERE a.vacancy_id = v.id AND a.applicant_id = $2) AS my_app
    FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE v.id = $1`, [String(id ?? ''), me])).rows[0];
  if (!r) return err('not_found');
  const own = r.owner_id === me;
  const live = r.status === 'published' && (!r.expires_at || r.expires_at > new Date());
  if (!live && !own) return err('not_found');
  if (live && !own) void query('UPDATE job_vacancies SET views = views + 1 WHERE id = $1', [r.id]).catch(() => {});
  return { ok: true, vacancy: vacShape(r, { description: r.description, requirements: r.requirements, conditions: r.conditions, fav: r.fav, myStatus: r.my_status, myApplication: r.my_app, own, rejectReason: own ? r.reject_reason : '',
    company: { id: r.company_id, name: r.company_name, about: r.company_about, site: r.company_site, city: r.company_city, verified: r.verify_status === 'verified', verifyLabel: VERIFY_LABEL[r.verify_status] } }) };
};
export const toggleFav = async (me, id, on) => {
  const ok = await query(`SELECT 1 FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE v.id = $1 AND ${VISIBLE}`, [String(id ?? '')]); if (!ok.rows[0]) return err('not_found');
  if (on) { const n = (await query('SELECT count(*)::int AS n FROM job_favs WHERE profile_id = $1', [me])).rows[0].n; if (n >= 300) return err('too_many_favs');
    await query('INSERT INTO job_favs (profile_id, vacancy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, id]); }
  else await query('DELETE FROM job_favs WHERE profile_id = $1 AND vacancy_id = $2', [me, id]);
  return { ok: true, fav: Boolean(on) };
};

/* ─── Резюме ─── */
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const seal = (o) => encryptSecret(JSON.stringify(o));
const open = (s) => { try { return JSON.parse(decryptSecret(s) ?? '{}'); } catch { return {}; } };
const YEAR = /^\d{4}(-\d{2})?$|^$/;
const resumeBody = (b) => ({
  about: clean(b?.about, 3000),
  experience: arr(b?.experience, 15).map((x) => ({ company: line(x?.company, 100), role: line(x?.role, 100), from: String(x?.from ?? '').slice(0, 7), to: String(x?.to ?? '').slice(0, 7), text: clean(x?.text, 1000) })).filter((x) => x.company || x.role),
  education: arr(b?.education, 10).map((x) => ({ place: line(x?.place, 120), spec: line(x?.spec, 120), year: String(x?.year ?? '').slice(0, 4) })).filter((x) => x.place),
});
const resumeShape = (r, withBody = true, mine = false) => {
  const o = {
    id: r.id, position: r.position, categoryId: r.category_id, city: r.city, desiredSalary: r.desired_salary, schedule: r.schedule, scheduleLabel: SCHEDULE[r.schedule], employment: r.employment, employmentLabel: EMPLOYMENT[r.employment],
    skills: r.skills, experienceYears: r.experience_years, visibility: r.visibility, status: r.status, updatedAt: r.updated_at.toISOString() };
  if (withBody) Object.assign(o, open(r.body_enc));
  if (mine) { o.contact = r.contact_enc ? open(r.contact_enc) : { phone: '', email: '' }; o.blockReason = r.status === 'blocked' ? r.block_reason : ''; }
  return o;
};
export const myResume = async (me) => {
  const r = (await query('SELECT * FROM job_resumes WHERE owner_id = $1', [me])).rows[0];
  if (!r) return { ok: true, resume: null };
  const views = (await query(`SELECT c.name, c.verify_status, max(rv.day) AS day FROM job_resume_views rv JOIN job_companies c ON c.id = rv.company_id WHERE rv.resume_id = $1 AND rv.day > CURRENT_DATE - 30 GROUP BY c.name, c.verify_status ORDER BY max(rv.day) DESC LIMIT 20`, [r.id])).rows;
  return { ok: true, resume: resumeShape(r, true, true), views: views.map((v) => ({ company: v.name, verified: v.verify_status === 'verified', day: String(v.day).slice(0, 10) })) };
};
export const saveResume = async (me, body) => {
  const g = await guard(me); if (g) return g;
  const cur = (await query('SELECT * FROM job_resumes WHERE owner_id = $1', [me])).rows[0];
  if (cur?.status === 'blocked') return err('blocked');
  if (!cur && body?.consent !== true) return err('consent_required');
  const position = line(body?.position, 100); if (position.length < 3) return err('bad_field', { field: 'position' });
  const cat = body?.categoryId ? String(body.categoryId) : null; if (cat && !(await query('SELECT 1 FROM job_categories WHERE id = $1', [cat])).rows[0]) return err('bad_field', { field: 'categoryId' });
  const ds = body?.desiredSalary === '' || body?.desiredSalary == null ? null : Number(body.desiredSalary); if (ds != null && (!Number.isInteger(ds) || ds < 0 || ds > 100_000_000)) return err('bad_field', { field: 'desiredSalary' });
  const schedule = body?.schedule in SCHEDULE ? body.schedule : 'full_day'; const employment = body?.employment in EMPLOYMENT ? body.employment : 'full';
  const visibility = ['public', 'applied', 'hidden'].includes(body?.visibility) ? body.visibility : (cur?.visibility ?? 'applied');
  const skills = [...new Set(arr(body?.skills, 30).map((s) => line(s, 40)).filter(Boolean))];
  const years = Number.isInteger(Number(body?.experienceYears)) ? Math.max(0, Math.min(60, Number(body.experienceYears))) : 0;
  const b = resumeBody(body); const flat = JSON.stringify(b) + position;
  if (hasPersonalSecret(flat)) return err('personal_secret');   // паспорт, номера карт, пароли в резюме не нужны и опасны
  const cf = await checkContent('job_resume', me, [position, b.about]); if (cf.action === 'block') return blockedReply(cf);
  const contact = { phone: clean(body?.contact?.phone, 30), email: clean(body?.contact?.email, 120) };
  if (contact.phone && !/^[0-9+() -]{5,30}$/.test(contact.phone)) return err('bad_field', { field: 'phone' });
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return err('bad_field', { field: 'email' });
  if (cur) await query(`UPDATE job_resumes SET position=$2, category_id=$3, city=$4, desired_salary=$5, schedule=$6, employment=$7, skills=$8, experience_years=$9, body_enc=$10, contact_enc=$11, visibility=$12, updated_at=now() WHERE id=$1`,
    [cur.id, position, cat, line(body?.city, 80), ds, schedule, employment, skills, years, seal(b), seal(contact), visibility]);
  else await query(`INSERT INTO job_resumes (id, owner_id, position, category_id, city, desired_salary, schedule, employment, skills, experience_years, body_enc, contact_enc, visibility, consent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
    [newId('jrs'), me, position, cat, line(body?.city, 80), ds, schedule, employment, skills, years, seal(b), seal(contact), visibility]);
  return myResume(me);
};
export const setResumeVisibility = async (me, visibility) => {
  if (!['public', 'applied', 'hidden'].includes(visibility)) return err('bad_field', { field: 'visibility' });
  const r = await query('UPDATE job_resumes SET visibility = $2, updated_at = now() WHERE owner_id = $1 AND status = \'active\'', [me, visibility]);
  return r.rowCount ? myResume(me) : err('not_found');
};
/** Удаление резюме и отзыв согласия: данные стираются, в уже отправленных откликах остаётся только сопроводительное письмо. */
export const deleteResume = async (me) => {
  const r = await query('DELETE FROM job_resumes WHERE owner_id = $1', [me]);
  if (r.rowCount) await log(me, 'resume_delete', me);
  return { ok: true, deleted: r.rowCount > 0 };
};
export const exportMyData = async (me) => {
  const apps = (await query(`SELECT a.id, a.status, a.created_at, v.title, c.name FROM job_applications a JOIN job_vacancies v ON v.id = a.vacancy_id JOIN job_companies c ON c.id = v.company_id WHERE a.applicant_id = $1 ORDER BY a.created_at DESC`, [me])).rows;
  return { ok: true, exportedAt: new Date().toISOString(), resume: (await myResume(me)).resume, applications: apps.map((a) => ({ id: a.id, vacancy: a.title, company: a.name, status: a.status, at: a.created_at.toISOString() })) };
};

/* ─── Поиск резюме работодателем (только проверенные) ─── */
export const employerGate = async (me) => {
  const co = (await query('SELECT * FROM job_companies WHERE owner_id = $1', [me])).rows[0]; if (!co) return { error: 'no_company' };
  if (co.status === 'blocked') return { error: 'blocked' };
  if ((await settings()).resumesNeedVerified && co.verify_status !== 'verified') return { error: 'verification_required' };
  return { co };
};
const firstName = (n) => String(n ?? '').trim().split(/\s+/)[0] || 'Кандидат';
export const searchResumes = async (me, q = {}) => {
  const gate = await employerGate(me); if (gate.error) return err(gate.error);
  const vals = []; let w = `r.visibility = 'public' AND r.status = 'active' AND NOT EXISTS (SELECT 1 FROM job_profile_blocks b WHERE b.profile_id = r.owner_id)`;
  if (q.q) { vals.push(SQLIKE(q.q)); w += ` AND (r.position ILIKE $${vals.length} OR EXISTS (SELECT 1 FROM unnest(r.skills) s WHERE s ILIKE $${vals.length}))`; }
  if (q.category) { vals.push(String(q.category)); w += ` AND r.category_id = $${vals.length}`; }
  if (q.city) { vals.push(SQLIKE(q.city)); w += ` AND r.city ILIKE $${vals.length}`; }
  const { rows } = await query(`SELECT r.*, p.name FROM job_resumes r JOIN profiles p ON p.id = r.owner_id WHERE ${w} AND r.owner_id <> '${String(me).replace(/'/g, '')}' ORDER BY r.updated_at DESC LIMIT 40`, vals);
  return { ok: true, resumes: rows.map((r) => ({ ...resumeShape(r, false), name: firstName(r.name) })) };
};
export const openResume = async (me, id) => {
  const gate = await employerGate(me); if (gate.error) return err(gate.error);
  const r = (await query(`SELECT r.*, p.name FROM job_resumes r JOIN profiles p ON p.id = r.owner_id WHERE r.id = $1 AND r.visibility = 'public' AND r.status = 'active' AND r.owner_id <> $2
    AND NOT EXISTS (SELECT 1 FROM job_profile_blocks b WHERE b.profile_id = r.owner_id)`, [String(id ?? ''), me])).rows[0];
  if (!r) return err('not_found');
  await query('INSERT INTO job_resume_views (resume_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, gate.co.id]);
  return { ok: true, resume: { ...resumeShape(r, true), name: firstName(r.name) }, contactsHidden: true };
};
/** Приглашение кандидата из поиска резюме на свою опубликованную вакансию: создаёт отклик «Приглашение». */
export const inviteFromResume = async (me, resumeId, vacancyId, text) => {
  const gate = await employerGate(me); if (gate.error) return err(gate.error);
  const g = await guard(me); if (g) return g;
  if ((await query(`SELECT count(*)::int AS n FROM job_app_events e JOIN job_applications a ON a.id = e.application_id JOIN job_vacancies v ON v.id = a.vacancy_id WHERE v.company_id = $1 AND a.initiator = 'employer' AND e.at > now() - interval '24 hours' AND e.status = 'invited'`, [gate.co.id])).rows[0].n >= 20) return err('too_many_requests');
  const r = (await query(`SELECT owner_id FROM job_resumes WHERE id = $1 AND visibility = 'public' AND status = 'active'`, [String(resumeId ?? '')])).rows[0]; if (!r) return err('not_found');
  const v = (await query(`SELECT v.id, v.title FROM job_vacancies v WHERE v.id = $1 AND v.company_id = $2 AND v.status = 'published'`, [String(vacancyId ?? ''), gate.co.id])).rows[0]; if (!v) return err('vacancy_not_found');
  const msg = clean(text, 500); if (msg && scanMessage(msg, { fromEmployer: true, contactsOpen: false })) return err('message_blocked');
  const id = newId('jap');
  const ins = await query(`INSERT INTO job_applications (id, vacancy_id, applicant_id, resume_id, initiator, status, cover_enc) VALUES ($1,$2,$3,(SELECT id FROM job_resumes WHERE owner_id = $3),'employer','invited',$4) ON CONFLICT (vacancy_id, applicant_id) DO NOTHING`, [id, v.id, r.owner_id, msg ? seal({ text: msg }) : null]);
  if (!ins.rowCount) return err('already_exists');
  await query(`INSERT INTO job_app_events (application_id, status, note, actor) VALUES ($1,'invited',$2,$3)`, [id, msg, me]);
  void note(r.owner_id, `${gate.co.name}: приглашение на вакансию`, v.title, `jobapp:${id}:invited`);
  return { ok: true, id };
};
export const _internal = { seal, open, resumeShape, SQLIKE, VISIBLE, firstName };
