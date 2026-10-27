import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Star, Download, Play, Pause, X, RefreshCw, ShieldCheck, Trash2, FolderOpen, Gamepad2 } from 'lucide-react';
import { lApi, fmtBytes, type GameCard, type GameFull } from './api';
import { useDownloads, launcherNative, isActive, type DlTask } from './native';
import { Pill, Btn, Note, Spinner, ErrorBox, GLASS, Bar, Back, input, inputStyle } from './ui';

/* ───── обложки: файлы берутся запросом с токеном; blob-ссылки кэшируются и освобождаются ───── */
const urlCache = new Map<string, string>();
const useMediaUrl = (id: string | null | undefined) => {
  const [u, setU] = useState<string | null>(id ? urlCache.get(id) ?? null : null);
  useEffect(() => { let on = true; if (!id) { setU(null); return undefined; } const c = urlCache.get(id); if (c) { setU(c); return undefined; }
    void lApi.media(id).then((x) => { if (x && on) { if (urlCache.size > 80) { const k = urlCache.keys().next().value as string; URL.revokeObjectURL(urlCache.get(k)!); urlCache.delete(k); } urlCache.set(id, x); setU(x); } }); return () => { on = false; }; }, [id]);
  return u;
};
export const Cover = ({ id, title, className = '' }: { id: string | null | undefined; title: string; className?: string }) => {
  const u = useMediaUrl(id);
  return u ? <img src={u} alt="" className={`object-cover ${className}`} loading="lazy" /> : <div aria-hidden className={`grid place-items-center ${className}`} style={{ background: 'linear-gradient(135deg,#312e81,#0c4a6e)' }}><span className="text-[22px] font-black" style={{ color: 'rgba(255,255,255,.7)' }}>{title.slice(0, 1)}</span></div>;
};

const Tile = ({ g, onOpen, state }: { g: GameCard; onOpen: () => void; state?: React.ReactNode }) => (
  <li>
    <button type="button" onClick={onOpen} className="w-full overflow-hidden rounded-2xl text-left" style={GLASS}>
      <Cover id={g.cover} title={g.title} className="h-28 w-full" />
      <div className="p-3"><b className="line-clamp-1 text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{g.title}</b>
        <p className="line-clamp-1 text-[11px]" style={{ color: 'var(--t3)' }}>{g.genres.join(', ') || '—'}{g.sizeBytes ? ` · ${fmtBytes(g.sizeBytes)}` : ''}</p>{state}</div>
    </button>
  </li>
);

/* ───── страница игры ───── */
const GameDetail = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [g, setG] = useState<GameFull | null>(null); const [err, setErr] = useState(false); const dl = useDownloads(); const native = Boolean(launcherNative());
  const load = useCallback(async () => { const r = await lApi.game(id); setErr(!r.ok); if (r.ok) setG(r.data?.game ?? null); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const [shot, setShot] = useState<string | null>(null); const shotUrl = useMediaUrl(shot);
  if (err) return <><Back onClick={onBack} title="Игра" /><ErrorBox text="Не удалось открыть страницу игры." onRetry={() => void load()} /></>;
  if (!g) return <><Back onClick={onBack} title="Игра" /><Spinner /></>;
  const inst = dl.installed[g.id]; const task = dl.tasks[g.id]; const hasUpdate = Boolean(inst && g.build && inst.version !== g.build.version); const running = dl.running.includes(g.id);
  const add = async () => { await lApi.addLib(g.id); void load(); };
  const pickAndInstall = async () => { const dir = await launcherNative()?.pickFolder(); if (dir) { const sep = dir.includes('\\') ? '\\' : '/'; await dl.call('install', g.id, { dir: `${dir}${sep}${g.id}` }); } };
  const launch = async () => { const r = await dl.call('launch', g.id); if (r?.ok) void lApi.event(g.id, 'launch'); else { void lApi.event(g.id, 'launch_fail'); window.alert(({ missing_files: 'Не хватает файлов игры. Проверьте целостность или переустановите.', spawn_failed: 'Не удалось запустить игру. Возможно, файл заблокирован антивирусом или повреждён.', already_running: 'Игра уже запущена.' } as Record<string, string>)[r?.error] ?? 'Не удалось запустить игру.'); } };
  const verify = async () => { const r = await dl.call('verify', g.id); window.alert(r?.ok ? `Проверено файлов: ${r.checked}. Всё в порядке.` : `Найдено проблем: ${r?.bad?.length ?? '?'}. Нажмите «Обновить» — докачаются только повреждённые файлы.`); };
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-24">
      <Back onClick={onBack} title={g.title} />
      <div className="px-4">
        <Cover id={g.cover} title={g.title} className="h-48 w-full rounded-2xl" />
        <div className="mt-3 flex flex-wrap gap-2">
          {!g.inLibrary ? <Btn onClick={() => void add()} disabled={g.status !== 'published'}>Добавить в библиотеку</Btn>
            : !native ? <Note>Установка и запуск игр доступны в приложении Sky для Windows. Игра сохранена в вашей библиотеке.</Note>
            : task && isActive(task) ? <TaskLine t={task} />
            : inst ? <>{hasUpdate ? <Btn onClick={() => void dl.call('update', g.id)}><RefreshCw size={13} className="mr-1 inline" />Обновить до {g.build?.version}</Btn> : null}
                <Btn onClick={() => void launch()} disabled={running}><Play size={13} className="mr-1 inline" />{running ? 'Запущена' : 'Играть'}</Btn>
                <Btn kind="ghost" onClick={() => void verify()}><ShieldCheck size={13} className="mr-1 inline" />Проверить файлы</Btn>
                <Btn kind="danger" onClick={async () => { if (window.confirm(`Удалить файлы «${g.title}» с этого компьютера? Игра останется в вашей библиотеке, сохранения в папке игры не удаляются.`)) { await dl.call('uninstall', g.id); void dl.refresh(); } }}><Trash2 size={13} className="mr-1 inline" />Удалить файлы</Btn></>
            : <><Btn onClick={() => void dl.call('install', g.id)} disabled={!g.build}><Download size={13} className="mr-1 inline" />Установить{g.build ? ` · ${fmtBytes(g.build.sizeBytes)}` : ''}</Btn><Btn kind="ghost" onClick={() => void pickAndInstall()}><FolderOpen size={13} className="mr-1 inline" />Выбрать папку…</Btn></>}
          {g.inLibrary && <Btn kind="ghost" onClick={async () => { await lApi.favGame(g.id, !g.favorite); void load(); }}><Star size={13} className="mr-1 inline" fill={g.favorite ? '#fbbf24' : 'none'} />{g.favorite ? 'В избранном' : 'В избранное'}</Btn>}
          {g.inLibrary && <Btn kind="ghost" onClick={async () => { if (window.confirm('Убрать игру из библиотеки? Установленные файлы останутся на компьютере.')) { await lApi.removeLib(g.id); void load(); } }}>Убрать из библиотеки</Btn>}
        </div>
        {task?.status === 'error' && <ErrorBox text={`Ошибка: ${({ no_space: 'недостаточно места на диске', hash_mismatch: 'файл не прошёл проверку контрольной суммы — установка не затронута', manifest_401: 'нужно войти заново', manifest_403: 'игры нет в вашей библиотеке', manifest_404: 'игра недоступна' } as Record<string, string>)[task.error ?? ''] ?? task.error}`} onRetry={() => void dl.call('resume', g.id)} />}
        <p className="mt-4 whitespace-pre-wrap text-[13px]" style={{ color: 'var(--t2)' }} translate="no">{g.descr}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]" style={{ color: 'var(--t2)' }}>
          <div><dt style={{ color: 'var(--t3)' }}>Разработчик</dt><dd translate="no">{g.developer || '—'}</dd></div><div><dt style={{ color: 'var(--t3)' }}>Издатель</dt><dd translate="no">{g.publisher || '—'}</dd></div>
          <div><dt style={{ color: 'var(--t3)' }}>Жанры</dt><dd>{g.genres.join(', ') || '—'}</dd></div><div><dt style={{ color: 'var(--t3)' }}>Платформы</dt><dd>{g.os.join(', ') || '—'}</dd></div>
          <div><dt style={{ color: 'var(--t3)' }}>Версия</dt><dd>{g.build?.version ?? '—'}{inst ? ` (у вас ${inst.version})` : ''}</dd></div><div><dt style={{ color: 'var(--t3)' }}>Размер загрузки</dt><dd>{fmtBytes(g.build?.sizeBytes)}</dd></div>
          <div><dt style={{ color: 'var(--t3)' }}>Обновлено</dt><dd>{g.build?.updatedAt ? new Date(g.build.updatedAt).toLocaleDateString() : '—'}</dd></div>
        </dl>
        {Object.keys(g.requirements).length > 0 && <section className="mt-3 rounded-2xl p-3" style={GLASS}><b className="text-[13px]" style={{ color: 'var(--t1)' }}>Системные требования</b>{Object.entries(g.requirements).map(([k, v]) => <p key={k} className="text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{({ os: 'ОС', cpu: 'Процессор', ram: 'Память', gpu: 'Видеокарта', disk: 'Место на диске', notes: 'Примечание' } as Record<string, string>)[k] ?? k}: {v}</p>)}</section>}
        {g.screenshots.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{g.screenshots.map((s) => <button key={s} type="button" onClick={() => setShot(s)} className="shrink-0"><Cover id={s} title="" className="h-24 w-40 rounded-xl" /></button>)}</div>}
        {shot && <div role="dialog" aria-label="Скриншот" className="fixed inset-0 z-[1000] grid place-items-center bg-black/80 p-4" onClick={() => setShot(null)}>{shotUrl && <img src={shotUrl} alt="" className="max-h-full max-w-full rounded-xl" />}</div>}
        {g.news.length > 0 && <section className="mt-3"><b className="text-[13px]" style={{ color: 'var(--t1)' }}>Новости</b>{g.news.map((n) => <div key={n.id} className="mt-2 rounded-2xl p-3" style={GLASS}><b className="text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{n.title}</b><p className="whitespace-pre-wrap text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{n.body}</p></div>)}</section>}
        {g.history.length > 0 && <section className="mt-3"><b className="text-[13px]" style={{ color: 'var(--t1)' }}>История обновлений</b>{g.history.map((h) => <p key={h.version + h.at} className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{h.version} · {new Date(h.at).toLocaleDateString()} · {fmtBytes(h.sizeBytes)}{h.notes ? ` — ${h.notes}` : ''}</p>)}</section>}
        <div className="mt-3 flex flex-wrap gap-3 text-[12px]">{g.links.site && <a href={g.links.site} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#7dd3fc' }}>Сайт игры</a>}{g.links.support && <a href={g.links.support} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#7dd3fc' }}>Поддержка</a>}</div>
        <p className="mt-3"><Note>Отзывов и оценок пока нет: в Sky Launcher нет системы отзывов с защитой от накрутки, и мы не показываем выдуманные рейтинги.</Note></p>
      </div>
    </div>
  );
};

const TaskLine = ({ t, compact }: { t: DlTask; compact?: boolean }) => {
  const dl = useDownloads(); const frac = t.totalBytes ? t.doneBytes / t.totalBytes : 0;
  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
        <span className="flex-1">{({ queued: 'В очереди', starting: 'Подготовка', downloading: 'Загрузка', applying: 'Применение', paused: 'Пауза', error: 'Ошибка', done: 'Готово', cancelled: 'Отменено' } as Record<string, string>)[t.status] ?? t.status}{t.totalBytes ? ` · ${fmtBytes(t.doneBytes)} из ${fmtBytes(t.totalBytes)}` : ''}{t.speed ? ` · ${fmtBytes(t.speed)}/с` : ''}{t.etaSec ? ` · ~${t.etaSec < 90 ? `${t.etaSec} с` : `${Math.round(t.etaSec / 60)} мин`}` : ''}</span>
        {isActive(t) && <button type="button" aria-label="Пауза" onClick={() => void dl.call('pause', t.gameId)}><Pause size={15} /></button>}
        {t.status === 'paused' && <button type="button" aria-label="Продолжить" onClick={() => void dl.call('resume', t.gameId)}><Play size={15} /></button>}
        {(isActive(t) || t.status === 'paused') && <button type="button" aria-label="Отмена" onClick={() => void dl.call('cancel', t.gameId)}><X size={15} /></button>}
      </div>
      {!compact && <Bar value={frac} />}
    </div>
  );
};

/* ───── магазин / библиотека / загрузки ───── */
const Store = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [q, setQ] = useState(''); const [genre, setGenre] = useState(''); const [sort, setSort] = useState('new');
  const [d, setD] = useState<{ games: GameCard[]; genres: string[] } | null>(null); const [err, setErr] = useState(false);
  const load = useCallback(async () => { const r = await lApi.catalog({ q, genre, sort }); setErr(!r.ok); if (r.ok) setD(r.data ?? null); }, [q, genre, sort]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(t); }, [load]);
  const featured = (d?.games ?? []).filter((g) => g.featured);
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border px-3 py-1.5" style={{ borderColor: 'rgba(167,139,250,.25)' }}><Search size={14} style={{ color: 'var(--t3)' }} /><input aria-label="Поиск игр" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск игр" className="w-full bg-transparent text-[13px] outline-none" style={{ color: 'var(--t1)' }} /></label>
        <select aria-label="Сортировка" className="rounded-full border bg-transparent px-3 py-1.5 text-[12px]" style={inputStyle} value={sort} onChange={(e) => setSort(e.target.value)}><option value="new">Новые</option><option value="updated">Недавно обновлённые</option><option value="title">По названию</option></select>
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto"><Pill on={!genre} onClick={() => setGenre('')}>Все</Pill>{(d?.genres ?? []).map((g) => <Pill key={g} on={genre === g} onClick={() => setGenre(g)}>{g}</Pill>)}</div>
      {err && <ErrorBox text="Не удалось загрузить каталог." onRetry={() => void load()} />}
      {!d && !err ? <Spinner /> : d && d.games.length === 0 ? <Note>В каталоге пока нет игр. Разработчики размещают игры через кабинет «Мои игры»; здесь появятся только прошедшие проверку.</Note> : <>
        {featured.length > 0 && !q && !genre && <section className="mb-4"><b className="mb-2 block text-[13px]" style={{ color: 'var(--t1)' }}>Подборка Sky</b><ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{featured.map((g) => <Tile key={g.id} g={g} onOpen={() => onOpen(g.id)} />)}</ul></section>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{d?.games.map((g) => <Tile key={g.id} g={g} onOpen={() => onOpen(g.id)} state={g.inLibrary ? <p className="mt-1 text-[11px]" style={{ color: '#34d399' }}>В библиотеке</p> : null} />)}</ul></>}
    </div>
  );
};

const Library = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const dl = useDownloads(); const [list, setList] = useState<GameCard[] | null>(null); const [err, setErr] = useState(false);
  const [sort, setSort] = useState('played'); const [filter, setFilter] = useState('all'); const [genre, setGenre] = useState(''); const [q, setQ] = useState('');
  const load = useCallback(async () => { const r = await lApi.library(); setErr(!r.ok); if (r.ok) setList(r.data?.library ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo(() => {
    let l = (list ?? []).filter((g) => (!q || g.title.toLowerCase().includes(q.toLowerCase())) && (!genre || g.genres.includes(genre)));
    const inst = (g: GameCard) => Boolean(dl.installed[g.id]); const upd = (g: GameCard) => Boolean(dl.installed[g.id] && g.version && dl.installed[g.id].version !== g.version);
    if (filter === 'installed') l = l.filter(inst); if (filter === 'notinstalled') l = l.filter((g) => !inst(g)); if (filter === 'updates') l = l.filter(upd); if (filter === 'fav') l = l.filter((g) => g.favorite);
    const by: Record<string, (a: GameCard, b: GameCard) => number> = { title: (a, b) => a.title.localeCompare(b.title), added: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)), played: (a, b) => String(b.lastPlayedAt ?? '').localeCompare(String(a.lastPlayedAt ?? '')), size: (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) };
    return [...l].sort(by[sort] ?? by.played);
  }, [list, sort, filter, genre, q, dl.installed]);
  const genres = useMemo(() => [...new Set((list ?? []).flatMap((g) => g.genres))], [list]);
  const sel = 'rounded-full border bg-transparent px-3 py-1.5 text-[12px]';
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-24">
      {!launcherNative() && <p className="mb-3"><Note>Это веб-версия: здесь можно управлять библиотекой. Установка и запуск игр — в приложении Sky для Windows.</Note></p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input aria-label="Поиск в библиотеке" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" className="min-w-[140px] flex-1 rounded-full border bg-transparent px-3 py-1.5 text-[13px]" style={inputStyle} />
        <select aria-label="Фильтр" className={sel} style={inputStyle} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Все</option><option value="installed">Установленные</option><option value="notinstalled">Не установленные</option><option value="updates">С обновлением</option><option value="fav">Избранные</option></select>
        <select aria-label="Жанр" className={sel} style={inputStyle} value={genre} onChange={(e) => setGenre(e.target.value)}><option value="">Все жанры</option>{genres.map((g) => <option key={g}>{g}</option>)}</select>
        <select aria-label="Сортировка" className={sel} style={inputStyle} value={sort} onChange={(e) => setSort(e.target.value)}><option value="played">По последнему запуску</option><option value="added">По дате добавления</option><option value="title">По названию</option><option value="size">По размеру</option></select>
      </div>
      {err && <ErrorBox text="Не удалось загрузить библиотеку." onRetry={() => void load()} />}
      {list === null && !err ? <Spinner /> : rows.length === 0 ? <Note>{(list ?? []).length ? 'Ничего не найдено.' : 'Библиотека пуста. Найдите игру в магазине и добавьте её — установка и покупка это разные вещи, добавленная игра остаётся у вас, даже если удалить файлы.'}</Note>
        : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{rows.map((g) => { const i = dl.installed[g.id]; const t = dl.tasks[g.id]; const upd = i && g.version && i.version !== g.version;
          return <Tile key={g.id} g={g} onOpen={() => onOpen(g.id)} state={<p className="mt-1 text-[11px]" style={{ color: g.available === false ? '#f87171' : upd ? '#fbbf24' : i ? '#34d399' : 'var(--t3)' }}>{g.available === false ? 'Временно недоступна' : t && isActive(t) ? 'Загрузка…' : upd ? 'Есть обновление' : i ? 'Установлена' : 'Не установлена'}</p>} />; })}</ul>}
    </div>
  );
};

const Downloads = ({ names }: { names: Record<string, string> }) => {
  const dl = useDownloads(); const tasks = Object.values(dl.tasks); const [free, setFree] = useState<number | null>(null);
  const [lim, setLim] = useState({ games: 2, speed: 0 });
  useEffect(() => { if (dl.ready && dl.root) void dl.call('freeSpace', dl.root).then((r) => setFree(typeof r === 'number' ? r : null)); }, [dl.ready, dl.root, tasks.length]);
  if (!launcherNative()) return <div className="p-4"><Note>Загрузки доступны в приложении Sky для Windows. В веб-версии и на телефоне игры не устанавливаются.</Note></div>;
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-24">
      <section className="mb-3 rounded-2xl p-3" style={GLASS}>
        <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Папка установки по умолчанию: <b translate="no">{dl.root || '—'}</b></p>
        <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Свободно на диске: {free === null ? 'неизвестно' : fmtBytes(free)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>
          <label>Одновременных игр: <select className="rounded-lg border bg-transparent px-2 py-1" style={inputStyle} value={lim.games} onChange={(e) => { const v = Number(e.target.value); setLim((l) => ({ ...l, games: v })); void dl.call('setLimits', { concurrentGames: v }); }}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Скорость: <select className="rounded-lg border bg-transparent px-2 py-1" style={inputStyle} value={lim.speed} onChange={(e) => { const v = Number(e.target.value); setLim((l) => ({ ...l, speed: v })); void dl.call('setLimits', { maxBytesPerSec: v }); }}><option value={0}>Без ограничения</option><option value={1048576}>1 МБ/с</option><option value={5242880}>5 МБ/с</option><option value={10485760}>10 МБ/с</option></select></label>
        </div>
      </section>
      {tasks.length === 0 ? <Note>Активных загрузок нет. Завершённые загрузки и обновления в этом списке не хранятся.</Note> : <ul className="flex flex-col gap-3">{tasks.map((t) => <li key={t.gameId} className="rounded-2xl p-3" style={GLASS}><b className="text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{names[t.gameId] ?? 'Игра'}</b>{t.version && <span className="text-[11px]" style={{ color: 'var(--t3)' }}> · {t.version}</span>}<TaskLine t={t} /></li>)}</ul>}
    </div>
  );
};

export const GamesSection = ({ openCabinet }: { openCabinet: () => void }) => {
  const [tab, setTab] = useState<'store' | 'library' | 'downloads'>('store'); const [open, setOpen] = useState<string | null>(null); const dl = useDownloads();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { void lApi.library().then((r) => r.ok && setNames(Object.fromEntries((r.data?.library ?? []).map((g) => [g.id, g.title])))); }, [Object.keys(dl.tasks).length]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return <GameDetail id={open} onBack={() => setOpen(null)} />;
  const active = Object.values(dl.tasks).filter((t) => isActive(t)).length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
        <Pill on={tab === 'store'} onClick={() => setTab('store')}>Магазин</Pill><Pill on={tab === 'library'} onClick={() => setTab('library')}>Библиотека</Pill>
        <Pill on={tab === 'downloads'} onClick={() => setTab('downloads')}>Загрузки{active ? ` (${active})` : ''}</Pill><span className="flex-1" /><Pill onClick={openCabinet}><Gamepad2 size={12} className="mr-1 inline" />Мои игры</Pill>
      </div>
      <div className="min-h-0 flex-1">{tab === 'store' ? <Store onOpen={setOpen} /> : tab === 'library' ? <Library onOpen={setOpen} /> : <Downloads names={names} />}</div>
    </div>
  );
};
export { Back };
void RefreshCw;
