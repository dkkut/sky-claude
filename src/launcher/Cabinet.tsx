import React, { useCallback, useEffect, useRef, useState } from 'react';
import { lApi, fmtBytes, type GameCard, type MyGame, type BuildRow } from './api';
import { Pill, Btn, Note, Spinner, ErrorBox, GLASS, Bar, Back, input, inputStyle } from './ui';
import { Cover } from './Games';

const GENRES = ['Экшен', 'Приключения', 'Ролевые', 'Стратегии', 'Симуляторы', 'Шутеры', 'Платформеры', 'Головоломки', 'Гонки', 'Спорт', 'Выживание', 'Инди', 'Казуальные', 'Хоррор', 'Файтинги'];
const STATUS: Record<string, string> = { draft: 'Черновик', awaiting_payment: 'Ожидает оплаты', pending_review: 'На проверке', needs_changes: 'Нужны исправления', published: 'Опубликована', rejected: 'Отклонена', unpublished: 'Снята с публикации', blocked: 'Заблокирована' };
const BSTATUS: Record<string, string> = { uploading: 'Загрузка файлов', uploaded: 'Готова к отправке', failed: 'Не прошла проверку', submitted: 'На проверке', approved: 'Одобрена', rejected: 'Отклонена', published: 'Опубликована', superseded: 'Прежняя версия' };
const ROLE: Record<string, string> = { owner: 'Владелец', developer: 'Разработчик', publisher: 'Менеджер публикаций', analyst: 'Аналитик' };
const ERR: Record<string, string> = { bad_path: 'Недопустимый путь файла', build_closed: 'Сборка уже закрыта', file_too_large: 'Файл слишком большой', build_too_large: 'Сборка слишком большая', too_many_files: 'Слишком много файлов', size_mismatch: 'Файл изменился во время загрузки', path_case_conflict: 'Конфликт регистра в имени файла', version_exists: 'Такая версия уже есть', bad_version: 'Версия: буквы, цифры, точки, дефисы', too_many_open_builds: 'Закончите или удалите незавершённые сборки', bad_launch_exe: 'Выберите .exe из загруженных файлов', bad_launch_args: 'Недопустимые параметры запуска', no_files: 'Нет файлов', not_approved: 'Сборка ещё не одобрена', game_not_published: 'Игра ещё не опубликована', forbidden: 'Недостаточно прав', insufficient_funds: 'Недостаточно средств на кошельке', incomplete: 'Карточка заполнена не полностью', blocked: 'Игра заблокирована', bad_status: 'Сейчас это действие недоступно', not_ready: 'Сборка не готова', build_blocked: 'Сборка заблокирована' };
const msg = (e?: string, d?: any) => e === 'incomplete' && d?.missing ? `Не хватает: ${d.missing.join(', ')}` : ERR[e ?? ''] ?? 'Не удалось выполнить действие';

const BuildUploader = ({ gameId, onDone }: { gameId: string; onDone: () => void }) => {
  const [version, setVersion] = useState(''); const [channel, setChannel] = useState<'release' | 'test'>('release'); const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<{ file: File; path: string }[]>([]); const [exe, setExe] = useState(''); const [args, setArgs] = useState('');
  const [prog, setProg] = useState<{ done: number; total: number; cur: string } | null>(null); const [err, setErr] = useState(''); const stop = useRef(false);
  const pick = (list: FileList | null) => { if (!list) return; setFiles([...list].map((f) => ({ file: f, path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name })).filter((x) => x.path)); setExe(''); };
  const exes = files.filter((f) => /\.exe$/i.test(f.path));
  const run = async () => {
    setErr(''); stop.current = false;
    if (!version.trim() || !files.length || !exe) { setErr('Укажите версию, выберите папку сборки и исполняемый файл'); return; }
    const b = await lApi.createBuild(gameId, { version: version.trim(), channel, notes }); if (!b.ok) { setErr(msg(b.error)); return; }
    const bid = b.data.id as string; const total = files.reduce((a, f) => a + f.file.size, 0); let done = 0;
    for (const f of files) {
      if (stop.current) { setErr('Загрузка остановлена. Незавершённую сборку можно удалить в списке.'); setProg(null); onDone(); return; }
      setProg({ done, total, cur: f.path });
      let ok = false; for (let attempt = 0; attempt < 3 && !ok; attempt += 1) { const r = await lApi.uploadFile(bid, f.path, f.file); if (r.ok) ok = true; else if (r.status === 400 || r.status === 413 || r.status === 409) { setErr(`${f.path}: ${msg(r.data?.error)}`); setProg(null); onDone(); return; } }
      if (!ok) { setErr(`Не удалось загрузить ${f.path}. Проверьте сеть и повторите.`); setProg(null); onDone(); return; }
      done += f.file.size;
    }
    setProg({ done: total, total, cur: 'Проверка…' });
    const fin = await lApi.finalize(bid, { launchExe: exe, launchArgs: args.split(/\s+/).filter(Boolean) });
    setProg(null); if (!fin.ok) setErr(msg(fin.error)); else if (fin.data?.status === 'failed') setErr(`Сборка не прошла антивирусную проверку: ${fin.data.scan?.detail ?? ''}`); else { setFiles([]); setVersion(''); }
    onDone();
  };
  return (
    <section className="mt-3 rounded-2xl p-3" style={GLASS}>
      <b className="text-[13px]" style={{ color: 'var(--t1)' }}>Новая сборка</b>
      <div className="mt-2 grid gap-2">
        <div className="flex gap-2"><input className={input} style={inputStyle} placeholder="Версия, например 1.0.0" value={version} onChange={(e) => setVersion(e.target.value)} /><select className="rounded-xl border bg-transparent px-2 text-[13px]" style={inputStyle} value={channel} onChange={(e) => setChannel(e.target.value as 'release' | 'test')}><option value="release">Релиз</option><option value="test">Тестовый канал</option></select></div>
        <input className={input} style={inputStyle} placeholder="Что нового (для игроков)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label className="text-[12px]" style={{ color: 'var(--t2)' }}>Папка со сборкой Windows (все файлы игры):{' '}
          <input type="file" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} multiple onChange={(e) => pick(e.target.files)} /></label>
        {files.length > 0 && <>
          <Note>{files.length} файлов · {fmtBytes(files.reduce((a, f) => a + f.file.size, 0))}. Каждый файл проверяется на сервере по SHA-256; игра на серверах Sky не запускается.</Note>
          <select className={input} style={inputStyle} value={exe} onChange={(e) => setExe(e.target.value)}><option value="">Исполняемый файл игры…</option>{exes.map((f) => <option key={f.path}>{f.path}</option>)}</select>
          <input className={input} style={inputStyle} placeholder="Параметры запуска (необязательно): -windowed" value={args} onChange={(e) => setArgs(e.target.value)} /></>}
        {prog && <div><Bar value={prog.total ? prog.done / prog.total : 0} /><p className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{prog.cur}</p></div>}
        {err && <p role="alert" className="text-[12px]" style={{ color: '#fca5a5' }}>{err}</p>}
        <div className="flex gap-2"><Btn onClick={() => void run()} disabled={Boolean(prog)}>Загрузить и проверить</Btn>{prog && <Btn kind="ghost" onClick={() => { stop.current = true; }}>Остановить</Btn>}</div>
      </div>
    </section>
  );
};

const Editor = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [d, setD] = useState<MyGame | null>(null); const [err, setErr] = useState(false); const [tab, setTab] = useState<'card' | 'media' | 'builds' | 'order' | 'news' | 'team' | 'stats'>('card');
  const [f, setF] = useState<any>(null); const [note, setNote] = useState(''); const [pl, setPl] = useState<any>(null); const [stats, setStats] = useState<any>(null);
  const load = useCallback(async () => { const r = await lApi.myGame(id); setErr(!r.ok); if (r.ok && r.data) { setD(r.data); setF((cur: any) => cur ?? { title: r.data!.game.title, shortDescr: r.data!.game.shortDescr, descr: r.data!.game.descr, genres: r.data!.game.genres, developer: r.data!.game.developer, publisher: r.data!.game.publisher, os: r.data!.game.os, requirements: r.data!.game.requirements, links: r.data!.game.links }); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'order') void lApi.placement(id).then((r) => r.ok && setPl(r.data)); if (tab === 'stats') void lApi.stats(id).then((r) => r.ok && setStats(r.data)); }, [tab, id]);
  if (err) return <><Back onClick={onBack} title="Игра" /><ErrorBox text="Не удалось открыть игру." onRetry={() => void load()} /></>;
  if (!d || !f) return <><Back onClick={onBack} title="Игра" /><Spinner /></>;
  const can = (p: string) => d.can.includes(p); const g = d.game;
  const saveCard = async () => { const r = await lApi.saveGame(id, f); setNote(r.ok ? 'Сохранено' : (r.data?.errors?.join('; ') ?? msg(r.error))); void load(); };
  const act = async (fn: () => Promise<any>, okText: string) => { const r = await fn(); setNote(r.ok ? okText : msg(r.error, r.data)); void load(); if (tab === 'order') void lApi.placement(id).then((x) => x.ok && setPl(x.data)); };
  const tabs: [typeof tab, string, boolean][] = [['card', 'Карточка', true], ['media', 'Обложка и скриншоты', can('edit')], ['builds', 'Сборки', true], ['order', 'Размещение 499 ₽', can('orders') || can('view')], ['news', 'Новости', can('news')], ['team', 'Команда', true], ['stats', 'Статистика', can('stats')]];
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-24">
      <Back onClick={onBack} title={g.title} />
      <div className="px-4">
        <p className="mb-2 text-[12px]" style={{ color: 'var(--t2)' }}>Статус: <b>{STATUS[g.status] ?? g.status}</b>{g.statusNote ? ` — ${g.statusNote}` : ''} · ваша роль: {ROLE[g.myRole ?? ''] ?? '—'}</p>
        <div className="mb-3 flex gap-2 overflow-x-auto">{tabs.filter((t) => t[2]).map(([k, l]) => <Pill key={k} on={tab === k} onClick={() => { setTab(k); setNote(''); }}>{l}</Pill>)}</div>
        {note && <p role="status" className="mb-2 text-[12px]" style={{ color: 'var(--t2)' }}>{note}</p>}
        {tab === 'card' && <div className="grid gap-2">
          <input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Название" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Короткое описание" maxLength={160} value={f.shortDescr} onChange={(e) => setF({ ...f, shortDescr: e.target.value })} />
          <textarea className={input} style={inputStyle} disabled={!can('edit')} rows={6} placeholder="Описание" maxLength={4000} value={f.descr} onChange={(e) => setF({ ...f, descr: e.target.value })} />
          <div className="flex flex-wrap gap-2">{GENRES.map((x) => <Pill key={x} on={f.genres.includes(x)} onClick={() => can('edit') && setF({ ...f, genres: f.genres.includes(x) ? f.genres.filter((y: string) => y !== x) : [...f.genres, x].slice(0, 4) })}>{x}</Pill>)}</div>
          <div className="grid grid-cols-2 gap-2"><input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Разработчик" value={f.developer} onChange={(e) => setF({ ...f, developer: e.target.value })} /><input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Издатель" value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} /></div>
          <div className="flex gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>{['windows', 'linux', 'macos'].map((o) => <label key={o}><input type="checkbox" disabled={!can('edit')} checked={f.os.includes(o)} onChange={() => setF({ ...f, os: f.os.includes(o) ? f.os.filter((y: string) => y !== o) : [...f.os, o] })} /> {o}</label>)}</div>
          <Note>Загрузка сборок сейчас поддерживает Windows (.exe).</Note>
          <div className="grid grid-cols-2 gap-2">{[['os', 'ОС'], ['cpu', 'Процессор'], ['ram', 'Память'], ['gpu', 'Видеокарта'], ['disk', 'Место на диске'], ['notes', 'Примечание']].map(([k, l]) => <input key={k} className={input} style={inputStyle} disabled={!can('edit')} placeholder={l} maxLength={120} value={f.requirements[k] ?? ''} onChange={(e) => setF({ ...f, requirements: { ...f.requirements, [k]: e.target.value } })} />)}</div>
          <div className="grid grid-cols-2 gap-2"><input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Сайт (https://…)" value={f.links.site ?? ''} onChange={(e) => setF({ ...f, links: { ...f.links, site: e.target.value } })} /><input className={input} style={inputStyle} disabled={!can('edit')} placeholder="Поддержка (https://…)" value={f.links.support ?? ''} onChange={(e) => setF({ ...f, links: { ...f.links, support: e.target.value } })} /></div>
          {can('edit') && <div><Btn onClick={() => void saveCard()}>Сохранить карточку</Btn></div>}
          {g.status === 'published' && <Note>Игра опубликована: изменения карточки сразу видны игрокам и фиксируются в журнале; администрация может снять игру при нарушении.</Note>}
        </div>}
        {tab === 'media' && <div className="grid gap-3">
          <div><b className="text-[13px]" style={{ color: 'var(--t1)' }}>Обложка</b><Cover id={g.cover} title={g.title} className="mt-1 h-32 w-56 rounded-xl" /><input className="mt-1 block text-[12px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const x = e.target.files?.[0]; if (x) { const r = await lApi.uploadMedia(id, 'cover', x); setNote(r.ok ? 'Обложка загружена' : msg(r.data?.error === 'too_large' ? 'file_too_large' : 'bad_path')); void load(); } }} /><Note>PNG, JPEG или WebP до 1 МБ.</Note></div>
          <div><b className="text-[13px]" style={{ color: 'var(--t1)' }}>Скриншоты ({g.screenshots.length}/8)</b><div className="mt-1 flex flex-wrap gap-2">{g.screenshots.map((s) => <div key={s} className="relative"><Cover id={s} title="" className="h-20 w-32 rounded-lg" /><button type="button" aria-label="Удалить" className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[11px] text-white" onClick={async () => { await lApi.deleteMedia(id, s); void load(); }}>×</button></div>)}</div>
            <input className="mt-1 block text-[12px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const x = e.target.files?.[0]; if (x) { const r = await lApi.uploadMedia(id, 'screenshot', x); setNote(r.ok ? 'Скриншот добавлен' : 'Не удалось загрузить (формат или размер)'); void load(); } }} /></div>
        </div>}
        {tab === 'builds' && <div>
          {d.builds.length === 0 && <Note>Сборок пока нет.</Note>}
          <ul className="grid gap-2">{d.builds.map((b: BuildRow) => <li key={b.id} className="rounded-2xl p-3" style={GLASS}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--t1)' }}><b translate="no">{b.version}</b><span className="rounded-full px-2 text-[10px]" style={{ background: 'rgba(139,92,246,.2)' }}>{b.channel === 'test' ? 'тест' : 'релиз'}</span><span>{BSTATUS[b.status] ?? b.status}{b.blocked ? ' · заблокирована' : ''}</span><span className="text-[11px]" style={{ color: 'var(--t3)' }}>{b.fileCount} файлов · {fmtBytes(b.totalBytes)} · антивирус: {({ none: '—', not_run: 'не запускался', clean: 'чисто', infected: 'угроза', error: 'ошибка' } as Record<string, string>)[b.scanStatus]}</span></div>
            {(b.reviewNote || b.error) && <p className="text-[12px]" style={{ color: '#fca5a5' }}>{b.reviewNote || b.error}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {b.status === 'uploaded' && g.status === 'published' && can('submit') && <Btn kind="ghost" onClick={() => void act(() => lApi.submitBuild(b.id), 'Отправлено на проверку')}>Отправить на проверку</Btn>}
              {['approved', 'superseded'].includes(b.status) && b.channel === 'release' && can('publish') && !b.blocked && <Btn onClick={() => void act(() => lApi.publishBuild(b.id), 'Версия опубликована')}>{b.status === 'superseded' ? 'Вернуть эту версию' : 'Опубликовать'}</Btn>}
              {!['published', 'approved', 'submitted'].includes(b.status) && can('build') && <Btn kind="danger" onClick={async () => { if (window.confirm('Удалить сборку?')) void act(() => lApi.deleteBuild(b.id), 'Сборка удалена'); }}>Удалить</Btn>}
            </div></li>)}</ul>
          {can('build') && g.status !== 'blocked' && <BuildUploader gameId={id} onDone={() => void load()} />}
          <p className="mt-2"><Note>Загрузка новой сборки ничего не заменяет у игроков: сначала проверка сотрудниками, затем вы сами публикуете одобренную версию. Откат — «Вернуть эту версию».</Note></p>
        </div>}
        {tab === 'order' && pl && <div className="grid gap-2">
          <section className="rounded-2xl p-3" style={GLASS}><b className="text-[14px]" style={{ color: 'var(--t1)' }}>Размещение игры — {pl.priceRub} ₽</b>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.payment}</p>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--t1)' }}>Что входит:</p><ul className="list-disc pl-5 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.includes.map((x: string) => <li key={x}>{x}</li>)}</ul>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--t1)' }}>Требования:</p><ul className="list-disc pl-5 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.requirements.map((x: string) => <li key={x}>{x}</li>)}</ul>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.review}</p><p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.term}</p><p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }}><b>Возврат.</b> {pl.terms.refund}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }}>Причины отказа: {pl.terms.rejectReasons.join('; ')}.</p><p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }}>{pl.terms.appeal}</p>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--t3)' }}>Баланс кошелька: {pl.balance ?? '—'} ₽. Игры в Sky Launcher для игроков бесплатны: продажи игр и выплат разработчикам пока нет.</p>
          </section>
          <div className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--t2)' }}><span>Заявка: <b>{STATUS[pl.gameStatus] ?? pl.gameStatus}</b></span>{pl.orders[0] && <span>Заказ: <b>{({ created: 'создан', paid: 'оплачен', refunded: 'возвращён', failed: 'не оплачен' } as Record<string, string>)[pl.orders[0].status]}</b> · {pl.orders[0].amountRub} ₽</span>}</div>
          {can('orders') && ['draft', 'needs_changes', 'awaiting_payment'].includes(pl.gameStatus) && <div><Btn onClick={() => void act(() => lApi.submit(id, crypto.randomUUID()), pl.orders.some((o: any) => o.status === 'paid') ? 'Заявка отправлена повторно (плата не списывалась)' : 'Оплачено 499 ₽, заявка отправлена на проверку')}>Оплатить с кошелька и отправить заявку</Btn></div>}
          {pl.gameStatus === 'rejected' && <Note>Заявка отклонена, плата возвращена. Чтобы подать заново, создайте новую игру или обратитесь в поддержку с номером заявки.</Note>}
        </div>}
        {tab === 'news' && <NewsForm onSend={async (t, b) => { await act(() => lApi.news(id, t, b), 'Новость опубликована'); }} />}
        {tab === 'team' && <Team d={d} id={id} reload={() => void load()} setNote={setNote} />}
        {tab === 'stats' && stats && <section className="rounded-2xl p-3" style={GLASS}><p className="text-[12px]" style={{ color: 'var(--t2)' }}>За {stats.days} дней (агрегаты без личных данных). В библиотеках: <b>{stats.inLibrary}</b></p>
          {Object.entries({ install_ok: 'Установок', update_ok: 'Обновлений', launch: 'Запусков', install_fail: 'Ошибок установки', update_fail: 'Ошибок обновления', launch_fail: 'Ошибок запуска', verify_fail: 'Ошибок проверки' }).map(([k, l]) => <p key={k} className="text-[13px]" style={{ color: 'var(--t1)' }}>{l}: {stats.events[k] ?? 0}</p>)}</section>}
        {d.modLog.length > 0 && tab === 'card' && <section className="mt-4"><b className="text-[12px]" style={{ color: 'var(--t3)' }}>История решений</b>{d.modLog.slice(0, 8).map((m, i) => <p key={i} className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{new Date(m.at).toLocaleString()} · {m.action}{m.note ? ` · ${m.note.slice(0, 80)}` : ''}</p>)}</section>}
      </div>
    </div>
  );
};

const NewsForm = ({ onSend }: { onSend: (t: string, b: string) => Promise<void> }) => { const [t, setT] = useState(''); const [b, setB] = useState(''); return <div className="grid gap-2"><input className={input} style={inputStyle} placeholder="Заголовок" maxLength={100} value={t} onChange={(e) => setT(e.target.value)} /><textarea className={input} style={inputStyle} rows={4} placeholder="Текст" maxLength={3000} value={b} onChange={(e) => setB(e.target.value)} /><div><Btn disabled={t.trim().length < 2} onClick={async () => { await onSend(t, b); setT(''); setB(''); }}>Опубликовать новость</Btn></div></div>; };

const Team = ({ d, id, reload, setNote }: { d: MyGame; id: string; reload: () => void; setNote: (s: string) => void }) => {
  const [u, setU] = useState(''); const [role, setRole] = useState('developer'); const [tu, setTu] = useState(''); const [tt, setTt] = useState('');
  const owner = d.can.includes('team');
  return (
    <div className="grid gap-3">
      <ul>{d.members.map((m) => <li key={m.id} className="flex items-center gap-2 py-1 text-[13px]" style={{ color: 'var(--t1)' }}><span className="flex-1" translate="no">{m.name} <span style={{ color: 'var(--t3)' }}>@{m.username}</span></span><span className="text-[12px]" style={{ color: 'var(--t2)' }}>{ROLE[m.role]}</span>{owner && m.role !== 'owner' && <button type="button" aria-label="Убрать" onClick={async () => { await lApi.removeMember(id, m.id); reload(); }}>×</button>}</li>)}</ul>
      {owner && <><div className="flex gap-2"><input className={input} style={inputStyle} placeholder="@ник участника" value={u} onChange={(e) => setU(e.target.value)} /><select className="rounded-xl border bg-transparent px-2 text-[13px]" style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}><option value="developer">Разработчик</option><option value="publisher">Менеджер публикаций</option><option value="analyst">Аналитик</option></select><Btn onClick={async () => { const r = await lApi.addMember(id, u, role); setNote(r.ok ? 'Добавлен' : r.error === 'user_not_found' ? 'Пользователь не найден' : 'Не удалось добавить'); setU(''); reload(); }}>Добавить</Btn></div>
        <Note>Разработчик загружает сборки и правит карточку; менеджер публикаций отправляет заявки и выпускает одобренные версии; аналитик видит статистику.</Note>
        <section className="rounded-2xl p-3" style={GLASS}><b className="text-[13px]" style={{ color: 'var(--t1)' }}>Передача владения</b><p className="text-[12px]" style={{ color: 'var(--t2)' }}>Получатель должен принять передачу; вы станете разработчиком. Для подтверждения введите точное название игры.</p>
          <div className="mt-2 grid gap-2"><input className={input} style={inputStyle} placeholder="@ник получателя" value={tu} onChange={(e) => setTu(e.target.value)} /><input className={input} style={inputStyle} placeholder="Название игры для подтверждения" value={tt} onChange={(e) => setTt(e.target.value)} /><div><Btn kind="danger" onClick={async () => { const r = await lApi.transfer(id, tu, tt); setNote(r.ok ? 'Предложение отправлено' : ({ confirm_title: 'Название введено неверно', user_not_found: 'Пользователь не найден', pending_exists: 'Предложение уже отправлено' } as Record<string, string>)[r.error ?? ''] ?? 'Не удалось'); }}>Предложить передачу</Btn></div></div></section></>}
    </div>
  );
};

/** Кабинет «Мои игры»: список, создание, редактор. */
export const CabinetSection = ({ onBack }: { onBack: () => void }) => {
  const [list, setList] = useState<GameCard[] | null>(null); const [err, setErr] = useState(false); const [open, setOpen] = useState<string | null>(null); const [title, setTitle] = useState('');
  const [tr, setTr] = useState<{ id: string; title: string; username: string }[]>([]); const [msgText, setMsgText] = useState('');
  const load = useCallback(async () => { const r = await lApi.myGames(); setErr(!r.ok); if (r.ok) setList(r.data?.games ?? []); const t = await lApi.incomingTransfers(); if (t.ok) setTr(t.data?.transfers ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  if (open) return <Editor id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-24">
      <Back onClick={onBack} title="Мои игры" />
      <div className="px-4">
        {tr.map((t) => <div key={t.id} className="mb-2 rounded-2xl p-3 text-[13px]" style={GLASS}><span style={{ color: 'var(--t1)' }} translate="no">@{t.username} предлагает вам стать владельцем игры «{t.title}»</span><div className="mt-2 flex gap-2"><Btn onClick={async () => { await lApi.answerTransfer(t.id, true); void load(); }}>Принять</Btn><Btn kind="ghost" onClick={async () => { await lApi.answerTransfer(t.id, false); void load(); }}>Отклонить</Btn></div></div>)}
        <div className="mb-3 flex gap-2"><input className={input} style={inputStyle} placeholder="Название новой игры" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /><Btn disabled={title.trim().length < 2} onClick={async () => { const r = await lApi.createGame({ title }); if (r.ok) { setTitle(''); setOpen(r.data.id); } else setMsgText(r.error === 'too_many' ? 'Достигнут предел числа игр' : 'Не удалось создать игру'); }}>Создать</Btn></div>
        {msgText && <p role="alert" className="mb-2 text-[12px]" style={{ color: '#fca5a5' }}>{msgText}</p>}
        {err && <ErrorBox text="Не удалось загрузить игры." onRetry={() => void load()} />}
        {list === null && !err ? <Spinner /> : list && list.length === 0 ? <Note>У вас пока нет игр. Создайте карточку, загрузите сборку и отправьте заявку: размещение стоит 499 ₽, плата возвращается при отказе.</Note>
          : <ul className="grid gap-2">{list?.map((g) => <li key={g.id}><button type="button" onClick={() => setOpen(g.id)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left" style={GLASS}><Cover id={g.cover} title={g.title} className="h-12 w-20 rounded-lg" /><span className="min-w-0 flex-1"><b className="block truncate text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{g.title}</b><span className="text-[11px]" style={{ color: 'var(--t3)' }}>{STATUS[g.status ?? ''] ?? g.status} · {ROLE[g.myRole ?? '']}</span></span></button></li>)}</ul>}
      </div>
    </div>
  );
};
