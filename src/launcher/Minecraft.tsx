/* Minecraft в Windows-приложении: установка с серверов Mojang, вход Microsoft, запуск. В вебе и на Android — только объяснение. */
import React, { useCallback, useEffect, useState } from 'react';
import { Download, Play, LogIn, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { launcherNative } from './native';
import { Btn, Note, GLASS, inputStyle } from './ui';

/** Куда подключиться при запуске (выбирается в окне подключения сервера каталога). */
export const useMcTarget = create<{ target: { host: string; port: number; name: string } | null; set: (t: { host: string; port: number; name: string } | null) => void }>((set) => ({ target: null, set: (target) => set({ target }) }));

const CID = (import.meta.env.VITE_MS_CLIENT_ID as string | undefined) ?? '';
const mc = (method: string, ...a: unknown[]) => launcherNative()?.mc(CID, method, ...a) ?? Promise.resolve({ error: 'not_native' });
const ERR: Record<string, string> = {
  client_id_missing: 'Вход Microsoft в этой сборке не настроен (нет идентификатора приложения). Запуск невозможен.', login_required: 'Сначала войдите через Microsoft.',
  no_license: 'У этого аккаунта Microsoft нет лицензии Minecraft Java Edition.', no_xbox_account: 'У аккаунта нет профиля Xbox — создайте его на xbox.com.', child_account: 'Детский аккаунт: добавьте его в семью Microsoft.',
  java_missing: 'Не найдена подходящая Java.', not_installed: 'Версия не установлена.', busy: 'Установка уже идёт.', hash_mismatch: 'Файл не прошёл проверку целостности — установка отменена.',
  host_not_allowed: 'Адрес файла не принадлежит Mojang — установка отменена.', modded_unsupported: 'Версии с модами (Forge/Fabric) Sky пока не устанавливает.', legacy_natives_unsupported: 'Эта старая версия требует распаковки библиотек — Sky такие пока не поддерживает.',
  legacy_assets_unsupported: 'У этой старой версии устаревший формат ресурсов — пока не поддерживается.', cancelled: 'Отменено.', expired: 'Время входа истекло.', xbox_failed: 'Xbox не ответил.', xsts_failed: 'Xbox отказал во входе.', minecraft_login_failed: 'Minecraft отказал во входе.',
};
const msg = (e?: string) => (e && ERR[e]) || (e ? `Ошибка: ${e}` : '');

export const MinecraftPanel = () => {
  const native = Boolean(launcherNative());
  const [vers, setVers] = useState<{ id: string; type: string }[]>([]); const [inst, setInst] = useState<{ id: string }[]>([]); const [sel, setSel] = useState('');
  const [acc, setAcc] = useState<{ name: string } | null>(null); const [auth, setAuth] = useState<any>({ phase: 'idle' });
  const [prog, setProg] = useState<{ stage: string; done: number; total: number } | null>(null); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [running, setRunning] = useState<string[]>([]); const [mem, setMem] = useState(2048); const [snap, setSnap] = useState(false);
  const target = useMcTarget((s) => s.target); const setTarget = useMcTarget((s) => s.set);

  const refresh = useCallback(async () => {
    const [i, a, r] = await Promise.all([mc('installed'), mc('account'), mc('running')]);
    setInst(Array.isArray(i) ? i : []); setAcc(a && !a.error ? a : null); setRunning(Array.isArray(r) ? r : []);
  }, []);
  useEffect(() => {
    if (!native) return;
    void refresh(); void mc('versions').then((v) => { if (v?.versions) setVers(v.versions); else if (v?.error) setErr('Не удалось получить список версий Mojang.'); });
    const off = launcherNative()!.onMcEvent((ev: any) => {
      if (ev.type === 'mc:progress') setProg({ stage: ev.stage, done: ev.done, total: ev.total });
      else if (ev.type === 'mc:installed') { setProg(null); void refresh(); }
      else if (ev.type === 'mc:auth') { void refresh(); if (!ev.ok) setErr(msg(ev.error)); setAuth({ phase: ev.ok ? 'done' : 'error' }); }
      else if (ev.type === 'mc:exit') void refresh();
    });
    return () => off();
  }, [native, refresh]);

  if (!native) return <div className="rounded-2xl p-4" style={GLASS}><h3 className="mb-1 text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Играть в Minecraft из Sky</h3><Note>Установка и запуск работают в приложении Sky для Windows. В браузере и на телефоне доступны каталог серверов и адрес для подключения из официального лаунчера.</Note></div>;

  const shown = vers.filter((v) => snap || v.type === 'release').slice(0, 80);
  const install = async () => { setErr(''); setNote(''); if (!sel) return; setProg({ stage: 'manifest', done: 0, total: 1 }); const r = await mc('install', sel); if (r?.error) { setProg(null); setErr(msg(r.error)); } else setNote(`Версия ${sel} установлена.`); };
  const login = async () => { setErr(''); const r = await mc('authStart'); if (r?.error) { setErr(msg(r.error)); return; } setAuth({ phase: 'waiting', ...r }); const t = window.setInterval(async () => { const s = await mc('authStatus'); setAuth(s); if (s.phase !== 'waiting') { window.clearInterval(t); void refresh(); if (s.phase === 'error') setErr(msg(s.error)); } }, 3000); };
  const play = async (version: string) => {
    setErr(''); setNote('');
    const r = await mc('launch', { version, instance: 'default', memoryMb: mem, server: target ? { host: target.host, port: target.port } : undefined });
    if (r?.error) setErr(r.error === 'java_missing' ? `Нужна Java ${r.need}${r.have ? ` (найдена ${r.have})` : ''}. Установите её с adoptium.net и повторите.` : msg(r.error)); else { setNote('Игра запускается…'); void refresh(); }
  };
  const label = { manifest: 'Манифест', client: 'Клиент', libraries: 'Библиотеки', assets: 'Ресурсы', done: 'Готово' } as Record<string, string>;
  return (
    <section aria-label="Minecraft" className="flex flex-col gap-3 rounded-2xl p-4" style={GLASS}>
      <h3 className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Играть в Minecraft из Sky</h3>
      <Note>Файлы игры скачиваются только с серверов Mojang и сверяются по контрольным суммам. Запуск возможен только с лицензией: вход через Microsoft, пароль Sky не видит и не хранит. Версии с модами пока не поддерживаются.</Note>
      <div className="flex flex-wrap items-center gap-2">
        {acc ? <><span className="text-[13px]" style={{ color: 'var(--t1)' }}>Аккаунт: <b translate="no">{acc.name}</b></span><Btn kind="ghost" onClick={async () => { await mc('logout'); setAcc(null); setAuth({ phase: 'idle' }); }}><LogOut size={13} className="mr-1 inline" />Выйти</Btn></>
          : <Btn onClick={() => void login()} disabled={auth.phase === 'waiting'}><LogIn size={13} className="mr-1 inline" />Войти через Microsoft</Btn>}
      </div>
      {auth.phase === 'waiting' && <div role="status" className="rounded-xl p-3 text-[13px]" style={{ background: 'rgba(255,255,255,.05)', color: 'var(--t1)' }}>Откройте <b translate="no">{auth.url}</b> и введите код <b translate="no" className="text-[16px] tracking-widest">{auth.userCode}</b>. Окно подтверждения закроется само.</div>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Версия" value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-full border bg-transparent px-3 py-1.5 text-[12px]" style={inputStyle}><option value="">Версия для установки…</option>{shown.map((v) => <option key={v.id} value={v.id}>{v.id}{v.type !== 'release' ? ' (снапшот)' : ''}</option>)}</select>
        <label className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />Снапшоты</label>
        <Btn onClick={() => void install()} disabled={!sel || Boolean(prog)}><Download size={13} className="mr-1 inline" />Установить</Btn>
        {prog && <Btn kind="ghost" onClick={() => void mc('cancelInstall')}>Отменить</Btn>}
      </div>
      {prog && <div role="status" aria-live="polite" className="text-[12px]" style={{ color: 'var(--t2)' }}>{label[prog.stage] ?? prog.stage}: {prog.done}/{prog.total}</div>}
      <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>Память: <b>{mem} МБ</b><input type="range" min={1024} max={16384} step={512} value={mem} onChange={(e) => setMem(Number(e.target.value))} aria-label="Память игры" /></label>
      {target && <p className="text-[12px]" style={{ color: 'var(--t2)' }}>После запуска подключимся к <b translate="no">{target.name}</b> ({target.host}:{target.port}). <button type="button" className="underline" onClick={() => setTarget(null)}>Не подключаться</button></p>}
      {inst.length === 0 ? <Note>Установленных версий нет.</Note> : <ul className="flex flex-col gap-2">{inst.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-2" style={{ background: 'rgba(255,255,255,.04)' }}>
          <span className="text-[13px]" style={{ color: 'var(--t1)' }} translate="no">{v.id}</span>
          <span className="flex gap-2">
            <Btn onClick={() => void play(v.id)} disabled={!acc || running.some((k) => k.startsWith(v.id + ':'))}><Play size={13} className="mr-1 inline" />{running.some((k) => k.startsWith(v.id + ':')) ? 'Запущена' : 'Играть'}</Btn>
            <Btn kind="ghost" title="Проверить файлы" onClick={async () => { const r = await mc('verify', v.id); setNote(r?.ok ? `Версия ${v.id}: файлы целы.` : `Версия ${v.id}: повреждено файлов — ${r?.badCount ?? '?'}. Нажмите «Установить», чтобы починить.`); }}><RefreshCw size={13} /></Btn>
            <Btn kind="danger" title="Удалить версию" onClick={async () => { if (window.confirm(`Удалить версию ${v.id}? Миры и настройки в папке профиля останутся.`)) { await mc('uninstall', v.id); void refresh(); } }}><Trash2 size={13} /></Btn>
          </span>
        </li>))}</ul>}
      {!acc && inst.length > 0 && <Note>Чтобы играть, войдите через Microsoft.</Note>}
      {err && <p role="alert" className="text-[12px]" style={{ color: '#fca5a5' }}>{err}</p>}
      {note && <p role="status" className="text-[12px]" style={{ color: '#34d399' }}>{note}</p>}
    </section>
  );
};
