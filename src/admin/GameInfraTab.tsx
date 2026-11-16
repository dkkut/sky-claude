/**
 * Вкладка «Игровые серверы» (право `game_infra`): аудит ресурсов, хосты, серверы Minecraft/GTA, запуск/остановка/перезапуск, состояние и нагрузка, доступ, журналы, копии.
 * Сервер: server/gameinfra.mjs. Серверы исполняет агент на игровом хосте; на основном сервере Sky — только после подтверждения владельца (с кодом).
 * GTA: подготовка инфраструктуры (учёт, лимиты, порт, копии) — запуск не автоматизирован, совместимость с модификациями не заявляется.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/gameinfra';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ST: Record<string, string> = { stopped: 'Остановлен', starting: 'Запускается', running: 'Работает', stopping: 'Останавливается', error: 'Ошибка' };
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Это действие — только для владельца.', agent_offline: 'Агент хоста не на связи — команда не поставлена.', main_host_not_confirmed: 'Запуск на основном сервере Sky не подтверждён владельцем.',
  insufficient_resources: 'Не хватает свободных ресурсов с запасом для основных сервисов.', launch_not_supported: 'Запуск этого вида серверов не автоматизирован.', bad_state: 'В этом состоянии так сделать нельзя.', stop_first: 'Сначала остановите сервер.',
  command_in_progress: 'Для сервера уже выполняется команда.', eula_required: 'Нужно принять лицензионное соглашение Minecraft.', bad_limit: 'Проверьте лимиты.', bad_config: 'Проверьте настройки.', host_required: 'Выберите хост.',
  main_exists: 'Основной сервер уже добавлен.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов.', person_not_found: 'Человек не найден.', secret_not_set: 'GAMEINFRA_SECRET не задан на сервере.', no_free_port: 'Нет свободных портов.',
};
const errText = (d?: Data, e?: string) => ((ERR[d?.error ?? e ?? ''] ?? `Не получилось (${d?.error ?? e})`) + (d?.field ? ` Поле: ${d.field}.` : '') + (d?.reasons?.length ? ` ${d.reasons.join('; ')}.` : ''));
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Box = ({ title, children }: { title: string; children: ReactNode }) => <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>;
const Stat = ({ k, v }: { k: string; v: ReactNode }) => <div className="rounded-xl px-3 py-2" style={{ background: C.l2 }}><p className="text-[11px]" style={{ color: C.t3 }}>{k}</p><p className="text-sm font-bold" style={{ color: C.t1 }}>{v}</p></div>;
const In = ({ label, value, onChange, w = 'w-full' }: { label: string; value: unknown; onChange: (v: string) => void; w?: string }) => <label className="block text-[11px]" style={{ color: C.t3 }}>{label}<input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} /></label>;

/** Код владельца для критических действий: сначала запрос кода, затем выполнение. */
const useCode = () => {
  const [ask, setAsk] = useState<((code: string) => Promise<void>) | null>(null); const [code, setCode] = useState('');
  const need = async (run: (code: string) => Promise<void>) => { const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: '{}' }); if (!r.ok) { flash(errText(r.data, r.error)); return; } setCode(''); setAsk(() => run); };
  const form = ask && (
    <div className="flex gap-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Код аутентификатора" aria-label="Код подтверждения" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.2em]" style={field} />
      <Btn disabled={code.length < 6} onClick={() => { const f = ask; setAsk(null); void f(code); }}>Подтвердить</Btn><Btn tone="plain" onClick={() => setAsk(null)}>Отмена</Btn></div>);
  return { need, form };
};

export const GameInfraTab = () => {
  const [d, setD] = useState<Data | null>(null); const [open, setOpen] = useState<Data | null>(null); const [failed, setFailed] = useState('');
  const [nf, setNf] = useState<Data>({ kind: 'minecraft', name: '', hostId: '', type: 'PAPER', version: 'LATEST', maxPlayers: 20, eula: false, platform: 'fivem', cpu: 1, ramMb: 2048, diskMb: 10240, players: 20 });
  const [hf, setHf] = useState({ name: '', kind: 'dedicated' }); const [fit, setFit] = useState<Data | null>(null); const [uname, setUname] = useState('');
  const { need, form } = useCode();
  const load = useCallback(async () => { const r = await apiCall<Data>(A); if (r.ok) { setD(r.data ?? {}); setFailed(''); } else setFailed(errText(r.data, r.error)); }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(t); }, [load]);
  const detail = useCallback(async (id: string) => { const r = await apiCall<Data>(`${A}/servers/${id}`); if (r.ok) setOpen(r.data ?? null); }, []);
  const act = async (id: string, a: string) => { const r = await apiCall<Data>(`${A}/servers/${id}/${a}`, { method: 'POST', body: '{}' }); if (!r.ok || r.data?.error) flash(errText(r.data, r.error)); else flash('Команда поставлена в очередь'); void load(); void detail(id); };
  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const au = d.audit as Data; const main = d.mainHost as Data; const owner = Boolean(d.owner);
  const limits = { cpu: Number(nf.cpu), ramMb: Number(nf.ramMb), diskMb: Number(nf.diskMb), players: Number(nf.players) };
  const create = async () => {
    const config = nf.kind === 'minecraft' ? { type: nf.type, version: nf.version, maxPlayers: Number(nf.maxPlayers), eulaAccepted: Boolean(nf.eula) } : { platform: nf.platform, notes: nf.notes ?? '' };
    const r = await apiCall<Data>(`${A}/servers`, { method: 'POST', body: JSON.stringify({ kind: nf.kind, name: nf.name, hostId: nf.hostId, config, limits }) });
    if (!r.ok || r.data?.error) flash(errText(r.data, r.error)); else { flash(`Сервер создан, порт ${r.data?.port}`); setNf({ ...nf, name: '' }); void load(); }
  };
  const checkFit = async () => { const r = await apiCall<Data>(`${A}/fit`, { method: 'POST', body: JSON.stringify({ limits }) }); setFit(r.ok ? r.data ?? null : null); if (!r.ok) flash(errText(r.data, r.error)); };
  const ownerPost = (path: string, body: Data, okText: string) => need(async (stepUpCode) => { const r = await apiCall<Data>(path, { method: 'POST', body: JSON.stringify({ ...body, stepUpCode }) }); if (!r.ok || r.data?.error) flash(errText(r.data, r.error)); else { flash(okText); if (r.data?.key) window.prompt('Ключ агента (скопируйте и уберите с экрана):', r.data.key); void load(); } });
  const s = open?.server as Data | undefined;
  return (
    <div className="space-y-4">
      {form}
      <Box title="Аудит ресурсов (то, что видит процесс API на основном сервере)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat k="CPU" v={`${au.cpu.cores} ядер · нагрузка ${au.cpu.load1} / ${au.cpu.load5} / ${au.cpu.load15}`} />
          <Stat k="Память" v={`свободно ${au.memory.availableMb} из ${au.memory.containerLimitMb ?? au.memory.totalMb} МБ`} />
          {(au.disks as Data[]).map((x) => <Stat key={x.path} k={`Диск ${x.path}`} v={`свободно ${x.freeGb} из ${x.totalGb} ГБ`} />)}
          <Stat k="Процессов" v={au.processes ?? '—'} />
          <Stat k="Сеть" v={(au.network.interfaces as Data[]).map((i) => `${i.name}${i.speedMbps ? ` ${i.speedMbps} Мбит/с` : ''}`).join(', ') || '—'} />
        </div>
        <p className="text-[11px]" style={{ color: C.t3 }}>{au.network.note}</p>
        <p className="text-xs font-bold" style={{ color: main.verdict === 'possible_with_limits' ? C.amber : C.red }}>{main.verdict === 'possible_with_limits' ? 'Основной сервер: небольшой игровой сервер возможен только с лимитами и после подтверждения владельца.' : 'Основной сервер: запускать игры на нём не рекомендуется.'}</p>
        {(main.reasons as string[]).map((r) => <p key={r} className="text-[11px]" style={{ color: C.t3 }}>{r}</p>)}
        <p className="text-[11px]" style={{ color: C.t3 }}>{main.reserve} {main.note}</p>
      </Box>
      <Box title="Хосты">
        {(d.hosts as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Хостов нет. Добавьте отдельный игровой сервер или (с подтверждением владельца) основной.</p>}
        {(d.hosts as Data[]).map((h) => (
          <div key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <span className="font-bold" style={{ color: C.t1 }} translate="no">{h.name}</span><span>{h.kind === 'main' ? 'основной сервер Sky' : 'отдельный хост'}</span>
            <span style={{ color: h.online ? C.green : C.red }}>{h.online ? 'агент на связи' : 'агент не на связи'}</span>
            {h.kind === 'main' && <span>{h.mainConfirmed ? 'запуск подтверждён владельцем' : 'запуск не подтверждён'}</span>}
            {owner && h.kind === 'main' && (h.mainConfirmed ? <Btn tone="red" onClick={() => void ownerPost(`${A}/hosts/${h.id}/revoke-main`, {}, 'Подтверждение отозвано')}>Отозвать</Btn> : <Btn onClick={() => void ownerPost(`${A}/hosts/${h.id}/confirm-main`, {}, 'Запуск на основном сервере подтверждён')}>Подтвердить запуск здесь</Btn>)}
            {owner && <Btn tone="plain" onClick={() => void ownerPost(`${A}/hosts/${h.id}/key`, {}, 'Ключ показан')}>Ключ агента</Btn>}
          </div>))}
        {owner && <div className="flex flex-wrap items-end gap-2"><In label="Название хоста" value={hf.name} onChange={(v) => setHf({ ...hf, name: v })} w="w-48" />
          <select value={hf.kind} onChange={(e) => setHf({ ...hf, kind: e.target.value })} className="rounded-lg px-2 py-1.5 text-sm" style={field} aria-label="Вид хоста"><option value="dedicated">Отдельный хост</option><option value="main">Основной сервер Sky</option></select>
          <Btn onClick={() => void ownerPost(`${A}/hosts`, hf, 'Хост добавлен')}>Добавить хост</Btn></div>}
      </Box>
      <Box title="Новый сервер">
        <div className="flex flex-wrap gap-2">
          <label className="text-[11px]" style={{ color: C.t3 }}>Вид<select value={nf.kind} onChange={(e) => setNf({ ...nf, kind: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}><option value="minecraft">Minecraft</option><option value="gta">GTA (только подготовка)</option></select></label>
          <label className="text-[11px]" style={{ color: C.t3 }}>Хост<select value={nf.hostId} onChange={(e) => setNf({ ...nf, hostId: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}><option value="">—</option>{(d.hosts as Data[]).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          <In label="Название" value={nf.name} onChange={(v) => setNf({ ...nf, name: v })} w="w-44" />
          {nf.kind === 'minecraft' ? <>
            <label className="text-[11px]" style={{ color: C.t3 }}>Тип<select value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>{(d.mcTypes as string[]).map((t) => <option key={t}>{t}</option>)}</select></label>
            <In label="Версия (LATEST или 1.21.4)" value={nf.version} onChange={(v) => setNf({ ...nf, version: v })} w="w-32" /><In label="Игроков" value={nf.maxPlayers} onChange={(v) => setNf({ ...nf, maxPlayers: v })} w="w-20" /></> :
            <label className="text-[11px]" style={{ color: C.t3 }}>Платформа (метка для учёта)<select value={nf.platform} onChange={(e) => setNf({ ...nf, platform: e.target.value })} className="mt-0.5 block rounded-lg px-2 py-1.5 text-sm" style={field}>{(d.gtaPlatforms as string[]).map((t) => <option key={t}>{t}</option>)}</select></label>}
          <In label="CPU, ядер" value={nf.cpu} onChange={(v) => setNf({ ...nf, cpu: v })} w="w-20" /><In label="Память, МБ" value={nf.ramMb} onChange={(v) => setNf({ ...nf, ramMb: v })} w="w-24" /><In label="Диск, МБ" value={nf.diskMb} onChange={(v) => setNf({ ...nf, diskMb: v })} w="w-28" />
        </div>
        {nf.kind === 'minecraft' && <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={Boolean(nf.eula)} onChange={(e) => setNf({ ...nf, eula: e.target.checked })} />Я принимаю лицензионное соглашение Minecraft (EULA) от имени владельца сервера</label>}
        {nf.kind === 'gta' && <p className="text-[11px]" style={{ color: C.t3 }}>GTA: Sky готовит хост, порт, лимиты и копии, но запуск серверного ПО не автоматизирован — совместимость с модификациями и платформами не заявляется.</p>}
        <div className="flex gap-2"><Btn disabled={!nf.hostId || nf.name.length < 2} onClick={() => void create()}>Создать</Btn><Btn tone="plain" onClick={() => void checkFit()}>Проверить запас ресурсов</Btn></div>
        {fit && <p className="text-xs" style={{ color: fit.fits ? C.green : C.red }}>{fit.fits ? 'Основной сервер выдержит эти лимиты с запасом.' : `Основной сервер не выдержит: ${(fit.reasons as string[]).join('; ')}.`}</p>}
      </Box>
      <Box title="Серверы">
        {(d.servers as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Серверов нет.</p>}
        {(d.servers as Data[]).map((x) => (
          <button key={x.id} type="button" onClick={() => void detail(x.id)} className="flex w-full flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-left text-sm" style={{ background: C.l2, color: C.t1 }}>
            <span className="font-bold" translate="no">{x.name}</span><span className="text-xs" style={{ color: C.t3 }}>{x.kind === 'gta' ? 'GTA' : 'Minecraft'} · порт {x.port}</span><span className="text-xs" style={{ color: x.status === 'running' ? C.green : x.status === 'error' ? C.red : C.t2 }}>{ST[x.status]}</span></button>))}
      </Box>
      {open && s && (
        <Box title={`Сервер: ${s.name}`}>
          <div className="flex flex-wrap gap-2"><Btn disabled={s.kind === 'gta'} onClick={() => void act(s.id, 'start')}>Запустить</Btn><Btn tone="plain" onClick={() => void act(s.id, 'stop')}>Остановить</Btn><Btn tone="plain" disabled={s.kind === 'gta'} onClick={() => void act(s.id, 'restart')}>Перезапустить</Btn>
            <Btn tone="plain" onClick={() => void act(s.id, 'backup')}>Резервная копия</Btn><Btn tone="plain" onClick={() => void act(s.id, 'logs')}>Обновить журнал сервера</Btn>
            {owner && <Btn tone="red" onClick={() => void need(async (stepUpCode) => { const r = await apiCall<Data>(`${A}/servers/${s.id}`, { method: 'DELETE', body: JSON.stringify({ stepUpCode }) }); if (!r.ok || r.data?.error) flash(errText(r.data, r.error)); else { setOpen(null); void load(); } })}>Удалить запись</Btn>}</div>
          {s.lastError && <p className="text-xs" style={{ color: C.red }} translate="no">{s.lastError}</p>}
          <p className="text-[11px]" style={{ color: C.t3 }}>{`Лимиты: CPU ${s.limits.cpu}, память ${s.limits.ramMb} МБ, диск ${s.limits.diskMb} МБ (квота: при превышении сервер останавливается). Файлы и копии на хосте при удалении записи не стираются.`}</p>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Нагрузка (последние замеры)</p>
          <div className="flex h-16 items-end gap-0.5">{(open.samples as Data[]).map((m, i) => <div key={i} title={`CPU ${m.cpu_pct}% · ${m.mem_mb} МБ · игроков ${m.players ?? '—'}`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, Math.min(100, Number(m.cpu_pct) || 0))}%`, background: C.acc, minWidth: 2 }} />)}{(open.samples as Data[]).length === 0 && <p className="text-[11px]" style={{ color: C.t3 }}>Замеров пока нет.</p>}</div>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Резервные копии</p>{(open.backups as Data[]).map((b) => <p key={b.id} className="text-[11px]" style={{ color: C.t2 }} translate="no">{`${new Date(b.created_at).toLocaleString('ru-RU')} · ${(Number(b.bytes) / 1e6).toFixed(1)} МБ · ${String(b.sha256).slice(0, 12)}`}</p>)}
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Журнал сервера</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl p-2 text-[11px]" style={{ background: C.l2, color: C.t2 }} translate="no">{(open.logs as Data[]).map((l) => l.line).join('\n') || 'Пусто — запросите журнал.'}</pre>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Команды</p>{(open.commands as Data[]).slice(0, 8).map((c) => <p key={c.id} className="text-[11px]" style={{ color: C.t2 }} translate="no">{`${new Date(c.created_at).toLocaleString('ru-RU')} · ${c.action} · ${c.state}${c.output ? ` — ${String(c.output).slice(0, 120)}` : ''}`}</p>)}
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Доступ</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>Пока список пуст, сервер доступен всем с правом «Игровые серверы». Как только в списке появляется человек, остальные сервер не видят.</p>
          {(open.access as Data[]).map((a) => <p key={a.profileId} className="text-[11px]" style={{ color: C.t2 }} translate="no">{`@${a.username} — ${a.level === 'operate' ? 'управление' : 'просмотр'}`}</p>)}
          {owner && <div className="flex flex-wrap items-end gap-2"><In label="@ник" value={uname} onChange={setUname} w="w-40" />
            {(['operate', 'view', 'none'] as const).map((lv) => <Btn key={lv} tone="plain" disabled={!uname} onClick={() => void ownerPost(`${A}/servers/${s.id}/access`, { username: uname, level: lv }, 'Доступ изменён').then(() => detail(s.id))}>{lv === 'operate' ? 'Управление' : lv === 'view' ? 'Просмотр' : 'Убрать'}</Btn>)}</div>}
        </Box>)}
    </div>
  );
};
