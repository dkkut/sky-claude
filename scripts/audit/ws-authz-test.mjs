import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkuser } from './lib.mjs';
const require = createRequire(new URL('../../server/', import.meta.url));
const WebSocket = require('ws');
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let passes = 0, fails = 0;
const ok = (c, m, extra = '') => { if (c) { passes++; console.log('ok  ', m); } else { fails++; console.log('FAIL', m, extra); } };
const A = await mkuser(S, 'wza'), B = await mkuser(S, 'wzb'), X = await mkuser(S, 'wzx');
const open = (u) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: 'http://localhost:4173' } });
  ws.events = []; ws.on('message', d => { try { ws.events.push(JSON.parse(d)); } catch {} });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: u.tok } })));
  const t = setInterval(() => { if (ws.events.some(e => e.type === 'snapshot-done')) { clearInterval(t); res(ws); } }, 100);
  setTimeout(() => rej(new Error('auth timeout')), 8000);
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const send = (ws, type, payload) => ws.send(JSON.stringify({ type, payload }));
const wa = await open(A), wb = await open(B), wx = await open(X);
const dm = 'dm-' + [A.pid, B.pid].sort().join('~');
send(wa, 'create-chat', { chat: { id: dm, type: 'direct', name: '', participants: [B.pid] } }); await sleep(800);
const SECRET = 'СЕКРЕТНОЕ-' + Date.now();
const mid = 'm-' + Date.now();
send(wa, 'send-message', { chatId: dm, message: { id: mid, text: SECRET, type: 'text', timestamp: Date.now() } }); await sleep(600);
wx.events.length = 0;
const seen = () => JSON.stringify(wx.events);
// посторонний X пытается всё подряд
send(wx, 'get-messages', { chatId: dm, limit: 50 });
send(wx, 'send-message', { chatId: dm, message: { id: 'm-x' + Date.now(), text: 'ВЗЛОМ', type: 'text', timestamp: Date.now() } });
send(wx, 'edit-message', { messageId: mid, text: 'ВЗЛОМ-ПРАВКА' });
send(wx, 'react-message', { messageId: mid, emoji: '💀' });
send(wx, 'read-messages', { chatId: dm });
send(wx, 'add-member', { chatId: dm, userId: X.pid });
send(wx, 'pin-message', { chatId: dm, messageId: mid });
send(wx, 'favorite-message', { chatId: dm, messageId: mid });
send(wx, 'poll-vote', { chatId: dm, messageId: mid, option: 0 });
send(wx, 'consume-once', { chatId: dm, messageId: mid });
send(wx, 'chat-flags', { chatId: dm, flags: { pinned: true } });
send(wx, 'mark-unread', { chatId: dm });
send(wx, 'viewed', { chatId: dm, messageId: mid });
send(wx, 'chat-admin', { chatId: dm, action: 'set-role', userId: X.pid, role: 'admin' });
send(wx, 'chat-admin', { chatId: dm, action: 'rename', name: 'pwn' });
send(wx, 'leave-chat', { chatId: dm });
send(wx, 'delete-message', { messageId: mid });
send(wx, 'delete-chat', { chatId: dm });
send(wx, 'restore-chat', { chatId: dm });
send(wx, 'typing', { chatId: dm, active: true });
await sleep(1500);
ok(!seen().includes(SECRET), 'посторонний не получил текст чужой переписки');
ok(q(`select count(*) from messages where chat_id='${dm}'`) === '1', 'посторонний не добавил сообщений');
ok(q(`select edited_at is null from messages where id='${mid}'`) === 't', 'посторонний не изменил текст (нет метки правки)');
ok(q(`select count(*) from chat_members where chat_id='${dm}'`) === '2', 'посторонний не вошёл в чат');
ok(q(`select trashed_at is null from chats where id='${dm}'`) === 't', 'посторонний не убрал чат в корзину');
ok(q(`select count(*) from messages where id='${mid}'`) === '1', 'посторонний не удалил сообщение');
ok(q(`select coalesce(count(*),0) from message_reactions where message_id='${mid}'`) === '0', 'посторонний не поставил реакцию');
// и участник B видит оригинальный текст без следов
const hist = wb.events.length; wb.events.length = 0; send(wb, 'get-messages', { chatId: dm, limit: 50 }); await sleep(700);
ok(JSON.stringify(wb.events).includes(SECRET) && !JSON.stringify(wb.events).includes('ВЗЛОМ'), 'участник видит историю без чужих вставок');
// участник чата не может удалить чужое сообщение и редактировать чужое
wb.events.length = 0;
send(wb, 'edit-message', { messageId: mid, text: 'B-ПРАВИТ-ЧУЖОЕ' }); send(wb, 'delete-message', { messageId: mid }); await sleep(800);
ok(q(`select edited_at is null from messages where id='${mid}'`) === 't' && q(`select count(*) from messages where id='${mid}'`) === '1', 'участник не правит и не удаляет чужое сообщение');
// мусор вместо типов/полей
for (const bad of [null, [], 'x', 123, { chatId: { $ne: 1 } }, { chatId: 'a'.repeat(5000) }, { chatId: dm, limit: -1 }, { chatId: dm, limit: 1e9, before: {} }]) {
  for (const t of ['get-messages', 'send-message', 'create-chat', 'edit-message', 'chat-admin', 'add-member']) { try { wa.send(JSON.stringify({ type: t, payload: bad })); } catch {} }
}
await sleep(1500);
const alive = await new Promise((r) => { wa.events.length = 0; send(wa, 'ping', {}); setTimeout(() => r(wa.events.some((e) => e.type === 'pong')), 800); });
ok(alive, 'сервер жив и отвечает после потока мусорных кадров');
// огромный кадр
try { wa.send(JSON.stringify({ type: 'send-message', payload: { chatId: dm, message: { id: 'm-big' + Date.now(), text: 'я'.repeat(5_000_000) } } })); } catch {}
await sleep(1500);
ok(wa.readyState === 1 || wa.readyState === 3, 'огромный кадр: соединение закрыто или обработано, сервер не упал');
const hz = await fetch('http://127.0.0.1:8080/healthz').then((r) => r.status).catch(() => 0);
ok(hz === 200, 'healthz = 200 после всех атак');
console.log(`\nИТОГО: ${passes} ok, ${fails} FAIL`);
process.exit(0);
