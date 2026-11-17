/** Автомодерация каналов: контекст, один признак ≠ дело, серьёзное только при независимых признаках, жалобы и налёты, решения, ограничение, апелляция, права. Модуль на Postgres `skytest`. */
process.env.OWNER_USERNAME = 'cmowner';
const C = await import('../../server/chanmod.mjs');
const F = await import('../../server/acctfreeze.mjs');
const { encryptContent } = await import('../../server/crypto.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const sfx = Date.now().toString(36);
const mk = async (tag, { username, admin = false, ageDays = 60 } = {}) => { const i = `acc-cm${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query(`INSERT INTO profiles (id, username, name, sky_id, is_admin, created_at) VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' days')::interval)`, [i, username ?? `u${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`, admin, String(ageDays)]); return { id: i, username: username ?? `u${tag}${sfx}` }; };
await query("DELETE FROM profiles WHERE username = 'cmowner'");
const OW = await mk('o', { username: 'cmowner' }), MOD = await mk('m', { admin: true }), MOD2 = await mk('n', { admin: true }), USR = await mk('u'), CH_OWN = await mk('c');
await query("UPDATE chan_mod_settings SET enabled=TRUE, review_score=40, serious_score=75, auto_restrict=FALSE, restrict_hours=72 WHERE id");
const chan = async (tag, { desc = '', pub = true, posts = [] } = {}) => { const id = `chn-cm${tag}${sfx}`; await query('INSERT INTO chats (id, type, name, description, owner_id, username) VALUES ($1,$2,$3,$4,$5,$6)', [id, 'channel', encryptContent(`Канал ${tag}`), desc ? encryptContent(desc) : null, CH_OWN.id, pub ? `ch${tag}${sfx}` : '']); await query("INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'owner')", [id, CH_OWN.id]); let i = 0; for (const p of posts) await query("INSERT INTO messages (id, chat_id, author_id, kind, text) VALUES ($1,$2,$3,'text',$4)", [`m-cm${tag}${sfx}${i++}`, id, CH_OWN.id, encryptContent(p)]); return id; };
const member = async (id, u) => query("INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [id, u.id]);

// сканер: контекст
const a = C.scanText('Куплю мефедрон, быстро и анонимно, пиши в лс t.me/x, цена 3000 ₽');
t('scanner: drug sale with sale-context scores high', a.signals.some((s) => s.category === 'drugs') && a.score >= 40);
const b0 = C.scanText('Полиция задержала продавцов, изъяты закладки: суд вынес приговор, сообщает новость');
t('scanner: news context lowers weight', b0.signals.length > 0 && b0.score < 15);
const w1 = C.scanText('В фильме герой говорит: «я тебя убью»');
t('scanner: film/quote context lowers weight', w1.score < 12);
t('scanner: single plain word is not enough for review', C.aggregate(C.scanText('Они продали закладку в игре').signals, 0).score < 40 && C.aggregate(C.scanText('Это просто слово — закладки в книге').signals, 0).score < 40);
t('scanner: fraud warning is not fraud', C.scanText('Осторожно, мошенники рассылают: не вводите пароль и код из смс никому').score < 15);
t('scanner: real phishing', C.scanText('Ваш аккаунт заблокирован, срочно перейдите и введите пароль и код из смс').score >= 20);
t('scanner: clean text', C.scanText('Привет всем! Сегодня обсуждаем новый альбом и погоду.').score === 0 && C.scanText('').score === 0);
t('scanner: very long text ok', C.scanText('слово '.repeat(5000)).score === 0);

// каналы
const clean1 = await chan('ok', { desc: 'Музыкальные новости', posts: ['Привет', 'Новый релиз'] });
let r = await C.scanChannel(clean1); t('clean channel: no case', r.case === null);
const one = await chan('one', { desc: 'Всё о играх', posts: ['В игре можно найти закладки на карте'] });
r = await C.scanChannel(one); t('one ambiguous word: no case', r.case === null);
const news = await chan('news', { posts: ['Полиция задержала сбытчиков мефедрона и закладок, сообщает суд'] });
r = await C.scanChannel(news); t('news about drugs: no case', r.case === null);
const bad1 = await chan('bad', { desc: 'Продажа наркотиков, мефедрон, закладки', posts: ['Куплю мефедрон, доставка, цена 3000 ₽, пиши в лс t.me/shop', 'В наличии гашиш, оплата сразу, пиши в лс', 'Мефедрон оптом, скидка, t.me/shop2'] });
r = await C.scanChannel(bad1);
t('drug channel: case opened for moderator', r.case && r.score >= 40);
const c1 = (await query('SELECT * FROM chan_mod_cases WHERE id = $1', [r.case])).rows[0];
t('case: text-only signals, encrypted excerpts, status review', c1.status === 'review' && c1.signals.length > 0 && c1.signals.every((s) => s.ex && !/мефедрон/i.test(s.ex)));
const again = await C.scanChannel(bad1); t('rescan: no duplicate case', again.updated && (await query("SELECT count(*)::int n FROM chan_mod_cases WHERE chat_id = $1", [bad1])).rows[0].n === 1);
const priv = await chan('priv', { pub: false, desc: 'Продажа наркотиков мефедрон закладки', posts: ['Куплю мефедрон, цена, пиши в лс'] });
r = await C.scanChannel(priv); t('private channel content is NOT scanned', r.case === null);
await query("UPDATE chan_mod_settings SET enabled = FALSE WHERE id"); t('disabled: nothing scanned', (await C.scanChannel(bad1)).skipped === 'disabled'); await query("UPDATE chan_mod_settings SET enabled = TRUE WHERE id");

// права
t('user cannot use queue/detail/decide/settings', (await C.queue(USR.id)).error === 'not_allowed' && (await C.detail(USR.id, c1.id)).error === 'not_allowed' && (await C.decide(USR.id, c1.id, { action: 'dismiss', reason: 'не нарушение' })).error === 'not_allowed' && (await C.saveSettings(USR.id, { reviewScore: 50 })).error === 'not_allowed');
const q = await C.queue(MOD.id); t('queue lists case', q.items.some((x) => x.id === c1.id && x.categories.includes('drugs')));
const d = await C.detail(MOD.id, c1.id); t('detail: excerpts decrypted for moderator, history', d.signals.some((s) => /мефедрон|гашиш/i.test(s.ex ?? '')) && d.history.some((h) => h.action === 'opened'));
// решения
t('not serious → cannot restrict', c1.serious ? true : (await C.decide(MOD.id, c1.id, { action: 'restrict', reason: 'достаточно длинная причина', confirm: true })).error === 'not_serious');
t('dismiss needs reason', (await C.decide(MOD.id, c1.id, { action: 'dismiss', reason: 'нет' })).error === 'reason_required');
t('owner of the channel cannot decide on it', (await (async () => { await query("UPDATE profiles SET is_admin = TRUE WHERE id = $1", [CH_OWN.id]); const x = await C.decide(CH_OWN.id, c1.id, { action: 'dismiss', reason: 'сам себя оправдываю' }); await query("UPDATE profiles SET is_admin = FALSE WHERE id = $1", [CH_OWN.id]); return x; })()).error === 'self_review');
const w = await C.decide(MOD.id, c1.id, { action: 'warn', reason: 'Уберите объявления о продаже, иначе канал будет ограничен' });
t('warn: owner notified, case closed, no freeze', w.ok && w.status === 'closed' && Number((await query("SELECT count(*)::int n FROM gift_notifications WHERE kind='chan_mod' AND user_id = $1", [CH_OWN.id])).rows[0].n) >= 1 && !(await query("SELECT 1 FROM acct_freezes WHERE target_id = $1 AND status = 'active'", [bad1])).rowCount);
t('decided case cannot be decided again', (await C.decide(MOD.id, c1.id, { action: 'dismiss', reason: 'повторно решаю' })).error === 'bad_state');

// серьёзное: нужны независимые признаки
await query("DELETE FROM chan_mod_cases WHERE chat_id = $1", [bad1]);
const grim = await chan('grim', { desc: 'Продажа наркотиков и оружия', posts: ['Куплю мефедрон, доставка, цена, пиши в лс t.me/a', 'Продам пистолет и патроны, цена, пиши в лс t.me/b', 'Ваш аккаунт заблокирован, перейдите и введите пароль, оплата сразу', 'В наличии гашиш, скидка, t.me/c', 'Продам автомат оптом, доставка'] });
r = await C.scanChannel(grim);
t('serious: several independent categories', r.case && r.serious === true && r.score >= 75);
const sc = (await query('SELECT * FROM chan_mod_cases WHERE id = $1', [r.case])).rows[0];
t('restrict needs confirmation and long reason', (await C.decide(MOD.id, sc.id, { action: 'restrict', reason: 'достаточно длинная причина', confirm: false })).error === 'confirm_required' && (await C.decide(MOD.id, sc.id, { action: 'restrict', reason: 'коротко', confirm: true })).error === 'reason_required');
const rs = await C.decide(MOD.id, sc.id, { action: 'restrict', reason: 'Подтверждены объявления о продаже наркотиков и оружия', confirm: true, hours: 24 });
t('restricted temporarily (channel freeze with expiry), data kept', rs.ok && rs.status === 'restricted' && (await query("SELECT 1 FROM acct_freezes WHERE target_type='channel' AND target_id = $1 AND status='active' AND expires_at IS NOT NULL", [grim])).rowCount === 1 && (await query("SELECT count(*)::int n FROM messages WHERE chat_id = $1", [grim])).rows[0].n === 5);
t('owner sees restriction and may appeal', (await C.ownerCases(CH_OWN.id)).items.some((x) => x.id === sc.id && x.canAppeal && x.reason));
t('owner notified by freeze', Number((await query("SELECT count(*)::int n FROM gift_notifications WHERE kind='account_freeze' AND user_id = $1", [CH_OWN.id])).rows[0].n) >= 1);
t('stranger cannot appeal', (await C.appealCase(USR.id, sc.id, 'Я хочу оспорить чужое решение по каналу')).error === 'not_found');
t('appeal too short', (await C.appealCase(CH_OWN.id, sc.id, 'нет')).error === 'appeal_too_short');
t('owner appeals', (await C.appealCase(CH_OWN.id, sc.id, 'Это ошибка, мы продаём музыкальные записи, а не запрещённое.')).ok && (await C.queue(MOD.id, { status: 'appealed' })).items.some((x) => x.id === sc.id));
t('restricting moderator cannot decide own restriction appeal', (await C.decideCaseAppeal(MOD.id, sc.id, { outcome: 'accepted', note: 'Принимаю свою же апелляцию' })).error === 'self_review');
const ap = await C.decideCaseAppeal(MOD2.id, sc.id, { outcome: 'accepted', note: 'Проверено: объявления удалены, нарушений нет' });
t('other moderator accepts: restored, freeze lifted', ap.ok && ap.status === 'restored' && !(await query("SELECT 1 FROM acct_freezes WHERE target_id = $1 AND status='active'", [grim])).rowCount);
t('history kept', (await C.detail(MOD.id, sc.id)).history.map((h) => h.action).join().includes('opened') && (await C.detail(MOD.id, sc.id)).history.some((h) => h.action === 'appeal_accepted') && (await C.detail(MOD.id, sc.id)).history.some((h) => h.action === 'restricted'));
t('audit log has decisions', Number((await query("SELECT count(*)::int n FROM admin_log WHERE type IN ('chan_mod_restrict','chan_mod_warn','chan_mod_dismiss')")).rows[0].n) >= 2);

// жалобы и налёты
const rep = await chan('rep', { desc: 'Обычный канал', posts: ['Привет'] });
const members = []; for (let i = 0; i < 10; i++) { const m = await mk(`r${i}`); await member(rep, m); members.push(m); }
t('owner cannot report own channel; non-member cannot report', (await C.report(CH_OWN.id, rep, 'drugs')).error === 'own_channel' && (await C.report(USR.id, rep, 'drugs')).error === 'not_member');
t('bad reason refused', (await C.report(members[0].id, rep, 'zzz')).error === 'bad_reason');
t('first report ok, duplicate refused', (await C.report(members[0].id, rep, 'abuse')).ok && (await C.report(members[0].id, rep, 'abuse')).error === 'already_reported');
for (let i = 1; i < 4; i++) await C.report(members[i].id, rep, 'abuse');
t('few reports never open a case alone', (await query("SELECT count(*)::int n FROM chan_mod_cases WHERE chat_id = $1", [rep])).rows[0].n === 0);
// налёт: новые аккаунты
const brig = await chan('brig', { desc: 'Хороший канал', posts: ['Привет'] });
for (let i = 0; i < 8; i++) { const m = await mk(`b${i}`, { ageDays: 0 }); await member(brig, m); await C.report(m.id, brig, 'illegal'); }
t('brigade of fresh accounts: weights zeroed, no case', Number((await query('SELECT COALESCE(sum(weight),0) w FROM chan_mod_reports WHERE chat_id = $1', [brig])).rows[0].w) === 0 && (await query("SELECT count(*)::int n FROM chan_mod_cases WHERE chat_id = $1", [brig])).rows[0].n === 0);
// достаточно независимых жалоб старых аккаунтов
const many = await chan('many', { desc: 'Канал', posts: ['Привет'] });
for (let i = 0; i < 9; i++) { const m = await mk(`k${i}`); await member(many, m); await C.report(m.id, many, 'drugs'); }
const mc = (await query("SELECT * FROM chan_mod_cases WHERE chat_id = $1", [many])).rows[0];
t('9 independent trusted reporters open a review case (not serious)', mc && mc.source === 'reports' && mc.status === 'review' && mc.serious === false);
t('dismiss marks reports so serial false reporters lose weight', (await C.decide(MOD.id, mc.id, { action: 'dismiss', reason: 'Жалобы необоснованны, нарушений нет' })).ok && Number((await query("SELECT count(*)::int n FROM chan_mod_reports WHERE chat_id = $1 AND outcome = 'dismissed'", [many])).rows[0].n) === 9);
// репутация жалобщика: 3 отклонённых → вес 0
const serial = await mk('s'); const ch3 = [];
for (let i = 0; i < 4; i++) { const id = await chan(`s${i}`, { desc: 'Канал', posts: ['Привет'] }); await member(id, serial); ch3.push(id); }
for (let i = 0; i < 3; i++) await query("INSERT INTO chan_mod_reports (chat_id, reporter_id, reason, weight, outcome) VALUES ($1,$2,'other',1,'dismissed')", [`chn-fake${i}${sfx}`, serial.id]);
await C.report(serial.id, ch3[0], 'abuse');
t('reporter with many dismissed reports has zero weight', Number((await query('SELECT weight FROM chan_mod_reports WHERE chat_id = $1 AND reporter_id = $2', [ch3[0], serial.id])).rows[0].weight) === 0);
const fresh = await mk('f2', { ageDays: 1 }); const chf = await chan('f2', { desc: 'Канал', posts: ['Привет'] }); await member(chf, fresh); await C.report(fresh.id, chf, 'abuse');
t('new account report weighs less', Number((await query('SELECT weight FROM chan_mod_reports WHERE chat_id = $1 AND reporter_id = $2', [chf, fresh.id])).rows[0].weight) === 0.3);
const lim = await mk('lim'); const ids = []; for (let i = 0; i < 11; i++) { const id = await chan(`l${i}`, { desc: 'Канал', posts: ['Привет'] }); await member(id, lim); ids.push(id); }
const res = []; for (const id of ids) res.push((await C.report(lim.id, id, 'abuse')).error ?? 'ok');
t('reports per day capped (10)', res.filter((x) => x === 'ok').length === 10 && res[10] === 'too_many_reports');
// настройки
t('settings: moderator can change but not weaken', (await C.saveSettings(MOD.id, { restrictHours: 48 })).ok && (await C.saveSettings(MOD.id, { reviewScore: 30 })).error === 'owner_only' && (await C.saveSettings(MOD.id, { autoRestrict: true })).error === 'owner_only');
t('settings: owner needs code to weaken; validation', (await C.saveSettings(OW.id, { autoRestrict: true })).error === 'code_required' && (await C.saveSettings(OW.id, { reviewScore: 80, seriousScore: 85 })).error === 'bad_settings');
// автоограничение
await C.saveSettings(OW.id, { autoRestrict: true }, { codeOk: true });
const auto = await chan('auto', { desc: 'Продажа наркотиков и оружия, мефедрон', posts: ['Куплю мефедрон, доставка, цена, пиши в лс t.me/a', 'Продам пистолет и патроны, цена, пиши в лс t.me/b', 'Ваш аккаунт заблокирован, перейдите и введите пароль, оплата сразу, t.me/x', 'В наличии гашиш, скидка, t.me/c', 'Продам автомат оптом, доставка, оплата', 'Закладки мефедрон кокаин цена оплата t.me/d'] });
r = await C.scanChannel(auto);
t('auto-restrict (when owner enabled it) freezes only very serious', r.case && (await query("SELECT status FROM chan_mod_cases WHERE id = $1", [r.case])).rows[0].status === 'restricted' && (await query("SELECT 1 FROM acct_freezes WHERE target_id = $1 AND status='active'", [auto])).rowCount === 1);
await C.saveSettings(OW.id, { autoRestrict: false }, { codeOk: true });
t('sweep runs without error', (await C.sweepChannels()) >= 0);
console.log(`chanmod: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
