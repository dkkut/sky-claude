import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Star, Search, Wifi, WifiOff, Users, Copy, ExternalLink, History, Plus, Trash2, RotateCcw } from 'lucide-react';
import { lApi, type ServerKind, type LServer, type ConnectInfo, type LProfile } from './api';
import { Pill, Btn, Note, Spinner, ErrorBox, GLASS, input, inputStyle } from './ui';
import { visibleTick } from '@/shared/visibleTick';

const PLATFORM: Record<string, string> = { fivem: 'FiveM', ragemp: 'RAGE MP', vanilla: 'Vanilla', paper: 'Paper', fabric: 'Fabric', forge: 'Forge' };
const ago = (iso: string | null) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 90 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : `${Math.round(s / 3600)} ч назад`; };

const Status = ({ s }: { s: LServer }) => {
  if (!s.statusKnown || s.online === null) return <span className="text-[11px]" style={{ color: 'var(--t3)' }}>Статус неизвестен</span>;
  return s.online
    ? <span className="flex items-center gap-1 text-[11px]" style={{ color: '#34d399' }}><Wifi size={12} /> Онлайн{s.players !== null ? ` · ${s.players}${s.maxPlayers ? `/${s.maxPlayers}` : ''}` : ''}<span style={{ color: 'var(--t3)' }}> · {ago(s.checkedAt)}</span></span>
    : <span className="flex items-center gap-1 text-[11px]" style={{ color: '#f87171' }}><WifiOff size={12} /> Не отвечает<span style={{ color: 'var(--t3)' }}> · {ago(s.checkedAt)}</span></span>;
};

const ConnectDialog = ({ s, info, onClose }: { s: LServer; info: ConnectInfo | { error: string }; onClose: () => void }) => {
  const [copied, setCopied] = useState(false);
  if ('error' in info) return <div role="dialog" className="rounded-2xl p-4" style={GLASS}><p className="text-[13px]" style={{ color: '#fca5a5' }}>Не удалось подготовить подключение. Попробуйте ещё раз.</p><Btn kind="ghost" onClick={onClose}>Закрыть</Btn></div>;
  const copy = async () => { try { await navigator.clipboard.writeText(info.address); setCopied(true); } catch { setCopied(false); } };
  return (
    <div role="dialog" aria-label={`Подключение к ${s.name}`} className="mt-3 flex flex-col gap-2 rounded-2xl p-4" style={GLASS}>
      <p className="text-[13px]" style={{ color: 'var(--t1)' }}>Адрес: <b translate="no">{info.address}</b>{info.passwordRequired ? ' · нужен пароль' : ''}</p>
      <p className="text-[12px]" style={{ color: 'var(--t2)' }}>{info.instructions}</p>
      <div className="flex flex-wrap gap-2">
        <Btn kind="ghost" onClick={() => void copy()}><Copy size={13} className="mr-1 inline" />{copied ? 'Скопировано' : 'Скопировать адрес'}</Btn>
        {info.launchSupported && info.uri && <Btn onClick={() => { window.location.href = info.uri!; }}><ExternalLink size={13} className="mr-1 inline" />Открыть клиент</Btn>}
        <Btn kind="ghost" onClick={onClose}>Закрыть</Btn>
      </div>
      {info.launchSupported && <Note>Если ничего не произошло — клиент не установлен или не зарегистрировал ссылку. Sky не скачивает игру и не может проверить это заранее.</Note>}
    </div>
  );
};

const Row = ({ s, onFav, onConnect, open }: { s: LServer; onFav: () => void; onConnect: () => void; open: React.ReactNode }) => (
  <li className="rounded-2xl p-3" style={GLASS}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]" style={{ color: 'var(--t1)' }} translate="no">{s.name}</b>
          <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'rgba(139,92,246,.2)', color: '#c4b5fd' }}>{PLATFORM[s.platform] ?? s.platform}</span>
          {s.version && <span className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{s.version}</span>}</div>
        <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{s.descr}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><Status s={s} />{s.mode && <span className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{s.mode}</span>}{s.region && <span className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{s.region}</span>}{s.passwordRequired && <span className="text-[11px]" style={{ color: '#fbbf24' }}>пароль</span>}</div>
      </div>
      <button type="button" onClick={onFav} aria-label={s.favorite ? 'Убрать из избранного' : 'В избранное'} aria-pressed={s.favorite}><Star size={18} fill={s.favorite ? '#fbbf24' : 'none'} style={{ color: s.favorite ? '#fbbf24' : 'var(--t3)' }} /></button>
    </div>
    <div className="mt-2"><Btn onClick={onConnect}>Подключиться</Btn></div>
    {open}
  </li>
);

const ProfilesPanel = ({ kind }: { kind: ServerKind }) => {
  const [list, setList] = useState<LProfile[] | null>(null); const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ id?: string; name: string; version: string; memoryMb: number; jvm: string; platform: string; gamePath: string } | null>(null);
  const load = useCallback(async () => { const r = await lApi.profiles(kind); setList(r.ok ? r.data?.profiles ?? [] : []); }, [kind]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!edit) return; setErr('');
    const data = kind === 'minecraft' ? { version: edit.version, memoryMb: Number(edit.memoryMb), jvmArgs: edit.jvm.split(/\s+/).filter(Boolean) } : { platform: edit.platform, gamePath: edit.gamePath };
    const r = await lApi.saveProfile({ id: edit.id, kind, name: edit.name, data });
    if (!r.ok) { const m: Record<string, string> = { bad_version: 'Версия: только буквы, цифры, точки и дефисы', bad_memory: 'Память: от 512 до 16384 МБ', bad_jvm_args: 'Недопустимый параметр JVM. Разрешены только безопасные флаги сборщика мусора и кодировки', bad_path: 'В пути есть запрещённые символы', name_required: 'Введите название', too_many: 'Не больше 20 профилей' }; setErr(m[r.error ?? ''] ?? 'Не удалось сохранить'); return; }
    setEdit(null); void load();
  };
  return (
    <section className="rounded-2xl p-3" style={GLASS} aria-label="Игровые профили">
      <div className="mb-2 flex items-center gap-2"><b className="flex-1 text-[14px]" style={{ color: 'var(--t1)' }}>Игровые профили</b><Btn kind="ghost" onClick={() => setEdit({ name: '', version: '1.20.1', memoryMb: 2048, jvm: '', platform: 'fivem', gamePath: '' })}><Plus size={13} className="mr-1 inline" />Новый</Btn></div>
      {list === null ? <Spinner /> : list.length === 0 ? <Note>Профилей пока нет. Профиль хранит версию, память и допустимые параметры запуска — отдельно для каждой сборки.</Note>
        : list.map((p) => <div key={p.id} className="flex items-center gap-2 py-1.5 text-[13px]" style={{ color: 'var(--t1)' }}>
          <span className="min-w-0 flex-1 truncate" translate="no">{p.name} <span style={{ color: 'var(--t3)' }}>· {kind === 'minecraft' ? `${p.data.version}, ${p.data.memoryMb} МБ` : PLATFORM[p.data.platform]}</span></span>
          <button type="button" aria-label="Изменить" onClick={() => setEdit({ id: p.id, name: p.name, version: p.data.version ?? '1.20.1', memoryMb: p.data.memoryMb ?? 2048, jvm: (p.data.jvmArgs ?? []).join(' '), platform: p.data.platform ?? 'fivem', gamePath: p.data.gamePath ?? '' })}>✎</button>
          <button type="button" aria-label="Сбросить настройки профиля" title="Сбросить настройки" onClick={async () => { if (window.confirm(`Сбросить настройки профиля «${p.name}»? Другие профили не изменятся.`)) { await lApi.resetProfile(p.id); void load(); } }}><RotateCcw size={14} /></button>
          <button type="button" aria-label="Удалить" onClick={async () => { if (window.confirm(`Удалить профиль «${p.name}»? Миры и сохранения на вашем компьютере не удаляются.`)) { await lApi.deleteProfile(p.id); void load(); } }}><Trash2 size={14} /></button>
        </div>)}
      {edit && (
        <div className="mt-2 grid gap-2">
          <input className={input} style={inputStyle} placeholder="Название профиля" maxLength={40} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          {kind === 'minecraft' ? <>
            <input className={input} style={inputStyle} placeholder="Версия Minecraft, например 1.20.1" value={edit.version} onChange={(e) => setEdit({ ...edit, version: e.target.value })} />
            <label className="text-[12px]" style={{ color: 'var(--t2)' }}>Память: {edit.memoryMb} МБ<input type="range" min={512} max={16384} step={256} value={edit.memoryMb} onChange={(e) => setEdit({ ...edit, memoryMb: Number(e.target.value) })} className="w-full" /></label>
            <input className={input} style={inputStyle} placeholder="Параметры JVM (необязательно): -XX:+UseG1GC" value={edit.jvm} onChange={(e) => setEdit({ ...edit, jvm: e.target.value })} />
          </> : <>
            <select className={input} style={inputStyle} value={edit.platform} onChange={(e) => setEdit({ ...edit, platform: e.target.value })}><option value="fivem">FiveM</option><option value="ragemp">RAGE MP</option></select>
            <input className={input} style={inputStyle} placeholder="Папка с клиентом (необязательно)" value={edit.gamePath} onChange={(e) => setEdit({ ...edit, gamePath: e.target.value })} />
          </>}
          {err && <p role="alert" className="text-[12px]" style={{ color: '#fca5a5' }}>{err}</p>}
          <div className="flex gap-2"><Btn onClick={() => void save()}>Сохранить</Btn><Btn kind="ghost" onClick={() => { setEdit(null); setErr(''); }}>Отмена</Btn></div>
        </div>)}
    </section>
  );
};

/** Каталог серверов GTA V или Minecraft: поиск, фильтры, избранное, история, подключение, профили. Опрашивает сервер только пока экран виден. */
export const ServersSection = ({ kind }: { kind: ServerKind }) => {
  const [q, setQ] = useState(''); const [mode, setMode] = useState(''); const [region, setRegion] = useState(''); const [platform, setPlatform] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false); const [favOnly, setFavOnly] = useState(false); const [tab, setTab] = useState<'all' | 'history'>('all');
  const [list, setList] = useState<LServer[] | null>(null); const [err, setErr] = useState(false); const [hist, setHist] = useState<LServer[]>([]);
  const [facets, setFacets] = useState<{ modes: string[]; regions: string[]; platforms: string[] }>({ modes: [], regions: [], platforms: [] });
  const [conn, setConn] = useState<{ id: string; info: ConnectInfo | { error: string } } | null>(null);
  const abort = useRef(0);
  const load = useCallback(async () => {
    const my = ++abort.current;
    const r = await lApi.servers({ kind, q, mode, region, platform, onlineOnly: onlineOnly ? 1 : '', favoritesOnly: favOnly ? 1 : '' });
    if (my !== abort.current) return;   // устаревший ответ
    setErr(!r.ok); if (r.ok) setList(r.data?.servers ?? []);
  }, [kind, q, mode, region, platform, onlineOnly, favOnly]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t); }, [load]);
  useEffect(() => { const t = window.setInterval(visibleTick(() => void load()), 60000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => { void lApi.facets(kind).then((r) => r.ok && r.data && setFacets(r.data)); }, [kind]);
  const loadHist = useCallback(async () => { const r = await lApi.history(); if (r.ok) setHist((r.data?.history ?? []).filter((h) => h.kind === kind)); }, [kind]);
  useEffect(() => { if (tab === 'history') void loadHist(); }, [tab, loadHist]);
  const fav = async (s: LServer) => { const r = await lApi.favorite(s.id, !s.favorite); if (r.ok) { const patch = (x: LServer) => (x.id === s.id ? { ...x, favorite: !s.favorite } : x); setList((l) => l && l.map(patch)); setHist((h) => h.map(patch)); } };
  const connect = async (s: LServer) => { const r = await lApi.connect(s.id); setConn({ id: s.id, info: r.ok ? r.data : { error: r.error ?? 'failed' } }); };
  const rows = tab === 'history' ? hist : list;
  const sel = 'rounded-full border bg-transparent px-3 py-1.5 text-[12px]';
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border px-3 py-1.5" style={{ borderColor: 'rgba(167,139,250,.25)' }}><Search size={14} style={{ color: 'var(--t3)' }} /><input aria-label="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название сервера" className="w-full bg-transparent text-[13px] outline-none" style={{ color: 'var(--t1)' }} /></label>
        <Pill on={tab === 'all'} onClick={() => setTab('all')}>Каталог</Pill><Pill on={tab === 'history'} onClick={() => setTab('history')}><History size={12} className="mr-1 inline" />История</Pill>
      </div>
      {tab === 'all' && <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Режим" className={sel} style={inputStyle} value={mode} onChange={(e) => setMode(e.target.value)}><option value="">Все режимы</option>{facets.modes.map((m) => <option key={m} value={m.toLowerCase()}>{m}</option>)}</select>
        <select aria-label="Регион" className={sel} style={inputStyle} value={region} onChange={(e) => setRegion(e.target.value)}><option value="">Все регионы</option>{facets.regions.map((m) => <option key={m} value={m.toLowerCase()}>{m}</option>)}</select>
        <select aria-label="Платформа" className={sel} style={inputStyle} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">Все платформы</option>{facets.platforms.map((m) => <option key={m} value={m}>{PLATFORM[m] ?? m}</option>)}</select>
        <Pill on={onlineOnly} onClick={() => setOnlineOnly((v) => !v)}>Только онлайн</Pill><Pill on={favOnly} onClick={() => setFavOnly((v) => !v)}><Star size={12} className="mr-1 inline" />Избранные</Pill>
      </div>}
      {err && <ErrorBox text="Не удалось загрузить серверы." onRetry={() => void load()} />}
      {rows === null && !err ? <Spinner /> : rows && rows.length === 0 ? <Note>{tab === 'history' ? 'Вы ещё не подключались к серверам.' : 'Серверов не найдено. Каталог пополняет администрация Sky; показаны только реально проверенные данные.'}</Note>
        : <ul className="flex flex-col gap-3">{(rows ?? []).map((s) => <Row key={s.id} s={s} onFav={() => void fav(s)} onConnect={() => void connect(s)} open={conn?.id === s.id ? <ConnectDialog s={s} info={conn.info} onClose={() => setConn(null)} /> : null} />)}</ul>}
      {tab === 'history' && hist.length > 0 && <div className="mt-3"><Btn kind="ghost" onClick={async () => { await lApi.clearHistory(); setHist([]); }}>Очистить историю</Btn></div>}
      <div className="mt-4"><ProfilesPanel kind={kind} /></div>
      <div className="mt-3"><Note>{kind === 'gta' ? 'Sky не скачивает GTA V и клиенты FiveM/RAGE MP и не обходит их лицензирование: для подключения нужны установленная лицензионная игра и клиент.' : 'Sky не распространяет Minecraft и не хранит пароли: вход выполняется через официальный лаунчер Mojang/Microsoft. Число игроков берётся из прямой проверки сервера.'}</Note></div>
    </div>
  );
};
