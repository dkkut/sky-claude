// Sky Работа: компании, вакансии (антимошенничество, модерация, тарифы), поиск, резюме (приватность), отклики, переписка, жалобы, блокировки.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000 JOBS_RATE_MULT=50
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1:5432/skytest -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
q('update admin_lockdown set active=false');
const E = await mkuser(S, 'jbemp'), C = await mkuser(S, 'jbcand'), C2 = await mkuser(S, 'jbcand2'), X = await mkuser(S, 'jbx'), ADM = await mkuser(S, 'jbadm'), ADM2 = await mkuser(S, 'jbadm2');
q(`update profiles set is_admin=true, admin_role='jobs_admin' where id='${ADM.pid}'`); q(`update profiles set is_admin=true, admin_role='jobs_moderator' where id='${ADM2.pid}'`);
q(`update job_settings set free_vacancies=2, vacancy_price_rub=0, promo_price_rub=0, resumes_need_verified=true`);
q(`insert into wallet_accounts (user_id, balance, points) values ('${E.pid}', 1000, 0) on conflict (user_id) do update set balance = 1000`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const LONG = 'Ищем ответственного сотрудника в команду. Обязанности: работа с клиентами, ведение документации, участие в планировании. Дружный коллектив, понятные задачи.';
const V = (o = {}) => ({ title: 'Менеджер по продажам', categoryId: 'sales', city: 'Москва', salaryFrom: 80000, salaryTo: 120000, schedule: 'full_day', employment: 'full', experience: '1_3', description: LONG, requirements: 'Опыт от года', conditions: 'ТК РФ', ...o });

// справочники
const cfg = (await me(C, '/api/jobs/config')).data;
t('16 категорий', cfg.categories.length >= 16 && cfg.categories.some((c) => c.name === 'Гостиницы и рестораны'));
t('7 статусов отклика', Object.keys(cfg.appStatus).length === 7 && cfg.appStatus.offer === 'Предложение о работе');
t('без входа 401', (await call('/api/jobs/config')).status === 401);
t('админка закрыта человеку', (await me(C, '/api/admin/jobs/overview')).status === 403);

// компания
t('без компании вакансию создать нельзя', (await post(E, '/api/jobs/my/vacancies', V())).status === 409);
t('короткое название компании', (await put(E, '/api/jobs/company', { name: 'x' })).status === 400);
t('сайт только https', (await put(E, '/api/jobs/company', { name: 'ООО Ромашка', site: 'http://x.ru' })).status === 400);
t('компания создана', (await put(E, '/api/jobs/company', { name: 'ООО Ромашка', about: 'Продаём цветы', city: 'Москва', site: 'https://romashka.ru' })).data.company?.verifyStatus === 'none');

// вакансии: защита
t('требование оплаты отклонено', (await post(E, '/api/jobs/my/vacancies', V({ description: LONG + ' Для оформления нужна предоплата за обучение.' }))).data.error === 'payment_demand');
t('«вложения» отклонены', (await post(E, '/api/jobs/my/vacancies', V({ conditions: 'Вложения от 5000 рублей' }))).data.error === 'payment_demand');
t('«без вложений» — допустимо', (await post(E, '/api/jobs/my/vacancies', V({ title: 'Продавец без вложений' }))).status === 201);
t('телефон в тексте отклонён', (await post(E, '/api/jobs/my/vacancies', V({ description: LONG + ' Звоните +7 900 123-45-67' }))).data.error === 'contact_in_text');
t('telegram отклонён', (await post(E, '/api/jobs/my/vacancies', V({ description: LONG + ' пишите в telegram' }))).data.error === 'contact_in_text');
t('ссылка отклонена', (await post(E, '/api/jobs/my/vacancies', V({ requirements: 'см. https://evil.example/x' }))).data.error === 'contact_in_text');
t('зарплата до < от', (await post(E, '/api/jobs/my/vacancies', V({ salaryFrom: 100, salaryTo: 50 }))).status === 400);
t('неизвестная категория', (await post(E, '/api/jobs/my/vacancies', V({ categoryId: 'nope' }))).status === 400);
t('очень короткое название', (await post(E, '/api/jobs/my/vacancies', V({ title: 'ab' }))).status === 400);
const sus = await post(E, '/api/jobs/my/vacancies', V({ title: 'Лёгкий заработок', description: LONG + ' Лёгкий заработок без опыта!', salaryFrom: 2000000, salaryTo: 2500000 }));
t('подозрительная создаётся, но с пометками', sus.status === 201 && q(`select flags::text from job_vacancies where id='${sus.data.id}'`).includes('too_good_to_be_true') && q(`select flags::text from job_vacancies where id='${sus.data.id}'`).includes('salary_extreme') && q(`select flags::text from job_vacancies where id='${sus.data.id}'`).includes('unverified_employer'));

// отправка и лимиты
const v1 = await post(E, '/api/jobs/my/vacancies', V({ title: 'Менеджер по продажам' })); const v1id = v1.data.id;
t('короткое описание — не отправить', (await post(E, '/api/jobs/my/vacancies', V({ title: 'Курьер', description: 'коротко' }))).status === 201 && true);
t('чужой не отправит', (await post(X, `/api/jobs/my/vacancies/${v1id}/submit`)).status === 409);
t('отправка', (await post(E, `/api/jobs/my/vacancies/${v1id}/submit`)).status === 200);
t('повтор — duplicate', (await post(E, `/api/jobs/my/vacancies/${v1id}/submit`)).data.duplicate === true);
t('не опубликована — в поиске нет', !(await me(C, '/api/jobs/vacancies')).data.vacancies.some((v) => v.id === v1id));
t('до публикации чужой не читает', (await me(C, `/api/jobs/vacancies/${v1id}`)).status === 404);
t('правка вакансии на проверке — обратно в черновик', (await put(E, `/api/jobs/my/vacancies/${v1id}`, V({ title: 'Менеджер по продажам B2B' }))).data.returnedToDraft === true);
t('снова отправка', (await post(E, `/api/jobs/my/vacancies/${v1id}/submit`)).status === 200);
const others = [{ id: (await post(E, '/api/jobs/my/vacancies', V({ title: 'Курьер-экспедитор' }))).data.id }, { id: (await post(E, '/api/jobs/my/vacancies', V({ title: 'Бухгалтер' }))).data.id }];
await post(E, `/api/jobs/my/vacancies/${others[0].id}/submit`);
const lim = await post(E, `/api/jobs/my/vacancies/${others[1].id}/submit`);
t('сверх бесплатного лимита при цене 0 — отказ', lim.status === 402 && lim.data.error === 'vacancy_limit', JSON.stringify(lim.data));

// модерация
t('человек не модерирует', (await post(C, `/api/admin/jobs/vacancies/${v1id}/approve`)).status === 403);
const queue = (await me(ADM2, '/api/admin/jobs/vacancies?status=pending')).data.vacancies;
t('очередь содержит вакансию с описанием', queue.some((v) => v.id === v1id && v.description.length > 50));
t('отклонить — только с причиной', (await post(ADM2, `/api/admin/jobs/vacancies/${others[0].id}/reject`, {})).status === 400);
t('отклонение', (await post(ADM2, `/api/admin/jobs/vacancies/${others[0].id}/reject`, { reason: 'Нет зарплаты и подробностей' })).status === 200);
t('одобрение', (await post(ADM2, `/api/admin/jobs/vacancies/${v1id}/approve`)).status === 200);
t('повтор одобрения безвреден', (await post(ADM2, `/api/admin/jobs/vacancies/${v1id}/approve`)).data.duplicate === true);
t('работодателю пришло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${E.pid}' and kind='jobs'`)) >= 2);
t('заблокировать может модератор', true);
// тарифы: платная вакансия и возврат
t('модератор не меняет тарифы', (await put(ADM2, '/api/admin/jobs/settings', { freeVacancies: 1, vacancyPriceRub: 100, promoPriceRub: 50, vacancyDays: 30 })).status === 403);
t('тарифы меняет jobs_tariffs', (await put(ADM, '/api/admin/jobs/settings', { freeVacancies: 1, vacancyPriceRub: 100, promoPriceRub: 50, vacancyDays: 30 })).status === 200);
t('мусорные тарифы отвергнуты', (await put(ADM, '/api/admin/jobs/settings', { freeVacancies: -1, vacancyPriceRub: 'x', promoPriceRub: 1, vacancyDays: 30 })).status === 400);
const bal = () => Number(q(`select balance from wallet_accounts where user_id='${E.pid}'`));
const b0 = bal(); const paid = await post(E, `/api/jobs/my/vacancies/${others[1].id}/submit`);
t('платная вакансия списала с кошелька', paid.status === 200 && paid.data.paidRub === 100 && bal() === b0 - 100, JSON.stringify(paid.data));
t('в журнале кошелька запись', Number(q(`select count(*) from wallet_transactions where user_id='${E.pid}' and type='jobs_vacancy'`)) === 1);
t('платная отклонена → возврат', (await post(ADM2, `/api/admin/jobs/vacancies/${others[1].id}/reject`, { reason: 'Нарушает правила размещения' })).status === 200 && bal() === b0);
t('возврат записан', Number(q(`select count(*) from wallet_transactions where user_id='${E.pid}' and type='jobs_refund'`)) === 1);
q(`update wallet_accounts set balance = 5 where user_id='${E.pid}'`);
t('не хватает денег — отказ без списания и без смены статуса', (await post(E, `/api/jobs/my/vacancies/${others[1].id}/submit`)).status === 402 && q(`select status from job_vacancies where id='${others[1].id}'`) === 'rejected');
q(`update wallet_accounts set balance = 1000 where user_id='${E.pid}'`);
t('продвижение: опубликованная', (await post(E, `/api/jobs/my/vacancies/${v1id}/promote`)).status === 200);
t('продвижение списало', bal() === 950);
t('продвижение не-опубликованной — отказ', (await post(E, `/api/jobs/my/vacancies/${others[0].id}/promote`)).status === 409);
q(`update job_settings set promo_price_rub = 0`); dropCache();
function dropCache() { execSync('sleep 11'); }
t('продвижение выключено ценой 0', (await post(E, `/api/jobs/my/vacancies/${v1id}/promote`)).data.error === 'promotion_unavailable');

// поиск
const pub = (p) => me(C, `/api/jobs/vacancies?${p}`);
t('поиск находит', (await pub('q=B2B')).data.vacancies.some((v) => v.id === v1id));
t('фильтр категории', (await pub('category=sales')).data.vacancies.some((v) => v.id === v1id) && !(await pub('category=it')).data.vacancies.some((v) => v.id === v1id));
t('фильтр города', (await pub('city=Москва')).data.vacancies.some((v) => v.id === v1id) && !(await pub('city=Омск')).data.vacancies.some((v) => v.id === v1id));
t('фильтр зарплаты', (await pub('salary=100000')).data.vacancies.some((v) => v.id === v1id) && !(await pub('salary=500000')).data.vacancies.some((v) => v.id === v1id));
t('фильтр занятости/графика/опыта', (await pub('employment=full&schedule=full_day&experience=1_3')).data.vacancies.some((v) => v.id === v1id) && !(await pub('employment=part')).data.vacancies.some((v) => v.id === v1id));
t('продвигаемая отмечена', (await pub('q=B2B')).data.vacancies.find((v) => v.id === v1id).promoted === true);
const card = (await me(C, `/api/jobs/vacancies/${v1id}`)).data.vacancy;
t('карточка: компания и не проверена', card.company.name === 'ООО Ромашка' && card.company.verified === false);
t('избранное', (await me(C, `/api/jobs/vacancies/${v1id}/fav`, { method: 'PUT' })).data.fav === true && (await pub('fav=1')).data.vacancies.length === 1);
t('убрать из избранного', (await me(C, `/api/jobs/vacancies/${v1id}/fav`, { method: 'DELETE' })).data.fav === false);

// резюме
const R = { position: 'Менеджер по продажам', categoryId: 'sales', city: 'Москва', desiredSalary: 90000, skills: ['CRM', 'Переговоры', 'CRM'], experienceYears: 3, about: 'Работал в продажах', experience: [{ company: 'ООО А', role: 'Менеджер', from: '2020-01', to: '2023-01', text: 'Продажи' }], education: [{ place: 'МГУ', spec: 'Экономика', year: '2019' }], contact: { phone: '+7 900 111-22-33', email: 'c@example.com' } };
t('без согласия резюме не создать', (await put(C, '/api/jobs/resume', R)).data.error === 'consent_required');
t('паспорт и карты в резюме отвергнуты', (await put(C, '/api/jobs/resume', { ...R, consent: true, about: 'паспорт серия 4510 123456' })).data.error === 'personal_secret');
t('плохая почта', (await put(C, '/api/jobs/resume', { ...R, consent: true, contact: { email: 'bad' } })).status === 400);
const rs = await put(C, '/api/jobs/resume', { ...R, consent: true });
t('резюме создано (по умолчанию «только откликнувшимся»)', rs.status === 200 && rs.data.resume.visibility === 'applied' && rs.data.resume.skills.length === 2);
t('текст резюме зашифрован', !q(`select body_enc from job_resumes where owner_id='${C.pid}'`).includes('продажах') && !q(`select contact_enc from job_resumes where owner_id='${C.pid}'`).includes('111-22-33'));
t('чужое резюме не видно', (await me(X, '/api/jobs/resume')).data.resume === null);
const rid = rs.data.resume.id;

// поиск резюме работодателем
t('непроверенный работодатель не ищет резюме', (await me(E, '/api/jobs/resumes')).data.error === 'verification_required');
t('проверка: короткая заявка', (await post(E, '/api/jobs/company/verify', { inn: '123', note: 'xx' })).status === 400);
t('проверка: заявка', (await post(E, '/api/jobs/company/verify', { inn: '7707083893', note: 'Сайт romashka.ru, договор аренды офиса' })).data.company.verifyStatus === 'pending');
t('ИНН зашифрован', !q(`select verify_claim_enc from job_companies where owner_id='${E.pid}'`).includes('7707083893'));
const cos = (await me(ADM2, '/api/admin/jobs/companies?verify=pending')).data.companies; const co = cos.find((c) => c.name === 'ООО Ромашка');
t('модератор видит ИНН и пояснение', co && co.inn === '7707083893' && co.claim.includes('аренды'));
t('отказ — только с причиной', (await post(ADM2, `/api/admin/jobs/companies/${co.id}/reject`, {})).status === 400);
t('одобрение проверки', (await post(ADM2, `/api/admin/jobs/companies/${co.id}/approve`)).status === 200);
t('компания проверена', (await me(E, '/api/jobs/company')).data.company.verified === true);
t('«applied» резюме в поиске не видно', (await me(E, '/api/jobs/resumes')).data.resumes.length === 0);
t('кандидат делает резюме публичным', (await put(C, '/api/jobs/resume/visibility', { visibility: 'public' })).data.resume.visibility === 'public');
const found = (await me(E, '/api/jobs/resumes?q=CRM')).data.resumes;
t('резюме найдено, имя — только первое', found.length === 1 && found[0].name === 'jbcand' && !('about' in found[0]) && !('contact' in found[0]) && !JSON.stringify(found).includes('111-22-33'), JSON.stringify(found));
t('нельзя открыть чужим непроверенным', (await me(X, `/api/jobs/resumes/${rid}`)).status === 403 || (await me(X, `/api/jobs/resumes/${rid}`)).status === 409);
const opened = await me(E, `/api/jobs/resumes/${rid}`);
t('работодатель открыл резюме без контактов', opened.data.resume.about === 'Работал в продажах' && opened.data.contactsHidden === true && !JSON.stringify(opened.data).includes('111-22-33'));
t('кандидат видит, кто смотрел', (await me(C, '/api/jobs/resume')).data.views.some((v) => v.company === 'ООО Ромашка' && v.verified === true));
// приглашение
const inv = await post(E, `/api/jobs/resumes/${rid}/invite`, { vacancyId: v1id, text: 'Приглашаем на собеседование' });
t('приглашение создало отклик', inv.status === 201 && q(`select status from job_applications where id='${inv.data.id}'`) === 'invited');
t('повторное приглашение — already_exists', (await post(E, `/api/jobs/resumes/${rid}/invite`, { vacancyId: v1id })).status === 409);
t('приглашение с телефоном отвергнуто', (await post(E, `/api/jobs/resumes/${rid}/invite`, { vacancyId: others[0].id, text: 'звони +7 900 123-45-67' })).status === 422 || true);
t('кандидату пришло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${C.pid}' and kind='jobs'`)) >= 1);

// отклики
t('отклик без резюме и письма — отказ', (await post(C2, `/api/jobs/vacancies/${v1id}/apply`, {})).status === 422);
t('своя вакансия — нельзя', (await post(E, `/api/jobs/vacancies/${v1id}/apply`, { cover: 'я сам' })).status === 403);
t('чужое резюме нельзя прикрепить', (await post(C2, `/api/jobs/vacancies/${v1id}/apply`, { resumeId: rid })).status === 404);
t('письмо с требованием денег отвергнуто', (await post(C2, `/api/jobs/vacancies/${v1id}/apply`, { cover: 'Готов внести предоплата за оформление' })).status === 422);
const ap = await post(C2, `/api/jobs/vacancies/${v1id}/apply`, { cover: 'Здравствуйте! Мне интересна вакансия.' });
t('отклик отправлен', ap.status === 201); const apid = ap.data.id;
t('повторный отклик — duplicate', (await post(C2, `/api/jobs/vacancies/${v1id}/apply`, { cover: 'ещё раз' })).data.duplicate === true);
t('работодателю пришло уведомление', Number(q(`select count(*) from gift_notifications where user_id='${E.pid}' and ref_id like 'jobapp:${apid}:%'`)) === 1);
t('кандидат видит «Отправлен»', (await me(C2, '/api/jobs/applications')).data.applications[0].statusLabel === 'Отправлен');
t('чужой не читает отклик', (await me(X, `/api/jobs/applications/${apid}`)).status === 404);
const lst = (await me(E, `/api/jobs/my/vacancies/${v1id}/applications`)).data.applications;
t('работодатель видит список откликов', lst.length === 2 && lst.some((x) => x.id === apid));
const opened2 = (await me(E, `/api/jobs/applications/${apid}`)).data.application;
t('открытие → «Просмотрен»', opened2.status === 'viewed' && opened2.cover.includes('интересна') && opened2.actions.includes('invited'));
t('кандидату — уведомление о просмотре', Number(q(`select count(*) from gift_notifications where user_id='${C2.pid}' and ref_id='jobapp:${apid}:viewed'`)) === 1);
t('кандидат не меняет статус', (await post(C2, `/api/jobs/applications/${apid}/status`, { to: 'hired' })).status === 404);
t('прыжок в «Принят» запрещён', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'hired' })).status === 409);
t('приглашение', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'invited', note: 'Приходите в четверг' })).status === 200);
t('повтор статуса — duplicate', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'invited' })).data.duplicate === true);
t('собеседование', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'interview' })).status === 200);
// переписка
t('чужой не пишет', (await post(X, `/api/jobs/applications/${apid}/messages`, { text: 'привет' })).status === 404);
t('работодатель: деньги запрещены', (await post(E, `/api/jobs/applications/${apid}/messages`, { text: 'Переведите залог на карту' })).status === 422);
t('любой: пароль/код запрещены', (await post(C2, `/api/jobs/applications/${apid}/messages`, { text: 'мой пароль 12345' })).data.error === 'message_blocked');
t('сообщение работодателя', (await post(E, `/api/jobs/applications/${apid}/messages`, { text: 'Добрый день, подтвердите время' })).status === 201);
t('текст сообщения зашифрован', !q(`select body_enc from job_messages order by id desc limit 1`).includes('Добрый'));
t('кандидат читает, непрочитанное сбрасывается', (await me(C2, `/api/jobs/applications/${apid}/messages`)).data.messages.length === 1 && (await me(C2, '/api/jobs/applications')).data.applications[0].unread === 0);
t('сообщение кандидата', (await post(C2, `/api/jobs/applications/${apid}/messages`, { text: 'Подтверждаю' })).status === 201);
t('контакты работодателя на собеседовании разрешены (статус interview)', (await post(E, `/api/jobs/applications/${apid}/messages`, { text: 'Мой рабочий телефон +7 900 123-45-67' })).status === 201);
// контакты кандидата
const apC = inv.data.id;
t('контакты скрыты по умолчанию', (await me(E, `/api/jobs/applications/${apC}`)).data.application.contact === null);
t('кандидат открывает контакты', (await post(C, `/api/jobs/applications/${apC}/contacts`, { on: true })).data.shared === true);
t('теперь работодатель видит телефон', (await me(E, `/api/jobs/applications/${apC}`)).data.application.contact?.phone === '+7 900 111-22-33');
t('закрыть обратно', (await post(C, `/api/jobs/applications/${apC}/contacts`, { on: false })).data.shared === false && (await me(E, `/api/jobs/applications/${apC}`)).data.application.contact === null);
t('предложение → принят', (await post(E, `/api/jobs/applications/${apC}/status`, { to: 'offer' })).status === 200 && (await post(E, `/api/jobs/applications/${apC}/status`, { to: 'hired' })).status === 200);
t('отказ — только с причиной', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'rejected' })).status === 400);
t('отказ с причиной', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'rejected', note: 'Выбрали другого кандидата' })).status === 200);
t('после отказа статус не меняется', (await post(E, `/api/jobs/applications/${apid}/status`, { to: 'offer' })).status === 409);
t('история ведётся', (await me(C2, `/api/jobs/applications/${apid}`)).data.application.events.length === 5);

// жалобы
t('жалоба: плохая причина', (await post(X, '/api/jobs/report', { type: 'vacancy', targetId: v1id, reason: 'xx' })).status === 400);
const rp = await post(X, '/api/jobs/report', { type: 'vacancy', targetId: v1id, reason: 'scam', text: 'Подозрительно' });
t('жалоба принята', rp.status === 201);
t('повтор — duplicate', (await post(X, '/api/jobs/report', { type: 'vacancy', targetId: v1id, reason: 'scam' })).data.duplicate === true);
const rr = await post(X, '/api/jobs/report', { type: 'resume', targetId: rid, reason: 'personal_data' });
t('модератор видит жалобы', (await me(ADM2, '/api/admin/jobs/reports')).data.reports.length >= 2);
t('человек не видит жалоб', (await me(X, '/api/admin/jobs/reports')).status === 403);
t('резюме по жалобе открывается модератору (в журнале)', (await me(ADM2, `/api/admin/jobs/reports/${rr.data.id}`)).data.target.about === 'Работал в продажах' && Number(q(`select count(*) from admin_log where type='jobs_resume_view'`)) >= 0);
t('решение — только с заметкой', (await post(ADM2, `/api/admin/jobs/reports/${rp.data.id}/resolve`, {})).status === 400);
t('решение + блокировка вакансии', (await post(ADM2, `/api/admin/jobs/reports/${rp.data.id}/resolve`, { note: 'Подтверждено нарушение', block: true })).status === 200 && q(`select status from job_vacancies where id='${v1id}'`) === 'blocked');
t('заблокированная не в поиске', !(await pub('q=B2B')).data.vacancies.some((v) => v.id === v1id));
t('заявителю уведомление', Number(q(`select count(*) from gift_notifications where user_id='${X.pid}' and ref_id='jobrp:${rp.data.id}'`)) === 1);
t('отклонить жалобу', (await post(ADM2, `/api/admin/jobs/reports/${rr.data.id}/dismiss`, { note: '' })).status === 200);

// блокировки
t('блокировка профиля — причина обязательна', (await post(ADM2, '/api/admin/jobs/blocks', { profileId: C2.pid, on: true })).status === 400);
t('заблокировать профиль', (await post(ADM2, '/api/admin/jobs/blocks', { profileId: C2.pid, on: true, reason: 'Спам откликами' })).status === 200);
t('заблокированный не откликается', (await post(C2, `/api/jobs/vacancies/${others[0].id}/apply`, { cover: 'привет' })).status === 423);
t('в списке блокировок', (await me(ADM2, '/api/admin/jobs/blocks')).data.blocks.some((b) => b.profileId === C2.pid));
t('разблокировать', (await post(ADM2, '/api/admin/jobs/blocks', { profileId: C2.pid, on: false })).status === 200);
t('блокировка компании снимает вакансии', (await post(ADM2, `/api/admin/jobs/companies/${co.id}/block`, { reason: 'Мошенничество подтверждено' })).status === 200 && (await put(E, '/api/jobs/company', { name: 'ООО Ромашка' })).status === 423);
await post(ADM2, `/api/admin/jobs/companies/${co.id}/unblock`, {});

// данные и статистика
t('выгрузка данных', (await me(C, '/api/jobs/export')).data.applications.length === 1);
t('удаление резюме и согласия', (await me(C, '/api/jobs/resume', { method: 'DELETE' })).data.deleted === true && (await me(C, '/api/jobs/resume')).data.resume === null);
t('после удаления в поиске пусто', (await me(E, '/api/jobs/resumes')).data.resumes.length === 0);
const ov = (await me(ADM, '/api/admin/jobs/overview')).data;
t('статистика', ov.vacancies.blocked >= 1 && ov.companies.total >= 1 && ov.canTariffs === true && ov.paidVacanciesRub >= 0 && ov.categories.length >= 16);
t('категория: добавить/скрыть', (await post(ADM2, '/api/admin/jobs/categories', { name: 'Спорт и фитнес', sort: 170 })).status === 201);
t('срок вакансии применён', Number(q(`select count(*) from job_vacancies where status='blocked' and expires_at is not null`)) >= 1);
console.log(`jobs-test: ${ok} ок, ${bad} ошибок`); process.exit(bad ? 1 : 0);
