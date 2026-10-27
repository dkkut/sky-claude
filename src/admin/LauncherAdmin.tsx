import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { fmtBytes } from '@/launcher/api';

const j = (b: unknown) => JSON.stringify(b);
const get = <T,>(p: string) => apiCall<T>(p);
const post = (p: string, b: unknown = {}) => apiCall<any>(p, { method: 'POST', body: j(b) });
const put = (p: string, b: unknown = {}) => apiCall<any>(p, { method: 'PUT', body: j(b) });
const del = (p: string) => apiCall<any>(p, { method: 'DELETE' });
const inp = 'rounded-lg border bg-transparent px-2 py-1 text-[12px]'; const st = { borderColor: 'var(--border)', color: 'var(--t1)' } as const;
const btn = 'rounded-full border px-3 py-1 text-[12px]';
const STATUS: Record<string, string> = { draft: 'Черновик', awaiting_payment: 'Ожидает оплаты', pending_review: 'На проверке', needs_changes: 'Нужны исправления', published: 'Опубликована', rejected: 'Отклонена', unpublished: 'Снята', blocked: 'Заблокирована' };
const ERR: Record<string, string> = { reason_required: 'Нужна причина (от 5 знаков)', self_review: 'Свою игру решать нельзя', bad_status: 'Сейчас это действие недоступно', no_submitted_build: 'Нет отправленной сборки', build_infected: 'Сборка не прошла антивирус', forbidden: 'Недостаточно прав' };

const Games = ({ canMod, canCfg }: { canMod: boolean; canCfg: boolean }) => {
  const [rows, setRows] = useState<any[] | null>(null); const [status, setStatus] = useState(''); const [q, setQ] = useState(''); const [open, setOpen] = useState<any>(null); const [msg, setMsg] = useState(''); const [reason, setReason] = useState('');
  const load = useCallback(async () => { const r = await get<{ games: any[] }>(`/api/admin/launcher/games?status=${status}&q=${encodeURIComponent(q)}`); setRows(r.ok ? r.data?.games ?? [] : []); }, [status, q]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t); }, [load]);
  const show = async (id: string) => { const r = await get<any>(`/api/admin/launcher/games/${id}`); if (r.ok) { setOpen(r.data); setMsg(''); setReason(''); } };
  const decide = async (decision: string) => { const r = await post(`/api/admin/launcher/games/${open.game.id}/decide`, { decision, note: reason }); setMsg(r.ok ? 'Готово' : ERR[r.error ?? ''] ?? 'Не удалось'); if (r.ok) { void show(open.game.id); void load(); } };
  const decideB = async (bid: string, decision: string) => { const r = await post(`/api/admin/launcher/builds/${bid}/decide`, { decision, note: reason }); setMsg(r.ok ? 'Готово' : ERR[r.error ?? ''] ?? 'Не удалось'); if (r.ok) void show(open.game.id); };
  if (open) {
    const g = open.game;
    return (
      <div className="grid gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>
        <button type="button" className="w-fit underline" onClick={() => setOpen(null)}>← К списку</button>
        <b className="text-[15px]" style={{ color: 'var(--t1)' }} translate="no">{g.title}</b>
        <p>Статус: <b>{STATUS[g.status] ?? g.status}</b>{g.statusNote ? ` — ${g.statusNote}` : ''} · жанры: {g.genres.join(', ') || '—'} · разработчик: <span translate="no">{g.developer || '—'}</span></p>
        <p className="whitespace-pre-wrap" translate="no">{g.descr}</p>
        <p>Заказы: {open.orders.map((o: any) => `${o.amountRub} ₽ (${({ paid: 'оплачен', refunded: 'возвращён', created: 'создан', failed: 'ошибка' } as Record<string, string>)[o.status]})`).join(', ') || 'нет'}</p>
        <div><b style={{ color: 'var(--t1)' }}>Сборки</b>{open.builds.map((b: any) => <div key={b.id} className="mt-1 flex flex-wrap items-center gap-2"><span translate="no">{b.version}</span><span>{b.channel} · {b.status}{b.blocked ? ' · заблокирована' : ''} · {b.fileCount} файлов · {fmtBytes(b.totalBytes)} · антивирус: {b.scanStatus}</span>
          {canMod && b.status === 'submitted' && g.status === 'published' && <><button type="button" className={btn} onClick={() => void decideB(b.id, 'approve')}>Одобрить</button><button type="button" className={btn} onClick={() => void decideB(b.id, 'reject')}>Отклонить</button></>}
          {canMod && !b.blocked && ['published', 'approved', 'submitted'].includes(b.status) && <button type="button" className={btn} style={{ color: '#f87171' }} onClick={() => void decideB(b.id, 'block')}>Остановить</button>}</div>)}</div>
        {canMod && <div className="grid gap-2"><input className={inp} style={st} placeholder="Причина / комментарий (обязательно для отказа, доработки, снятия, блокировки)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {g.status === 'pending_review' && <><button type="button" className={btn} onClick={() => void decide('approve')}>Одобрить и опубликовать</button><button type="button" className={btn} onClick={() => void decide('needs_changes')}>Запросить исправления</button></>}
            {['pending_review', 'needs_changes'].includes(g.status) && <button type="button" className={btn} style={{ color: '#f87171' }} onClick={() => void decide('reject')}>Отклонить (плата вернётся)</button>}
            {g.status === 'published' && <button type="button" className={btn} onClick={() => void decide('unpublish')}>Снять с публикации</button>}
            {g.status === 'unpublished' && <button type="button" className={btn} onClick={() => void decide('republish')}>Опубликовать снова</button>}
            {g.status !== 'blocked' && <button type="button" className={btn} style={{ color: '#f87171' }} onClick={() => void decide('block')}>Заблокировать</button>}
            {g.status === 'blocked' && <button type="button" className={btn} onClick={() => void decide('unblock')}>Снять блокировку</button>}
            {canCfg && g.status === 'published' && <button type="button" className={btn} onClick={async () => { await post(`/api/admin/launcher/games/${g.id}/featured`, { on: !g.featured }); void show(g.id); }}>{g.featured ? 'Убрать из подборки' : 'В подборку Sky'}</button>}
          </div></div>}
        {msg && <p role="status">{msg}</p>}
        <div><b style={{ color: 'var(--t1)' }}>Журнал решений</b>{open.log.slice(0, 15).map((l: any, i: number) => <p key={i} className="text-[11px]" translate="no">{new Date(l.at).toLocaleString()} · {l.action}{l.note ? ` · ${l.note}` : ''}</p>)}</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
      <div className="flex flex-wrap gap-2"><select className={inp} style={st} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input className={inp} style={st} placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {rows === null ? <p>Загрузка…</p> : rows.length === 0 ? <p>Игр нет.</p> : rows.map((g) => <button key={g.id} type="button" onClick={() => void show(g.id)} className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-left" style={{ borderColor: 'var(--border)' }}><b style={{ color: 'var(--t1)' }} translate="no">{g.title}</b><span>{STATUS[g.status] ?? g.status}</span><span translate="no">@{g.owner}</span><span>{g.orderStatus ? `${g.amountRub} ₽ · ${g.orderStatus}` : 'без заказа'}</span><span>в библиотеках: {g.library}</span></button>)}
    </div>
  );
};

const Servers = ({ canCfg }: { canCfg: boolean }) => {
  const [rows, setRows] = useState<any[] | null>(null); const [kind, setKind] = useState(''); const [msg, setMsg] = useState('');
  const blank = { kind: 'minecraft', platform: 'paper', name: '', host: '', port: 25565, version: '', mode: '', region: '', descr: '', status: 'draft', statusSource: 'ping', note: '', passwordRequired: false };
  const [f, setF] = useState<any>(null); const [doc, setDoc] = useState(''); const [plan, setPlan] = useState<any>(null); const [batch, setBatch] = useState('');
  const load = useCallback(async () => { const r = await get<{ servers: any[] }>(`/api/admin/launcher/servers?kind=${kind}`); setRows(r.ok ? r.data?.servers ?? [] : []); }, [kind]);
  useEffect(() => { void load(); }, [load]);
  const PL: Record<string, string[]> = { gta: ['fivem', 'ragemp'], minecraft: ['vanilla', 'paper', 'fabric', 'forge'] };
  const save = async () => {
    const body = { kind: f.kind, platform: f.platform, name: f.name, host: f.host, port: Number(f.port), version: f.version, mode: f.mode, region: f.region, descr: f.descr, status: f.status, statusSource: f.platform === 'ragemp' ? 'none' : f.statusSource, params: { note: f.note, passwordRequired: f.passwordRequired } };
    const r = f.id ? await put(`/api/admin/launcher/servers/${f.id}`, body) : await post('/api/admin/launcher/servers', body);
    if (!r.ok) { setMsg(r.error === 'duplicate' ? 'Сервер с таким адресом уже есть' : (r.data?.errors?.join('; ') ?? 'Не удалось сохранить')); return; } setF(null); setMsg('Сохранено'); void load();
  };
  const preview = async () => { let d: unknown; try { d = JSON.parse(doc); } catch { setMsg('Это не JSON'); return; } const r = await post('/api/admin/launcher/import/preview', { doc: d }); if (r.ok || r.data?.items) setPlan(r.data); setMsg(r.ok ? '' : (r.data?.errors?.join('; ') ?? 'В файле есть ошибки')); if (!r.ok && r.data?.items) setPlan(r.data); };
  const apply = async () => { const r = await post('/api/admin/launcher/import/apply', { doc: JSON.parse(doc) }); if (r.ok) { setBatch(r.data.batch); setPlan(null); setMsg(`Применено (${r.data.counts.create} новых, ${r.data.counts.update} изменено). Пакет для отката: ${r.data.batch}`); void load(); } else setMsg('Не удалось применить'); };
  return (
    <div className="grid gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>
      <div className="flex flex-wrap items-center gap-2"><select className={inp} style={st} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">GTA V и Minecraft</option><option value="gta">GTA V</option><option value="minecraft">Minecraft</option></select>{canCfg && <button type="button" className={btn} onClick={() => setF({ ...blank })}>+ Новый сервер</button>}</div>
      {msg && <p role="status">{msg}</p>}
      {f && <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2"><select className={inp} style={st} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, platform: PL[e.target.value][0], port: e.target.value === 'gta' ? 30120 : 25565 })}><option value="gta">GTA V</option><option value="minecraft">Minecraft</option></select><select className={inp} style={st} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{PL[f.kind].map((p) => <option key={p}>{p}</option>)}</select></div>
        <input className={inp} style={st} placeholder="Название" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="flex gap-2"><input className={`${inp} flex-1`} style={st} placeholder="Адрес (домен или IP, без схемы и порта)" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} /><input className={`${inp} w-24`} style={st} type="number" min={1} max={65535} value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2"><input className={inp} style={st} placeholder="Версия" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /><input className={inp} style={st} placeholder="Режим" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} /><input className={inp} style={st} placeholder="Регион" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} /></div>
        <textarea className={inp} style={st} rows={3} placeholder="Описание" maxLength={600} value={f.descr} onChange={(e) => setF({ ...f, descr: e.target.value })} />
        <input className={inp} style={st} placeholder="Примечание для игроков" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <div className="flex flex-wrap items-center gap-3"><label><input type="checkbox" checked={f.passwordRequired} onChange={(e) => setF({ ...f, passwordRequired: e.target.checked })} /> Нужен пароль</label>
          <label>Статус: <select className={inp} style={st} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="draft">Черновик</option><option value="published">Опубликован</option><option value="hidden">Скрыт</option></select></label>
          <label>Источник статуса: <select className={inp} style={st} value={f.platform === 'ragemp' ? 'none' : f.statusSource} disabled={f.platform === 'ragemp'} onChange={(e) => setF({ ...f, statusSource: e.target.value })}><option value="ping">Проверка сервера</option><option value="none">Нет</option></select></label></div>
        {f.platform === 'ragemp' && <p>Для RAGE MP публичного протокола статуса нет — онлайн и число игроков не показываются.</p>}
        <div className="flex gap-2"><button type="button" className={btn} onClick={() => void save()}>Сохранить</button><button type="button" className={btn} onClick={() => setF(null)}>Отмена</button></div></div>}
      {rows === null ? <p>Загрузка…</p> : rows.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-2" style={{ borderColor: 'var(--border)' }}>
        <b style={{ color: 'var(--t1)' }} translate="no">{s.name}</b><span translate="no">{s.host}:{s.port}</span><span>{s.platform} · {s.status}</span>
        <span>{s.statusKnown ? (s.online ? `онлайн ${s.players ?? '?'}/${s.maxPlayers ?? '?'}` : 'не отвечает') : 'не проверялся'}{s.lastError ? ` · ошибка: ${s.lastError}` : ''}</span>
        {canCfg && <><button type="button" className={btn} onClick={() => setF({ ...blank, id: s.id, kind: s.kind, platform: s.platform, name: s.name, host: s.host, port: s.port, version: s.version, mode: s.mode, region: s.region, descr: s.descr, status: s.status, statusSource: s.statusSource, note: s.params?.note ?? '', passwordRequired: s.params?.passwordRequired === true })}>Изменить</button>
          <button type="button" className={btn} onClick={async () => { const r = await post(`/api/admin/launcher/servers/${s.id}/probe`); setMsg(r.ok ? (r.data.online ? `Онлайн: ${r.data.players}/${r.data.max}` : `Не отвечает: ${r.data.error}`) : 'Слишком часто или нет доступа'); void load(); }}>Проверить</button>
          <button type="button" className={btn} style={{ color: '#f87171' }} onClick={async () => { if (window.confirm(`Удалить «${s.name}»?`)) { await del(`/api/admin/launcher/servers/${s.id}`); void load(); } }}>Удалить</button></>}</div>)}
      {canCfg && <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
        <b style={{ color: 'var(--t1)' }}>Импорт конфигурации (JSON)</b>
        <p>{'Формат: {"schema":1,"servers":[{"kind":"minecraft","platform":"paper","name":"…","host":"play.example.com","port":25565,"version":"1.20.1","mode":"Survival","region":"RU","status":"draft","statusSource":"ping"}]}. До 200 записей, 256 КБ; неизвестные поля отклоняют файл; сначала предпросмотр, затем применение; применённый пакет можно откатить.'}</p>
        <textarea className={inp} style={st} rows={6} placeholder="Вставьте JSON" value={doc} onChange={(e) => { setDoc(e.target.value); setPlan(null); }} />
        <div className="flex gap-2"><button type="button" className={btn} onClick={() => void preview()}>Предпросмотр</button>{plan?.ok && <button type="button" className={btn} onClick={() => void apply()}>Применить</button>}</div>
        {plan && <div>{plan.items.map((i: any) => <p key={i.index} style={{ color: i.action === 'error' ? '#f87171' : undefined }} translate="no">#{i.index + 1} {i.action === 'create' ? `создать «${i.name}»` : i.action === 'update' ? `изменить «${i.name}»: ${i.changed.join(', ')}` : i.action === 'unchanged' ? `без изменений «${i.name}»` : `ошибка: ${i.errors.join('; ')}`}</p>)}</div>}
        <div className="flex gap-2"><input className={`${inp} flex-1`} style={st} placeholder="Номер пакета для отката (lib-…)" value={batch} onChange={(e) => setBatch(e.target.value)} /><button type="button" className={btn} onClick={async () => { if (!batch) return; const r = await post('/api/admin/launcher/import/rollback', { batch }); setMsg(r.ok ? `Откат выполнен (${r.data.reverted})` : ({ changed_since: 'После импорта записи правились — откат невозможен', already_rolled_back: 'Уже откатывался', not_found: 'Пакет не найден' } as Record<string, string>)[r.error ?? ''] ?? 'Не удалось'); void load(); }}>Откатить</button></div>
      </div>}
    </div>
  );
};

const Misc = ({ canCfg }: { canCfg: boolean }) => {
  const [q, setQ] = useState<any>(null); const [owners, setOwners] = useState<any[]>([]); const [probe, setProbe] = useState<{ enabled: boolean; intervalMin: number } | null>(null);
  useEffect(() => { void get<any>('/api/admin/launcher/queues').then((r) => r.ok && setQ(r.data)); void get<any>('/api/admin/launcher/owners').then((r) => r.ok && setOwners(r.data?.owners ?? [])); if (canCfg) void get<any>('/api/admin/launcher/settings').then((r) => r.ok && setProbe(r.data?.probe)); }, [canCfg]);
  return (
    <div className="grid gap-4 text-[12px]" style={{ color: 'var(--t2)' }}>
      {probe && <section><b style={{ color: 'var(--t1)' }}>Проверка серверов</b><div className="mt-1 flex flex-wrap items-center gap-3"><label><input type="checkbox" checked={probe.enabled} onChange={async (e) => { const v = { ...probe, enabled: e.target.checked }; setProbe(v); await put('/api/admin/launcher/settings', v); }} /> Включена</label>
        <label>Интервал, мин: <input className={`${inp} w-16`} style={st} type="number" min={2} max={60} value={probe.intervalMin} onChange={(e) => setProbe({ ...probe, intervalMin: Number(e.target.value) })} onBlur={async () => { await put('/api/admin/launcher/settings', probe); }} /></label></div><p>Проверяются только опубликованные серверы с источником «проверка сервера», порциями и не при высокой нагрузке.</p></section>}
      {q && <section><b style={{ color: 'var(--t1)' }}>Очередь сборок и хранилище</b><p>Файлов в хранилище: {q.storage.blobs} · объём: {fmtBytes(q.storage.bytes)}</p>
        {q.builds.length === 0 ? <p>Очередь пуста.</p> : q.builds.map((b: any) => <p key={b.id} translate="no">{b.game} · {b.version} · {b.status}{b.error ? ` · ${b.error}` : ''} · {fmtBytes(b.bytes)}</p>)}</section>}
      <section><b style={{ color: 'var(--t1)' }}>Владельцы игр</b>{owners.length === 0 ? <p>Нет.</p> : owners.map((o) => <p key={o.id} translate="no">@{o.username} · игр: {o.games} (опубликовано {o.published}) · оплачено {o.paid} ₽ · возвращено {o.refunded} ₽</p>)}</section>
    </div>
  );
};

/** Админка «Лаунчер»: заявки и игры (право launcher_moderation), серверы GTA V/Minecraft, очереди и настройки (право launcher). */
export const LauncherAdminTab = ({ canMod, canCfg }: { canMod: boolean; canCfg: boolean }) => {
  const [t, setT] = useState<'games' | 'servers' | 'misc'>(canMod ? 'games' : 'servers');
  return (
    <div className="p-4">
      <div className="mb-3 flex gap-2">{([['games', 'Игры и заявки', canMod || canCfg], ['servers', 'Серверы GTA V / Minecraft', canCfg], ['misc', 'Очереди и владельцы', true]] as const).filter((x) => x[2]).map(([k, l]) => <button key={k} type="button" onClick={() => setT(k)} className={btn} style={{ borderColor: t === k ? 'var(--accent)' : 'var(--border)', color: 'var(--t1)' }}>{l}</button>)}</div>
      {t === 'games' && <Games canMod={canMod} canCfg={canCfg} />}{t === 'servers' && <Servers canCfg={canCfg} />}{t === 'misc' && <Misc canCfg={canCfg} />}
    </div>
  );
};
