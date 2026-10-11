// Игровые серверы: права, сообщения, голос, баны, закрытые серверы.
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0;
const t = (name, cond, extra = '') => { if (cond) ok++; else { bad++; console.log('FAIL', name, extra); } };

const A = await mkuser(S, 'GsA'); const B = await mkuser(S, 'GsB'); const Cc = await mkuser(S, 'GsC');
const j = (o) => JSON.stringify(o);

let r = await call('/api/gaming/servers', { method: 'POST', body: j({ name: 'Test Squad', icon: '🔫', isPublic: true }) }, A.tok);
t('создание сервера', r.status === 201 && r.data.id?.startsWith('gsv-'), r.text);
const sid = r.data.id;

r = await call(`/api/gaming/servers/${sid}`, {}, A.tok);
t('владелец видит устройство', r.status === 200 && r.data.channels.length === 3 && r.data.server.myRole === 'owner' && r.data.server.inviteCode, r.text);
const chans = r.data.channels;
const text = chans.find((c) => c.type === 'text'), ann = chans.find((c) => c.type === 'announce'), voice = chans.find((c) => c.type === 'voice');

r = await call('/api/gaming/servers', {}, B.tok);
t('открытый виден постороннему', r.data.open.some((s) => s.id === sid) && r.data.mine.length === 0, r.text);
r = await call(`/api/gaming/servers/${sid}`, {}, B.tok);
t('не участник — 403', r.status === 403, r.text);
r = await call(`/api/gaming/channels/${text.id}/messages`, {}, B.tok);
t('не участник не читает', r.status === 403);
r = await call(`/api/gaming/channels/${text.id}/messages`, { method: 'POST', body: j({ text: 'hi' }) }, B.tok);
t('не участник не пишет', r.status === 403);

r = await call(`/api/gaming/servers/${sid}/join`, { method: 'POST', body: '{}' }, B.tok);
t('вступление в открытый', r.status === 200 && r.data.joined === true, r.text);
r = await call(`/api/gaming/servers/${sid}`, {}, B.tok);
t('участник видит, без кода приглашения', r.status === 200 && r.data.server.myRole === 'member' && !r.data.server.inviteCode && r.data.server.members === 2, r.text);

r = await call(`/api/gaming/channels/${text.id}/messages`, { method: 'POST', body: j({ text: '  привет  ' }) }, B.tok);
t('сообщение участника', r.status === 201 && r.data.message.text === 'привет', r.text);
const mB = r.data.message;
r = await call(`/api/gaming/channels/${text.id}/messages`, {}, A.tok);
t('владелец читает сообщение', r.data.messages.some((m) => m.id === mB.id), r.text);
r = await call(`/api/gaming/channels/${text.id}/messages`, { method: 'POST', body: j({ text: '' }) }, B.tok);
t('пустое — 400', r.status === 400);
r = await call(`/api/gaming/channels/${text.id}/messages`, { method: 'POST', body: j({ text: 'x'.repeat(2001) }) }, B.tok);
t('слишком длинное — 400', r.status === 400 && r.data.error === 'too_long');
r = await call(`/api/gaming/channels/${ann.id}/messages`, { method: 'POST', body: j({ text: 'флуд' }) }, B.tok);
t('в объявления участник не пишет', r.status === 403 && r.data.error === 'announce_only', r.text);
r = await call(`/api/gaming/channels/${ann.id}/messages`, { method: 'POST', body: j({ text: 'Правила' }) }, A.tok);
t('в объявления владелец пишет', r.status === 201, r.text);
r = await call(`/api/gaming/channels/${voice.id}/messages`, { method: 'POST', body: j({ text: 'x' }) }, A.tok);
t('в голосовой писать нельзя', r.status === 400 && r.data.error === 'voice_channel');

r = await call(`/api/gaming/servers/${sid}/channels`, { method: 'POST', body: j({ name: 'флуд', type: 'text' }) }, B.tok);
t('участник не создаёт канал', r.status === 403);
r = await call(`/api/gaming/servers/${sid}/channels`, { method: 'POST', body: j({ name: 'Cs2 Тактики!!', type: 'text' }) }, A.tok);
t('владелец создаёт канал', r.status === 201, r.text);
const newCh = r.data.id;
r = await call(`/api/gaming/servers/${sid}`, {}, A.tok);
t('имя канала очищено', r.data.channels.some((c) => c.id === newCh && c.name === 'cs2-тактики'), JSON.stringify(r.data.channels.map((c) => c.name)));
r = await call(`/api/gaming/channels/${newCh}`, { method: 'DELETE' }, B.tok);
t('участник не удаляет канал', r.status === 403);
r = await call(`/api/gaming/channels/${newCh}`, { method: 'DELETE' }, A.tok);
t('владелец удаляет канал', r.status === 200);

// удаление сообщений
r = await call(`/api/gaming/channels/${text.id}/messages`, { method: 'POST', body: j({ text: 'от владельца' }) }, A.tok);
const mA = r.data.message;
r = await call(`/api/gaming/messages/${mA.id}`, { method: 'DELETE' }, B.tok);
t('чужое сообщение участник не удалит', r.status === 403);
r = await call(`/api/gaming/messages/${mB.id}`, { method: 'DELETE' }, B.tok);
t('своё удаляется', r.status === 200);
r = await call(`/api/gaming/messages/${mA.id}`, { method: 'DELETE' }, Cc.tok);
t('посторонний не удаляет', r.status === 403);

// голос
r = await call(`/api/gaming/channels/${text.id}/voice`, { method: 'POST', body: '{}' }, B.tok);
t('голос на текстовом — 400', r.status === 400 && r.data.error === 'not_voice', r.text);
r = await call(`/api/gaming/channels/${voice.id}/voice`, { method: 'POST', body: '{}' }, Cc.tok);
t('голос постороннему — 403', r.status === 403);
const [v1, v2] = await Promise.all([
  call(`/api/gaming/channels/${voice.id}/voice`, { method: 'POST', body: '{}' }, A.tok),
  call(`/api/gaming/channels/${voice.id}/voice`, { method: 'POST', body: '{}' }, B.tok)]);
t('голос: одна комната на двоих одновременно', v1.status === 200 && v2.status === 200 && v1.data.roomId === v2.data.roomId && /^vp-/.test(v1.data.roomId), v1.text + v2.text);
r = await call('/api/voiceparty/rooms', {}, Cc.tok);
t('комната голоса не торчит в общем списке', !r.data.live.some((x) => x.id === v1.data.roomId));

// роли, бан
r = await call(`/api/gaming/servers/${sid}/members/${B.pid}/role`, { method: 'POST', body: j({ role: 'moderator' }) }, B.tok);
t('участник не назначает модераторов', r.status === 403);
r = await call(`/api/gaming/servers/${sid}/members/${A.pid}`, { method: 'DELETE' }, B.tok);
t('участник не исключает', r.status === 403);
r = await call(`/api/gaming/servers/${sid}/members/${A.pid}`, { method: 'DELETE' }, A.tok);
t('владельца не исключить', r.status === 403);
r = await call(`/api/gaming/servers/${sid}/leave`, { method: 'POST', body: '{}' }, A.tok);
t('владелец не может уйти', r.status === 409);
r = await call(`/api/gaming/servers/${sid}/members/${B.pid}?ban=1`, { method: 'DELETE', body: '{}' }, A.tok);
t('бан', r.status === 200, r.text);
r = await call(`/api/gaming/servers/${sid}`, {}, B.tok);
t('забаненный не видит', r.status === 403);
r = await call(`/api/gaming/servers/${sid}/join`, { method: 'POST', body: '{}' }, B.tok);
t('забаненный не вступит', r.status === 403 && r.data.error === 'banned', r.text);
r = await call('/api/gaming/servers', {}, B.tok);
t('забаненному сервер не предлагают', !r.data.open.some((s) => s.id === sid));

// закрытый
r = await call('/api/gaming/servers', { method: 'POST', body: j({ name: 'Secret', isPublic: false }) }, A.tok);
const priv = r.data.id;
r = await call('/api/gaming/servers', {}, Cc.tok);
t('закрытый не в списке', !r.data.open.some((s) => s.id === priv));
r = await call(`/api/gaming/servers/${priv}/join`, { method: 'POST', body: '{}' }, Cc.tok);
t('закрытый без кода — 403', r.status === 403 && r.data.error === 'private_server');
r = await call(`/api/gaming/servers/${priv}`, {}, A.tok);
const code = r.data.server.inviteCode;
r = await call('/api/gaming/servers/join-code', { method: 'POST', body: j({ code: 'ZZZZZZZZZZ' }) }, Cc.tok);
t('неверный код', r.status === 400);
r = await call('/api/gaming/servers/join-code', { method: 'POST', body: j({ code: code.toLowerCase() }) }, Cc.tok);
t('вход по коду', r.status === 200 && r.data.serverId === priv, r.text);
r = await call(`/api/gaming/servers/${priv}`, { method: 'DELETE' }, Cc.tok);
t('участник не удаляет сервер', r.status === 403);
r = await call(`/api/gaming/servers/${priv}/leave`, { method: 'POST', body: '{}' }, Cc.tok);
t('участник уходит', r.status === 200);
r = await call(`/api/gaming/servers/${priv}`, { method: 'DELETE' }, A.tok);
t('владелец удаляет сервер', r.status === 200);
r = await call(`/api/gaming/servers/${priv}`, {}, A.tok);
t('удалённого нет', r.status === 404);

r = await call('/api/gaming/servers', { method: 'POST', body: j({ name: 'x' }) }, A.tok);
t('короткое имя — 400', r.status === 400);
r = await call('/api/gaming/servers', {});
t('без входа — 401', r.status === 401);

console.log(`ИТОГО: ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
