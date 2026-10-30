/**
 * Sky Transfer — передача файлов между СВОИМИ устройствами одного Sky ID.
 * Честно: файл идёт через сервер Sky (кусками, во временном зашифрованном хранилище) и удаляется после получения; сквозного
 * шифрования нет. Незнакомое устройство сначала подтверждается с уже подтверждённого. Сервер — server/transfer.mjs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Laptop, Globe, Tv, Car, Send, X, RefreshCw, Download, Check, Loader2, Trash2, ShieldAlert, Pencil } from 'lucide-react';
import { flash } from '@/shared/flash';
import { visibleTick } from '@/shared/visibleTick';
import { T, useJobs, sendFile, uploadChunks, receiveFile, detectKind, defaultName, tReason, type TOverview, type TDevice, type TTransfer } from './transferApi';

const KIND_ICON: Record<string, typeof Globe> = { phone: Smartphone, desktop: Laptop, web: Globe, tv: Tv, car: Car, other: Globe };
const KIND_NAME: Record<string, string> = { phone: 'Телефон', desktop: 'Компьютер', web: 'Браузер', tv: 'ТВ', car: 'Машина', other: 'Устройство' };
const STATUS: Record<TTransfer['status'], string> = {
  uploading: 'Отправка', ready: 'Готово к получению', awaiting_accept: 'Ждёт подтверждения получателя', downloading: 'Получение', delivered: 'Доставлено',
  cancelled: 'Отменено', rejected: 'Отклонено получателем', failed: 'Ошибка', expired: 'Срок истёк',
};
const fmtSize = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : n >= 1024 ? `${Math.round(n / 1024)} КБ` : `${n} Б`);
const fmtSpeed = (n: number) => `${fmtSize(n)}/с`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const card: React.CSSProperties = { background: 'var(--bg-l2)', border: '1px solid var(--border)', borderRadius: 20 };
const Pill = ({ children, onClick, disabled, danger, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; primary?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold disabled:opacity-50" style={{ minHeight: 36, background: primary ? 'var(--accent)' : danger ? 'rgba(224,90,90,0.16)' : 'var(--bg-l3)', color: primary ? '#fff' : danger ? '#e05a5a' : 'var(--t1)' }}>{children}</button>
);

export function SkyTransfer() {
  const [ov, setOv] = useState<TOverview | null>(null);
  const [err, setErr] = useState('');
  const [target, setTarget] = useState('');
  const [editName, setEditName] = useState<string | null>(null);
  const jobs = useJobs((s) => s.jobs);
  const fileRef = useRef<HTMLInputElement>(null);
  const resendTo = useRef<string>('');
  const [drag, setDrag] = useState(false);

  const load = useCallback(async () => {
    const r = await T.overview();
    if (!r.ok || !r.data) { setErr(tReason(r)); return; }
    // Ответ старого сервера может быть неполным — достраиваем, чтобы экран не падал в пустоту.
    const d = r.data;
    setErr(''); setOv({
      ...d, devices: d.devices ?? [], active: d.active ?? [], history: d.history ?? [],
      prefs: { ...{ accept: 'own', confirm: false, keepHours: 24, historyDays: 30 }, ...((d.prefs ?? {}) as Partial<TOverview['prefs']>) } as TOverview['prefs'],
      limits: { ...{ maxFileBytes: 100 * 1048576, minChunk: 262144, maxChunk: 4194304, blockedExt: [] as string[] }, ...((d.limits ?? {}) as Partial<TOverview['limits']>) },
    } as TOverview);
  }, []);
  // Регистрируем это устройство (первое — подтверждено сразу, остальные ждут) и держим «онлайн».
  useEffect(() => {
    let on = true;
    void (async () => { const r = await T.register(defaultName(), detectKind()); if (!r.ok && on) setErr(tReason(r)); if (on) void load(); })();
    const poll = setInterval(visibleTick(() => void load()), 8000);
    const beat = setInterval(visibleTick(() => void T.heartbeat()), 25000);
    const onEvt = () => void load();
    window.addEventListener('sky:transfer', onEvt);
    return () => { on = false; clearInterval(poll); clearInterval(beat); window.removeEventListener('sky:transfer', onEvt); };
  }, [load]);

  const me = ov?.device ?? null;
  const approved = me?.status === 'approved';
  const others = (ov?.devices ?? []).filter((d) => !d.current && d.status === 'approved');
  const receivers = others.filter((d) => d.canReceive);
  const pendingOthers = (ov?.devices ?? []).filter((d) => !d.current && d.status === 'pending');
  const nameOf = (id: string) => ov?.devices.find((d) => d.id === id)?.name ?? 'устройство';
  useEffect(() => { if (!target && receivers[0]) setTarget(receivers[0].id); if (target && !receivers.some((d) => d.id === target)) setTarget(receivers[0]?.id ?? ''); }, [receivers.map((d) => d.id).join()]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sendFiles = async (files: FileList | File[], to: string) => {
    if (!to) { flash('Сначала выберите устройство-получатель'); return; }
    const max = ov?.limits.maxFileBytes ?? 0;
    for (const f of Array.from(files)) {
      if (max && f.size > max) { flash(`«${f.name}»: файл больше ${fmtSize(max)}`); continue; }
      if (f.size === 0) { flash(`«${f.name}»: пустой файл`); continue; }
      void sendFile(f, to, () => void load()).then((e) => { void load(); if (e && e !== 'Отменено') flash(`«${f.name}»: ${e}`); else if (!e) flash(`«${f.name}» отправлен на «${nameOf(to)}»`); });
      await load();
    }
  };
  const act = async (f: () => Promise<{ ok: boolean; error?: string; reason?: string }>, okMsg?: string) => { const r = await f(); if (!r.ok) flash(tReason(r)); else if (okMsg) flash(okMsg); void load(); };
  const rename = async (id: string, name: string) => { setEditName(null); if (name.trim()) await act(() => T.rename(id, name.trim()), 'Название изменено'); };

  const row = (t: TTransfer, active: boolean) => {
    const job = jobs[t.id];
    const out = t.direction === 'out';
    const done = job ? job.done : out ? t.bytesUp : t.bytesDown;
    const pct = t.size ? Math.min(100, Math.round((done / t.size) * 100)) : 0;
    const peer = nameOf(out ? t.to : t.from);
    return (
      <li key={t.id} className="space-y-2 p-3" style={card}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{t.name}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{out ? 'на' : 'с'} <span translate="no">«{peer}»</span> · {fmtSize(t.size)} · {when(t.createdAt)}</p>
          </div>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.status === 'delivered' ? 'rgba(52,199,89,0.16)' : ['failed', 'rejected', 'cancelled', 'expired'].includes(t.status) ? 'rgba(224,90,90,0.16)' : 'var(--bg-l3)', color: t.status === 'delivered' ? '#34c759' : ['failed', 'rejected', 'cancelled', 'expired'].includes(t.status) ? '#e05a5a' : 'var(--t2)' }}>{STATUS[t.status]}</span>
        </div>
        {active && (t.status === 'uploading' || t.status === 'downloading' || job) && (
          <div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-l3)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>{fmtSize(done)} из {fmtSize(t.size)} · {pct}%{job && job.speed > 0 ? ` · ${fmtSpeed(job.speed)}` : ''}</p>
          </div>
        )}
        {job?.error && <p role="alert" className="text-[11px]" style={{ color: '#e05a5a' }}>{job.error}</p>}
        {!active && t.error && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{t.error === 'integrity' ? 'Файл не прошёл проверку целостности и удалён.' : t.error === 'expired' ? 'Получатель не забрал файл вовремя — он удалён.' : t.error === 'device_removed' ? 'Устройство удалено.' : ''}</p>}
        <div className="flex flex-wrap gap-2">
          {!out && t.status === 'awaiting_accept' && <><Pill primary onClick={() => void act(() => T.accept(t.id))}><Check size={13} />Принять</Pill><Pill danger onClick={() => void act(() => T.reject(t.id))}>Отклонить</Pill></>}
          {!out && (t.status === 'ready' || t.status === 'downloading') && !jobs[t.id] && <Pill primary onClick={() => void receiveFile(t, () => void load()).then((e) => { if (e && e !== 'Отменено') flash(e); else if (!e) flash(`«${t.name}» получен и проверен`); void load(); })}><Download size={13} />{t.status === 'downloading' ? 'Продолжить' : 'Скачать'}</Pill>}
          {out && job?.error && job.file && <Pill primary onClick={() => void uploadChunks(t.id, job.file!, new AbortController(), () => void load()).then((e) => { if (e) flash(e); void load(); })}><RefreshCw size={13} />Повторить</Pill>}
          {active && <Pill danger onClick={() => { jobs[t.id]?.abort.abort(); void act(() => T.cancel(t.id), 'Передача отменена'); }}><X size={13} />Отменить</Pill>}
          {!active && out && ['failed', 'cancelled', 'expired', 'rejected'].includes(t.status) && <Pill onClick={() => { resendTo.current = t.to; fileRef.current?.click(); }}><RefreshCw size={13} />Отправить заново</Pill>}
          {!active && <Pill onClick={() => void act(() => T.deleteRecord(t.id))}><Trash2 size={13} />Убрать</Pill>}
        </div>
      </li>
    );
  };

  if (!ov && err) return <div role="alert" className="grid h-full place-items-center p-6 text-center"><div className="space-y-3"><p className="text-sm" style={{ color: 'var(--t2)' }}>{err}</p><button type="button" onClick={() => void load()} className="rounded-full px-4 py-2 text-sm font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Повторить</button></div></div>;
  if (!ov && !err) return <div role="status" className="grid h-full place-items-center"><Loader2 className="animate-spin" size={22} style={{ color: 'var(--t3)' }} /></div>;
  return (
    <div className="mx-auto h-full w-full max-w-3xl space-y-4 overflow-y-auto p-4" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (approved && e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files, target); }}>
      <div>
        <h2 className="text-xl font-extrabold" style={{ color: 'var(--t1)' }}>Sky Transfer</h2>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Файлы между вашими устройствами. Передача идёт через сервер Sky (TLS), куски хранятся на нём временно в зашифрованном виде и удаляются после получения. Сквозного шифрования нет.</p>
      </div>
      {err && <p role="alert" className="rounded-2xl p-3 text-sm" style={{ background: 'rgba(224,90,90,0.12)', color: '#e05a5a' }}>{err} <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p>}

      {me && me.status === 'pending' && (
        <div className="flex gap-3 p-4" style={{ ...card, border: '1px solid #e0a83a' }}>
          <ShieldAlert size={20} style={{ color: '#e0a83a' }} />
          <div><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Это устройство ждёт подтверждения</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Откройте Sky Transfer на уже подтверждённом устройстве и нажмите «Подтвердить». Пока этого не сделано, файлы не отправляются и не принимаются.</p></div>
        </div>
      )}
      {approved && pendingOthers.map((d) => (
        <div key={d.id} className="space-y-2 p-4" style={{ ...card, border: '1px solid #e0a83a' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Новое устройство хочет подключиться</p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}><span translate="no">«{d.name}»</span> · <span>{KIND_NAME[d.kind] ?? 'Устройство'}</span> · {when(d.createdAt)}</p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Подтверждайте, только если это ваше устройство — оно сможет принимать ваши файлы.</p>
          <div className="flex gap-2"><Pill primary onClick={() => void act(() => T.approve(d.id), 'Устройство подтверждено')}><Check size={13} />Подтвердить</Pill><Pill danger onClick={() => void act(() => T.removeDevice(d.id), 'Устройство отклонено')}>Это не моё</Pill></div>
        </div>
      ))}

      <section className="space-y-2">
        <h3 className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Устройства</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(ov?.devices ?? []).filter((d) => d.status !== 'pending' || d.current).map((d: TDevice) => {
            const Icon = KIND_ICON[d.kind] ?? Globe;
            return (
              <li key={d.id} className="flex items-center gap-3 p-3" style={card}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-l3)' }}><Icon size={18} style={{ color: 'var(--accent)' }} /></span>
                <div className="min-w-0 flex-1">
                  {editName === d.id ? <input autoFocus defaultValue={d.name} maxLength={60} translate="no" onBlur={(e) => void rename(d.id, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void rename(d.id, (e.target as HTMLInputElement).value)} className="w-full rounded-lg px-2 py-1 text-sm outline-none" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }} />
                    : <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}><span translate="no">{d.name}</span>{d.current && <span className="font-normal" style={{ color: 'var(--t3)' }}> · это устройство</span>}</p>}
                  <p className="flex flex-wrap gap-x-1 text-[11px]" style={{ color: 'var(--t3)' }}><span>{KIND_NAME[d.kind] ?? 'Устройство'}</span><span>·</span><span>{d.status === 'pending' ? 'ждёт подтверждения' : d.current || d.online ? 'на связи' : 'не в сети'}</span>{!d.canReceive && <><span>·</span><span>не принимает файлы</span></>}</p>
                </div>
                {approved && <button type="button" aria-label="Переименовать" onClick={() => setEditName(d.id)} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--bg-l3)' }}><Pencil size={13} /></button>}
                {approved && !d.current && <button type="button" aria-label="Удалить устройство" onClick={() => void act(() => T.removeDevice(d.id), 'Устройство удалено')} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(224,90,90,0.16)', color: '#e05a5a' }}><Trash2 size={13} /></button>}
              </li>
            );
          })}
        </ul>
        {approved && others.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Других подтверждённых устройств пока нет. Откройте Sky на втором устройстве под этим же Sky ID, затем вернитесь сюда и подтвердите его.</p>}
      </section>

      {approved && (
        <section className="space-y-2 p-4" style={{ ...card, outline: drag ? '2px dashed var(--accent)' : 'none' }}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Отправить файлы</h3>
          {receivers.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Нет устройства, которое может принять файл.</p> : (
            <>
              <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Куда
                <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }} translate="no">
                  {receivers.map((d) => <option key={d.id} value={d.id}>{`${d.name} ${d.online ? '●' : '○'}`}</option>)}
                </select></label>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const to = resendTo.current || target; resendTo.current = ''; if (e.target.files?.length) void sendFiles(e.target.files, to); e.target.value = ''; }} />
              <Pill primary onClick={() => { resendTo.current = ''; fileRef.current?.click(); }}><Send size={13} />Выбрать файлы</Pill>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{`Можно перетащить файлы сюда. До ${fmtSize(ov?.limits.maxFileBytes ?? 0)} на файл; исполняемые программы (.exe, .msi, .bat и т. п.) не передаются.`}</p>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Если получатель не в сети, файл дождётся его (до 24 часов), потом будет удалён. ● — на связи, ○ — не в сети.</p>
            </>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Передачи</h3>
        {(ov?.active.length ?? 0) === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Активных передач нет.</p> : <ul className="space-y-2">{ov!.active.map((t) => row(t, true))}</ul>}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold" style={{ color: 'var(--t2)' }}>История</h3>
          {(ov?.history.length ?? 0) > 0 && <Pill onClick={() => void act(() => T.clearHistory(), 'История очищена')}><Trash2 size={13} />Очистить</Pill>}</div>
        {(ov?.history.length ?? 0) === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Пока пусто.</p> : <ul className="space-y-2">{ov!.history.map((t) => row(t, false))}</ul>}
      </section>

      {approved && ov && (
        <section className="space-y-3 p-4" style={card}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Настройки</h3>
          <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--t1)' }}><span>Принимать файлы<span className="block text-[11px]" style={{ color: 'var(--t3)' }}>Только от ваших подтверждённых устройств. Приёма от других людей и контактов в Sky Transfer нет.</span></span>
            <input type="checkbox" checked={ov.prefs.accept === 'own'} onChange={(e) => void act(() => T.setPrefs({ accept: e.target.checked ? 'own' : 'off' }))} /></label>
          <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--t1)' }}><span>Спрашивать перед получением<span className="block text-[11px]" style={{ color: 'var(--t3)' }}>Файл не скачается, пока получатель не нажмёт «Принять».</span></span>
            <input type="checkbox" checked={ov.prefs.confirm} onChange={(e) => void act(() => T.setPrefs({ confirm: e.target.checked }))} /></label>
          <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--t1)' }}><span>Хранить файл на сервере после получения</span>
            <select value={ov.prefs.keepHours} onChange={(e) => void act(() => T.setPrefs({ keepHours: Number(e.target.value) }))} className="rounded-lg px-2 py-1.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>
              <option value={0}>Не хранить (удалить сразу)</option><option value={1}>1 час</option><option value={24}>24 часа</option><option value={72}>3 суток</option></select></label>
          <label className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--t1)' }}><span>Хранить историю передач</span>
            <select value={ov.prefs.historyDays} onChange={(e) => void act(() => T.setPrefs({ historyDays: Number(e.target.value) }))} className="rounded-lg px-2 py-1.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>
              <option value={0}>Не хранить</option><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select></label>
        </section>
      )}
    </div>
  );
}
