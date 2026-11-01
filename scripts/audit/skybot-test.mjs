// Официальный бот Sky (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/skybot-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const bot = await import('../../server/skybot.mjs');
const chats = await import('../../server/chats.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log('✗', n); } };

const sid = `sky-bt-${Date.now()}`; const pid = `acc-bt-${Date.now()}`;
await query(`INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,TRUE)`, [sid, `${sid}@t.test`]);
await query(`INSERT INTO profiles (id, sky_id, username, name) VALUES ($1,$2,$3,'Тест')`, [pid, sid, `bt${Date.now()}`]);

const m1 = await bot.sendFromBot(pid, 'привет', { kind: 'info' });
t('сообщение отправлено', m1 && m1.id);
const chatId = chats.directChatId(pid, bot.SKYBOT_PROFILE);
const list = await chats.listMessages(chatId, pid, 10, null);
t('человек видит сообщение в истории', Array.isArray(list) && list.some((x) => x.id === m1.id));
t('бот не создаёт дубликатов чата', (await query('SELECT count(*)::int n FROM chats WHERE id=$1', [chatId])).rows[0].n === 1);

const reply = await chats.saveMessage(chatId, pid, { id: 'mx1', text: 'ответ', kind: 'text' });
t('человек не может писать боту', reply?.error === 'bot_readonly');

await bot.botLoginCode([pid], '123456');
const codeMsgs = await chats.listMessages(chatId, pid, 10, null);
t('код входа пришёл', codeMsgs.some((x) => String(x.text).includes('123456')));
await query(`UPDATE skybot_ephemeral SET delete_at = now() - interval '1 minute'`);
await bot.sweepSkyBot();
const after = await chats.listMessages(chatId, pid, 10, null);
t('код исчез после срока', !after.some((x) => String(x.text).includes('123456')));
t('обычное сообщение осталось', after.some((x) => x.id === m1.id));

t('вход в Sky ID', (await bot.botSignIn(sid, { ip: '203.0.113.7', ua: 'Test UA' }, { newDevice: true })) === 1);
t('неверный код', (await bot.botBadCode(sid, { left: 3, ip: '203.0.113.7' })) === 1);
t('неверный код не чаще раза в 10 минут', (await bot.botBadCode(sid, { left: 2 })) === null);
t('отклонённый вход', (await bot.botLoginRejected(sid, 'frozen', { ip: '203.0.113.7', ua: 'x' })) === 1);
t('код передан в чат', !!(await bot.botCodeShared(pid, 1)));
t('рассылка', (await bot.botBroadcast([pid], 'Заголовок', 'Текст')) === 1);

const all = (await chats.listMessages(chatId, pid, 50, null)).map((x) => String(x.text)).join('\n');
t('IP замаскирован', all.includes('203.0.113.*') && !all.includes('203.0.113.7'));

await query('DELETE FROM messages WHERE chat_id=$1', [chatId]); await query('DELETE FROM chat_members WHERE chat_id=$1', [chatId]); await query('DELETE FROM chats WHERE id=$1', [chatId]);
await query('DELETE FROM profiles WHERE id=$1', [pid]); await query('DELETE FROM sky_ids WHERE id=$1', [sid]);
console.log(`skybot: ${ok} ok, ${bad} fail`);
await pool.end(); process.exit(bad ? 1 : 0);
