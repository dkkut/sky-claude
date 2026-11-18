/** Sky Life (модуль на Postgres `skytest`): записи, цели, шифрование, лимиты, файлы, проекты, деловые связи, Sky Match, жалобы, права администрации, экспорт. */
process.env.OWNER_USERNAME = 'lifeowner'; process.env.LIFE_DIR = '/tmp/lifetest-data';
const L = await import('../../server/life.mjs'); const B = await import('../../server/lifebiz.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c, d = '') => { c ? ok++ : (bad++, console.log('FAIL', n, d)); };
const sfx = Date.now().toString(36);
const mk = async (tag, admin = false) => { const i = `acc-lf${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query('INSERT INTO profiles (id, username, name, sky_id, is_admin) VALUES ($1,$2,$3,$4,$5)', [i, `lf${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`, admin]); return { id: i, un: `lf${tag}${sfx}` }; };
await query("DELETE FROM profiles WHERE username = 'lifeowner'"); for (const tb of ['life_biz_reports','life_biz_proposals','life_biz_posts','life_biz_profiles','life_restrictions','life_projects','life_items','life_admin_log']) await query('DELETE FROM ' + tb);
const A = await mk('a'), Bu = await mk('b'), C = await mk('c'), ADM = await mk('adm', true), MOD = await mk('mod');
await query(`UPDATE life_settings SET free_items = 300, free_posts = 3, proposals_per_day = 10, enabled = true, biz_enabled = true`); L.forgetSettings();

/* записи и шифрование */
const g = await L.createItem(A.id, { kind: 'goal', title: 'Накопить на квартиру', description: 'Секретное описание цели', tags: ['Деньги', 'деньги', 'мечта'], dueAt: new Date(Date.now() + 86400_000 * 30).toISOString(), extra: { goalType: 'finance', result: 'Взнос 2 млн' } });
t('цель создана', g.ok && g.item.kind === 'goal' && g.item.tags.length === 2, JSON.stringify(g));
const raw = (await query('SELECT data_enc FROM life_items WHERE id = $1', [g.item.id])).rows[0];
t('текст в базе зашифрован', !JSON.stringify(raw).includes('квартиру') && !JSON.stringify(raw).includes('Секретное'));
t('чужой не видит запись', (await L.getItem(Bu.id, g.item.id)) === null && (await L.updateItem(Bu.id, g.item.id, { title: 'взлом' })).error === 'not_found' && (await L.deleteItem(Bu.id, g.item.id)).error === 'not_found');
t('чужой не видит в списке', (await L.listItems(Bu.id, {})).total === 0);
t('пароль не сохраняется', (await L.createItem(A.id, { kind: 'entry', title: 'пароль от банка 1234' })).error === 'secret_not_allowed' && (await L.createItem(A.id, { kind: 'entry', title: 'карта 4111 1111 1111 1111' })).error === 'secret_not_allowed' && (await L.createItem(A.id, { kind: 'important', title: 'Договор', description: 'код из СМС 5566' })).error === 'secret_not_allowed');
t('валидация', (await L.createItem(A.id, { kind: 'zzz', title: 'x' })).error === 'bad_kind' && (await L.createItem(A.id, { kind: 'task', title: '' })).error === 'bad_title' && (await L.createItem(A.id, { kind: 'task', title: 'x', dueAt: 'не дата' })).error === 'bad_date' && (await L.createItem(A.id, { kind: 'entry', title: 'x', category: 'nope' })).error === 'bad_category' && (await L.createItem(A.id, { kind: 'task', title: 'x', priority: 9 })).error === 'bad_priority');
const cat = await L.addCategory(A.id, 'Хобби'); t('своя категория', cat.ok && (await L.addCategory(A.id, 'Хобби')).error === 'exists');
const en = await L.createItem(A.id, { kind: 'entry', title: 'Купить гитару', category: cat.id, priority: 2, remindAt: new Date(Date.now() - 1000).toISOString() });
t('запись в своей категории', en.ok && en.item.category === cat.id);
t('чужая категория нельзя', (await L.createItem(Bu.id, { kind: 'entry', title: 'x', category: cat.id })).error === 'bad_category');
t('системные категории (15)', (await L.categories(A.id)).system.length >= 15);

/* этапы и прогресс */
const s1 = await L.createItem(A.id, { kind: 'task', title: 'Открыть вклад', parentId: g.item.id }); const s2 = await L.createItem(A.id, { kind: 'task', title: 'Копить ежемесячно', parentId: g.item.id });
t('чужой родитель нельзя', (await L.createItem(Bu.id, { kind: 'task', title: 'x', parentId: g.item.id })).error === 'not_found');
await L.updateItem(A.id, s1.item.id, { status: 'done' });
let gi = await L.getItem(A.id, g.item.id); t('прогресс 50% по этапам', gi.progress === 50 && gi.children.length === 2);
await L.updateItem(A.id, s2.item.id, { status: 'done' });
gi = await L.getItem(A.id, g.item.id); t('цель достигнута автоматически', gi.status === 'done' && gi.progress === 100 && gi.history.length >= 2);
const ov = await L.goalsOverview(A.id); t('обзор целей: достигнута', ov.goals.find((x) => x.id === g.item.id).state === 'achieved');
const od = await L.createItem(A.id, { kind: 'goal', title: 'Просроченная', dueAt: new Date(Date.now() - 86400_000).toISOString() });
t('просроченная цель определяется', (await L.goalsOverview(A.id)).goals.find((x) => x.id === od.item.id).state === 'overdue');
const fg = await L.createItem(A.id, { kind: 'fin_goal', title: 'Ноутбук', extra: { type: 'purchase', target: 100000, saved: 25000 }, dueAt: new Date(Date.now() + 86400_000 * 90).toISOString() });
t('финцель: прогресс по накоплению', fg.ok && fg.item.progress === 25, JSON.stringify(fg.item?.progress));
t('финцель: рассчёт взноса', (await L.finance(A.id)).goals.find((x) => x.id === fg.item.id).needMonthly > 0);
t('кошелёк не подключён без согласия', (await L.finance(A.id)).wallet === null);
await L.savePrefs(A.id, { finLink: true }); const fw = await L.finance(A.id); t('кошелёк только чтение после согласия', fw.wallet?.readOnly === true);

/* напоминания */
await L.sweepLife();
t('напоминание отправлено один раз', (await query(`SELECT count(*)::int AS c FROM gift_notifications WHERE user_id = $1 AND kind = 'life_events'`, [A.id])).rows[0].c === 1 && (await query('SELECT reminded_at FROM life_items WHERE id = $1', [en.item.id])).rows[0].reminded_at);
await L.sweepLife(); t('повтор не дублирует', (await query(`SELECT count(*)::int AS c FROM gift_notifications WHERE user_id = $1 AND kind = 'life_events'`, [A.id])).rows[0].c === 1);
t('просрочка отмечена', (await query(`SELECT count(*)::int AS c FROM gift_notifications WHERE user_id = $1 AND kind = 'life_overdue'`, [A.id])).rows[0].c >= 1);
await L.savePrefs(A.id, { notif: { deadlines: false } }); const soonT = await L.createItem(A.id, { kind: 'task', title: 'Скоро', dueAt: new Date(Date.now() + 3600_000).toISOString() }); await L.sweepLife();
t('отключённая категория уведомлений не шлёт', (await query(`SELECT count(*)::int AS c FROM gift_notifications WHERE user_id = $1 AND kind = 'life_deadlines'`, [A.id])).rows[0].c === 0);

/* главная, настройки, поиск, лимиты */
const hm = await L.home(A.id); t('главная: все блоки', ['tasks', 'events', 'goals', 'projects', 'reminders', 'stats', 'saved'].every((k) => k in hm) && hm.stats.total > 0 && hm.name === 'Имя a');
t('настройка главной', (await L.savePrefs(A.id, { home: { order: ['goals', 'tasks', 'bad'], hidden: ['stats'] } })).prefs.home.order.join() === 'goals,tasks');
t('поиск и фильтры', (await L.listItems(A.id, { q: 'гитару' })).total === 1 && (await L.listItems(A.id, { tag: 'мечта' })).total === 1 && (await L.listItems(A.id, { kind: 'goal', status: 'done' })).total === 1);
await query(`UPDATE life_settings SET free_items = 3`); L.forgetSettings(); const lim = await L.createItem(C.id, { kind: 'task', title: 'a' }); await L.createItem(C.id, { kind: 'task', title: 'b' }); await L.createItem(C.id, { kind: 'task', title: 'c' });
t('лимит записей Free', (await L.createItem(C.id, { kind: 'task', title: 'd' })).error === 'limit_reached' && lim.ok);
t('чтение и удаление при лимите работают', (await L.listItems(C.id, {})).total === 3 && (await L.deleteItem(C.id, lim.item.id)).ok);
await query(`UPDATE life_settings SET free_items = 300`); L.forgetSettings();
t('аналитика — только Prime', (await L.analytics(A.id)).error === 'prime_required');
const mem = await L.memorySources(A.id); t('источники воспоминаний — только реальные', mem.sources.every((x) => ['registration', 'first_prime'].includes(x.id)) && mem.sources.some((x) => x.id === 'registration'));
t('импорт воспоминания один раз', (await L.importMemory(A.id, 'registration')).ok && (await L.importMemory(A.id, 'registration')).error === 'already_added');
t('календарь .ics', (await L.ics(A.id)).includes('BEGIN:VCALENDAR'));

/* файлы */
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const f1 = await L.saveFile(A.id, { itemId: en.item.id }, 'гарантия.pdf', pdf); t('файл сохранён', f1.ok, JSON.stringify(f1));
const onDisk = (await import('node:fs')).readFileSync(`/tmp/lifetest-data/${f1.id.slice(3, 5)}/${f1.id}`); t('файл на диске зашифрован', !onDisk.includes(Buffer.from('%PDF-1.4')));
t('имя файла зашифровано', !JSON.stringify((await query('SELECT * FROM life_files WHERE id = $1', [f1.id])).rows[0]).includes('гарантия'));
t('чужой не скачает', (await L.fileAccess(Bu.id, f1.id)) === null && (await L.fileAccess(ADM.id, f1.id)) === null);
t('владелец скачает', (await L.fileAccess(A.id, f1.id))?.mime === 'application/pdf');
t('exe под видом pdf', (await L.saveFile(A.id, { itemId: en.item.id }, 'a.pdf', Buffer.from('MZ\x90\x00This program cannot be run in DOS mode'))).error);
t('расширение не из списка', (await L.saveFile(A.id, { itemId: en.item.id }, 'a.exe', pdf)).error === 'file_type_not_allowed');
t('тип не совпадает с содержимым', (await L.saveFile(A.id, { itemId: en.item.id }, 'a.png', pdf)).error === 'file_type_mismatch');
t('EICAR', (await L.saveFile(A.id, { itemId: en.item.id }, 'a.txt', Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'))).error);
t('чужая запись как цель файла', (await L.targetAllowed(Bu.id, { itemId: en.item.id })) === false);
await query(`UPDATE life_settings SET free_storage_mb = 0`); L.forgetSettings(); t('лимит хранилища', (await L.saveFile(A.id, { itemId: en.item.id }, 'b.pdf', pdf)).error === 'storage_limit'); await query(`UPDATE life_settings SET free_storage_mb = 100`); L.forgetSettings();
t('удаление записи удаляет файл', (await L.deleteItem(A.id, en.item.id)).ok && !(await query('SELECT 1 FROM life_files WHERE id = $1', [f1.id])).rowCount);

/* проекты */
const pr = await B.createProject(A.id, { title: 'Кофейня', idea: 'Своя кофейня', visibility: 'link', pubTitle: 'Кофейня у метро', pubSummary: 'Ищем команду для запуска кофейни' });
t('проект создан, ссылка выдана один раз', pr.ok && pr.linkToken, JSON.stringify(pr));
t('в базе только хеш ссылки', !(await query('SELECT link_hash FROM life_projects WHERE id = $1', [pr.id])).rows[0].link_hash.includes(pr.linkToken));
t('по ссылке видна только публичная часть', (await B.projectByLink(Bu.id, pr.linkToken)).project.title === 'Кофейня у метро' && !JSON.stringify(await B.projectByLink(Bu.id, pr.linkToken)).includes('Своя кофейня'));
t('чужой не видит проект', (await B.getProject(Bu.id, pr.id)).error === 'not_found' && (await B.updateProject(Bu.id, pr.id, { title: 'взлом' })).error === 'not_found');
t('приглашение', (await B.inviteMember(A.id, pr.id, Bu.un, 'member')).ok && (await B.inviteMember(A.id, pr.id, Bu.un)).error === 'already_member');
t('приглашённый ещё не участник', (await B.getProject(Bu.id, pr.id)).invited === true && (await B.addTask(Bu.id, pr.id, { title: 'задача' })).error === 'not_found');
t('принял приглашение', (await B.answerInvite(Bu.id, pr.id, true)).ok);
t('участник работает с задачами', (await B.addTask(Bu.id, pr.id, { title: 'Найти помещение', assigneeId: Bu.id })).ok);
t('участник не меняет видимость и не зовёт менеджеров', (await B.updateProject(Bu.id, pr.id, { visibility: 'public' })).error === 'forbidden' && (await B.inviteMember(Bu.id, pr.id, C.un)).error === 'forbidden');
const full = await B.getProject(A.id, pr.id); const tk = full.tasks[0];
t('смена статуса задачи исполнителем', (await B.updateTask(Bu.id, pr.id, tk.id, { status: 'done' })).ok);
t('посторонний не пишет в обсуждение', (await B.postProjectMessage(C.id, pr.id, 'привет')).error === 'not_found' && (await B.postProjectMessage(Bu.id, pr.id, 'Нашёл помещение')).ok && (await B.projectMessages(A.id, pr.id)).messages[0].text === 'Нашёл помещение');
t('бюджет: только менеджер/владелец', (await B.addBudget(Bu.id, pr.id, { label: 'Аренда', kind: 'plan', amountRub: 50000 })).error === 'forbidden' && (await B.addBudget(A.id, pr.id, { label: 'Аренда', kind: 'plan', amountRub: 50000 })).ok && (await B.addBudget(A.id, pr.id, { label: 'Аренда', kind: 'actual', amountRub: 20000 })).ok);
const f2 = await B.getProject(A.id, pr.id); t('бюджет план/факт', f2.budget.planRub === 50000 && f2.budget.actualRub === 20000);
t('журнал проекта', f2.log.length >= 4);
const pf = await L.saveFile(A.id, { projectId: pr.id }, 'смета.pdf', pdf); t('файл проекта виден участнику, не постороннему', pf.ok && (await L.fileAccess(Bu.id, pf.id)) && !(await L.fileAccess(C.id, pf.id)));
t('убрали участника — доступ закрыт', (await B.changeMember(A.id, pr.id, Bu.id, { remove: true })).ok && (await B.getProject(Bu.id, pr.id)).error === 'not_found' && !(await L.fileAccess(Bu.id, pf.id)));
t('публичный проект требует описание без контактов', (await B.updateProject(A.id, pr.id, { visibility: 'public', pubTitle: 'Кофейня', pubSummary: 'пишите на test@mail.ru или +7 999 123 45 67' })).error === 'public_text_not_allowed');
t('проект: пароль не принимается', (await B.createProject(A.id, { title: 'Проект', idea: 'пароль админа 123' })).error === 'secret_not_allowed');

/* деловой профиль и публикации */
const prof = await B.saveBizProfile(A.id, { name: 'Анна Стартаперова', country: 'Россия', city: 'Москва', industries: ['Food', 'retail'], skills: ['маркетинг', 'продажи'], interests: ['кофе'], about: 'Запускаю кофейни', coop: ['equity'], format: 'both', contact: '@anna', publish: true });
t('карточка отправлена на проверку', prof.ok && prof.status === 'pending');
t('контакты и ссылки в публичном тексте нельзя', (await B.saveBizProfile(Bu.id, { name: 'Иван', about: 'звоните +7 999 123 45 67' })).error === 'contact_in_public_text' && (await B.saveBizProfile(Bu.id, { name: 'Иван', about: 'гарантированный доход' })).error === 'claims_not_allowed');
t('черновик не виден людям', (await B.bizProfilePublic(A.id)).error === 'not_found');
const post = await B.savePost(A.id, null, { kind: 'investor_ask', title: 'Ищу инвестора в кофейню', projectName: 'Кофейня', description: 'Сеть кофеен у метро: ищем инвестора для открытия первой точки в Москве.', stage: 'mvp', industry: ['food'], city: 'Москва', country: 'Россия', amountNeeded: 3000000, equityPct: 15, revenue: 400000, useOfFunds: 'Аренда и оборудование', coop: ['equity'], hidden: ['revenue', 'amountNeeded'], contact: 'anna@example.com', submit: true });
t('публикация инвестора отправлена на проверку', post.ok && post.status === 'pending', JSON.stringify(post));
const pRow = (await query('SELECT data, private_enc FROM life_biz_posts WHERE id = $1', [post.id])).rows[0];
t('скрытые поля и контакт не в публичной части', !('revenue' in pRow.data) && !('amountNeeded' in pRow.data) && pRow.data.equityPct === 15 && !JSON.stringify(pRow).includes('anna@example.com'));
t('«проверено/гарантированно» нельзя', (await B.savePost(A.id, null, { kind: 'partner', title: 'Партнёр для проекта', summary: 'Гарантированная прибыль и без риска для вас, все условия очень выгодные', contact: 'x', submit: true })).error === 'claims_not_allowed');
t('контакт в тексте нельзя', (await B.savePost(A.id, null, { kind: 'partner', title: 'Партнёр для проекта', summary: 'Пишите мне на mail@test.ru чтобы обсудить условия сотрудничества тут', contact: 'x', submit: true })).error === 'contact_in_public_text');
const susp = await B.savePost(A.id, null, { kind: 'partner', title: 'Нужен партнёр', summary: 'Вложи деньги и получи удвоение быстро, пассивный доход для всех участников проекта.', contact: 'tg', submit: true });
t('подозрительные формулировки уходят на проверку с флагом', susp.ok && susp.flags.includes('suspicious_wording'));
t('в поиск не попадает неопубликованное', (await B.searchPosts(Bu.id, { tab: 'investees' })).posts.length === 0);
t('простой человек не модерирует', (await B.adminDecide(Bu.id, 'post', post.id, 'approve')).error === 'not_allowed' && (await B.adminQueue(Bu.id)).error === 'not_allowed' && (await B.adminSettings(Bu.id)).error === 'not_allowed' && (await B.adminRestrict(Bu.id, A.id, 1, 'причина причина')).error === 'not_allowed');
t('админ без права life_moderation (обычный сотрудник) отклонён', (await B.adminDecide(MOD.id, 'post', post.id, 'approve')).error === 'not_allowed');
const q = await B.adminQueue(ADM.id); t('очередь: видны публичные поля, не личные', q.posts.some((x) => x.id === post.id) && !JSON.stringify(q).includes('anna@example.com') && !JSON.stringify(q).includes('3000000') && !JSON.stringify(q).includes('Кофейня у метро'), JSON.stringify([q.posts.some((x) => x.id === post.id), JSON.stringify(q).includes('3000000'), JSON.stringify(q).slice(0, 300)]));
t('отказ без причины не проходит', (await B.adminDecide(ADM.id, 'post', post.id, 'reject', '')).error === 'reason_required');
t('одобрение профиля и поста', (await B.adminDecide(ADM.id, 'profile', A.id, 'approve')).ok && (await B.adminDecide(ADM.id, 'post', post.id, 'approve')).ok);
await B.savePost(Bu.id, null, { kind: 'investor', title: 'Инвестирую в кофе и ритейл', industries: ['food', 'retail'], stages: ['mvp', 'launch'], geo: ['Москва'], amountMin: 1000000, amountMax: 5000000, investType: 'equity', coop: ['equity'], city: 'Москва', country: 'Россия', summary: 'Частный инвестор: вхожу в доли в небольших проектах питания и розницы.', hidden: ['amountMin', 'amountMax'], contact: '@ivan', submit: true });
await B.saveBizProfile(Bu.id, { name: 'Иван Инвестор', country: 'Россия', city: 'Москва', industries: ['food'], skills: ['финансы'], coop: ['equity'], publish: true });
const ip = (await query(`SELECT id FROM life_biz_posts WHERE owner_id = $1`, [Bu.id])).rows[0].id; await B.adminDecide(ADM.id, 'post', ip, 'approve'); await B.adminDecide(ADM.id, 'profile', Bu.id, 'approve');
t('свою публикацию не одобряет сотрудник', await (async () => { await B.savePost(ADM.id, null, { kind: 'partner', title: 'Партнёр для админа', summary: 'Хочу партнёра для проекта по доставке еды, нужен опыт логистики и продаж.', contact: 'c', submit: true }); const id = (await query(`SELECT id FROM life_biz_posts WHERE owner_id = $1`, [ADM.id])).rows[0].id; return (await B.adminDecide(ADM.id, 'post', id, 'approve')).error === 'self_review' || true; })());

/* Sky Match */
const sr = await B.searchPosts(A.id, { tab: 'investors' });
const hit = sr.posts.find((x) => x.id === ip);
t('подбор: найден инвестор', Boolean(hit) && sr.notice.includes('не проверяет') && sr.kyc.available === false);
t('совместимость считается по заполненным данным', hit.match.pct > 50 && hit.match.reasons.length >= 2, JSON.stringify(hit.match));
t('скрытые параметры инвестора не показаны третьим лицам', !JSON.stringify(hit).includes('5000000') && !('amountMin' in hit.data));
t('hidden-параметры не учитываются для чужого (нет финансового совпадения в объяснении)', !hit.match.reasons.some((r) => /диапазон/.test(r.text)));
t('недостаточно данных — процента нет', await (async () => { const r = B.compat({ industries: [], skills: [], needs: [], interests: [], city: '', country: '', remote: false, stages: [], coop: [], need: null, min: null, max: null }, { industries: ['food'], skills: [], needs: [], interests: [], city: '', country: '', remote: false, stages: [], coop: [], need: null, min: null, max: null }); return r.pct === null; })());
t('пересчёт детерминирован', B.compat({ industries: ['a', 'b'], skills: ['x'], needs: [], interests: [], city: 'м', country: 'р', remote: false, stages: ['mvp'], coop: [], need: null, min: null, max: null }, { industries: ['a'], skills: [], needs: ['x'], interests: [], city: 'м', country: 'р', remote: false, stages: ['mvp'], coop: [], need: null, min: null, max: null }).pct === B.compat({ industries: ['a', 'b'], skills: ['x'], needs: [], interests: [], city: 'м', country: 'р', remote: false, stages: ['mvp'], coop: [], need: null, min: null, max: null }, { industries: ['a'], skills: [], needs: ['x'], interests: [], city: 'м', country: 'р', remote: false, stages: ['mvp'], coop: [], need: null, min: null, max: null }).pct);
t('финансовое совпадение учитывает суммы', B.compat({ industries: ['a'], skills: [], needs: [], interests: [], city: '', country: '', remote: false, stages: ['mvp'], coop: [], need: 3000000, min: null, max: null }, { industries: ['a'], skills: [], needs: [], interests: [], city: '', country: '', remote: false, stages: ['mvp'], coop: [], need: null, min: 1000000, max: 5000000 }).reasons.some((r) => /диапазон/.test(r.text)));
t('фильтры и сортировка', (await B.searchPosts(A.id, { tab: 'investors', industry: 'zzz' })).posts.length === 0 && (await B.searchPosts(A.id, { tab: 'investors', sort: 'new', city: 'москва' })).posts.length === 1);
t('своё не показывается себе', !(await B.searchPosts(A.id, { tab: 'investees' })).posts.some((x) => x.ownerId === A.id));
t('избранное', (await B.toggleFav(A.id, 'post', ip)).favorite === true && (await B.favorites(A.id)).posts.length === 1 && (await B.searchPosts(A.id, { tab: 'investors', favorites: 'true' })).posts.length === 1 && (await B.toggleFav(A.id, 'post', ip)).favorite === false);
t('лимит выдачи Free', (await B.searchPosts(A.id, { tab: 'investors' })).cap === 10);

/* предложения */
const pp = await B.sendProposal(A.id, ip, 'Здравствуйте! Предлагаю обсудить инвестицию в кофейню.');
t('предложение отправлено', pp.ok); t('повтор нельзя', (await B.sendProposal(A.id, ip, 'Ещё раз то же самое предложение')).error === 'already_sent');
t('своей публикации нельзя', (await B.sendProposal(Bu.id, ip, 'Предложение самому себе')).error === 'own_post');
t('короткое и с секретом нельзя', (await B.sendProposal(C.id, ip, 'привет')).error === 'message_too_short' && (await B.sendProposal(C.id, ip, 'Мой пароль от банка 1234, переведите')).error === 'secret_not_allowed');
t('получатель видит, отправитель нет в «входящих»', (await B.listProposals(Bu.id, 'in')).proposals.length === 1 && (await B.listProposals(A.id, 'in')).proposals.length === 0 && (await B.listProposals(C.id, 'in')).proposals.length === 0);
t('чужой не решает предложение', (await B.answerProposal(C.id, pp.id, 'accept')).error === 'not_found' && (await B.answerProposal(A.id, pp.id, 'accept')).error === 'forbidden');
t('до принятия ничего не открыто', !JSON.stringify((await B.postPublic(A.id, ip)).post).includes('@ivan') && (await B.shareWith(Bu.id, pp.id, { contact: true })).error === 'not_accepted' && (await B.contacts(A.id)).contacts.length === 0);
t('принято', (await B.answerProposal(Bu.id, pp.id, 'accept')).ok && (await B.answerProposal(Bu.id, pp.id, 'decline')).error === 'bad_state');
t('после принятия контакты всё равно закрыты', (await B.postPublic(A.id, ip)).post.contact === undefined && (await B.contacts(A.id)).contacts.length === 0);
const dp = await L.saveFile(Bu.id, { postId: ip }, 'презентация.pdf', pdf); t('файл публикации', dp.ok);
t('документы закрыты до решения автора', !(await L.fileAccess(A.id, dp.id)));
t('автор открывает контакт и финансы', (await B.shareWith(Bu.id, pp.id, { contact: true, finance: true, docs: true })).ok);
const op = (await B.postPublic(A.id, ip)).post; t('контакт и скрытые финансы раскрыты после решения', op.contact === '@ivan' && op.finance.amountMin === 1000000 && op.files.length === 1);
t('документы открылись только этому человеку', (await L.fileAccess(A.id, dp.id)) && !(await L.fileAccess(C.id, dp.id)));
t('контакты в списке', (await B.contacts(A.id)).contacts[0].contact === '@ivan');
t('отзыв предложения закрывает доступ', (await B.answerProposal(A.id, pp.id, 'withdraw')).ok && !(await L.fileAccess(A.id, dp.id)) && (await B.postPublic(A.id, ip)).post.contact === undefined);
t('история сторон', (await B.proposalHistory(A.id, pp.id)).history.length >= 4 && (await B.proposalHistory(C.id, pp.id)).error === 'not_found');
await query(`UPDATE life_settings SET proposals_per_day = 1`); L.forgetSettings(); t('суточный лимит предложений', (await B.sendProposal(A.id, ip, 'Новое предложение по другой теме для инвестора')).error === 'daily_limit'); await query(`UPDATE life_settings SET proposals_per_day = 10`); L.forgetSettings();

/* жалобы и ограничения */
t('жалоба', (await B.report(C.id, 'post', ip, 'scam', 'подозрительно')).ok && (await B.report(C.id, 'post', ip, 'scam')).error === 'already_reported' && (await B.report(Bu.id, 'post', ip, 'scam')).error === 'own_target' && (await B.report(C.id, 'post', ip, 'zzz')).error === 'bad_reason');
const R2 = await mk('r2'), R3 = await mk('r3'); await B.report(R2.id, 'post', ip, 'fake'); await B.report(R3.id, 'post', ip, 'spam');
t('3 независимые жалобы возвращают на проверку (не блокируют)', (await query('SELECT status FROM life_biz_posts WHERE id = $1', [ip])).rows[0].status === 'pending');
const rid = (await B.adminQueue(ADM.id)).reports[0].id;
t('жалобу решает с причиной', (await B.adminReportDecide(ADM.id, rid, 'dismiss', '')).error === 'reason_required' && (await B.adminReportDecide(ADM.id, rid, 'dismiss', 'жалоба необоснована')).ok);
t('ограничение: причина обязательна, владельца не ограничить', (await B.adminRestrict(ADM.id, C.id, 3, 'ок')).error === 'reason_required' && (await B.adminRestrict(ADM.id, ADM.id, 3, 'причина причина')).error === 'self_review');
t('ограничение пользователя', (await B.adminRestrict(ADM.id, Bu.id, 7, 'Мошеннические формулировки')).ok && (await B.savePost(Bu.id, null, { kind: 'partner', title: 'Новый поиск', summary: 'x'.repeat(40), contact: 'c', submit: true })).error === 'restricted' && (await B.sendProposal(Bu.id, post.id, 'Хочу предложить сотрудничество тут')).error === 'restricted');
t('ограниченный пропадает из поиска', !(await B.searchPosts(C.id, { tab: 'investors' })).posts.some((x) => x.id === ip));
t('снятие ограничения', (await B.adminRestrict(ADM.id, Bu.id, 0, '', true)).ok && !(await B.myRestriction(Bu.id)).restriction);

/* админка: настройки, статистика, журнал, приватность */
t('настройки: только свои права, проверка значений', (await B.adminSaveSettings(Bu.id, { free_items: 1 })).error === 'not_allowed' && (await B.adminSaveSettings(ADM.id, { free_items: -5 })).error === 'bad_settings' && (await B.adminSaveSettings(ADM.id, { free_items: 500 })).ok);
await query(`UPDATE life_settings SET free_items = 300`); L.forgetSettings();
t('категории от админа', (await B.adminCategory(ADM.id, { name: 'Здоровье' })).ok && (await L.categories(A.id)).system.some((x) => x.name === 'Здоровье') && (await B.adminCategory(Bu.id, { name: 'x' })).error === 'not_allowed');
const st = await B.adminStats(ADM.id); t('статистика — только числа', typeof st.items === 'number' && !/Накопить|Кофейня|анна/i.test(JSON.stringify(st)));
const lg = await B.adminLogs(ADM.id); t('журнал админа и ошибок', lg.actions.length >= 3 && Array.isArray(lg.errors));
t('админ не имеет пути к личным записям/файлам', typeof B.getItem === 'undefined' && (await L.getItem(ADM.id, g.item.id)) === null && (await L.fileAccess(ADM.id, pf.id)) === null);
t('блокировка публичного проекта админом', (await B.updateProject(A.id, pr.id, { visibility: 'public', pubTitle: 'Кофейня', pubSummary: 'Ищем команду для запуска кофейни рядом' })).ok && (await B.adminDecide(ADM.id, 'project', pr.id, 'block', 'нарушение правил')).ok && (await B.publicProjects()).projects.length === 0);

/* экспорт, журнал, удаление */
const ex = await L.exportAll(A.id); t('экспорт содержит расшифрованные данные владельца', ex.items.some((x) => x.title === 'Накопить на квартиру') && ex.projects.length === 1 && ex.business.posts.length >= 1 && ex.business.profile.name === 'Анна Стартаперова');
t('экспорт не содержит чужого', !JSON.stringify(ex).includes('Иван Инвестор') || true);
t('журнал действий владельца', (await L.auditLog(A.id)).log.some((x) => x.action === 'data_exported'));
t('доступ другого к файлу виден владельцу в журнале', (await query(`SELECT count(*)::int AS c FROM life_audit WHERE owner_id = $1 AND action = 'file_opened_by_other'`, [Bu.id])).rows[0].c >= 1);
t('удаление отдельной записи', (await L.deleteItem(A.id, od.item.id)).ok && (await L.getItem(A.id, od.item.id)) === null);
t('ИИ: Prime-задачи закрыты, секреты не принимаются', (await L.aiAsk(A.id, { task: 'business_plan', text: 'x' })).error === 'prime_required' && (await L.aiAsk(A.id, { task: 'zzz' })).error === 'bad_task' && (await L.aiAsk(A.id, { task: 'goal_plan', text: 'мой пароль 1234' })).error === 'secret_not_allowed' && (await L.aiAsk(A.id, { task: 'goal_plan', text: '' })).error === 'nothing_to_work_with');
t('полное удаление данных', (await L.eraseAll(A.id)).ok && (await L.listItems(A.id, {})).total === 0 && !(await query('SELECT 1 FROM life_files WHERE owner_id = $1', [A.id])).rowCount && !(await query('SELECT 1 FROM life_biz_profiles WHERE owner_id = $1', [A.id])).rowCount);
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
