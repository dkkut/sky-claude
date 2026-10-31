/**
 * Настройки SkyMoney: фраза восстановления (12 слов), дополнительное слово, скрытие суммы, ручная блокировка.
 * Фразу создаёт и проверяет сервер (server/moneyrecovery.mjs); здесь слова показываются один раз при создании и нигде не сохраняются.
 * Менять фразу можно только на доверенном устройстве — иначе сервер отвечает отказом, и экран это показывает.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Copy, Check, Lock, Eye, EyeOff, ShieldCheck, Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

const HIDE_KEY = 'sky:money:hide';
export const readHideBalance = (): boolean => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };

interface Info { hasPhrase: boolean; hasExtra: boolean }
const sty = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const ERR: Record<string, string> = { forbidden: 'Это можно делать только на подтверждённом устройстве', bad_extra: 'Слово должно быть от 6 до 64 знаков', money_locked: 'SkyMoney закрыт' };

const PASS_ERR: Record<string, string> = { weak_wallet_password: 'Пароль должен быть от 6 до 64 знаков', invalid_wallet_password: 'Неверный текущий пароль', wallet_password_required: 'Введите текущий пароль', too_many_attempts: 'Слишком много попыток — попробуйте позже', invalid_code: 'Неверный код', device_code_required: 'Введите код', no_contact: 'Нет подтверждённой почты или номера для кода' };

/** Отдельный пароль кошелька: задать, сменить, убрать. Сервер хранит только хеш; пароль нужен в каждой сессии SkyMoney. */
const WalletPassword = () => {
  const [has, setHas] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(''); const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ hasPassword: boolean }>('/api/skyid/money/password'); if (r.ok && r.data) setHas(r.data.hasPassword); }, []);
  useEffect(() => { void load(); }, [load]);
  const done = (text: string) => { setCur(''); setP1(''); setP2(''); setOpen(false); setMsg(text); void load(); };
  const save = async () => {
    if (p1 !== p2) { setMsg('Пароли не совпадают'); return; }
    setBusy(true); setMsg('');
    const r = await apiCall('/api/skyid/money/password', { method: 'POST', body: JSON.stringify({ password: p1, current: cur || undefined }) });
    setBusy(false);
    if (r.ok) done(has ? 'Пароль кошелька изменён' : 'Пароль кошелька задан'); else setMsg(PASS_ERR[r.error ?? ''] ?? ERR[r.error ?? ''] ?? 'Не получилось сохранить');
  };
  const remove = async () => {
    if (!window.confirm('Убрать пароль кошелька? Вход в SkyMoney останется под обычной защитой.')) return;
    setBusy(true); setMsg('');
    const r = await apiCall('/api/skyid/money/password/remove', { method: 'POST', body: JSON.stringify({ current: cur }) });
    setBusy(false);
    if (r.ok) done('Пароль кошелька убран'); else setMsg(PASS_ERR[r.error ?? ''] ?? ERR[r.error ?? ''] ?? 'Не получилось убрать');
  };
  const inp = 'w-full rounded-2xl px-4 py-3 text-base outline-none';
  return (
    <section className="space-y-3 rounded-3xl p-5" style={card}>
      <p className="flex items-center gap-2 text-sm font-extrabold" style={{ color: 'var(--t1)' }}><Lock size={16} />Пароль кошелька</p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>Отдельный пароль только для SkyMoney, не такой, как у Sky ID. Если он задан, его спрашивают при каждом входе в кошелёк, даже на вашем устройстве. Хранится на сервере в виде хеша. Забыли пароль — его можно сбросить на подтверждённом устройстве по коду из аутентификатора или с почты.</p>
      {has != null && <p className="text-xs font-semibold" style={{ color: has ? '#34c759' : 'var(--t3)' }}>{has ? 'Пароль задан' : 'Пароль не задан'}</p>}
      {!open && <button type="button" disabled={has == null} onClick={() => { setOpen(true); setMsg(''); }} className="w-full rounded-2xl py-3 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>{has ? 'Сменить или убрать пароль' : 'Задать пароль кошелька'}</button>}
      {open && (
        <div className="space-y-2">
          {has && <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" placeholder="Текущий пароль" aria-label="Текущий пароль кошелька" className={inp} style={sty} />}
          <input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" placeholder="Новый пароль (от 6 знаков)" aria-label="Новый пароль кошелька" className={inp} style={sty} />
          <input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" placeholder="Повторите пароль" aria-label="Повтор пароля кошелька" className={inp} style={sty} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !p1 || (has === true && !cur)} onClick={() => void save()} className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-extrabold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>{busy && <Loader2 size={14} className="animate-spin" />}Сохранить</button>
            {has && <button type="button" disabled={busy || !cur} onClick={() => void remove()} className="rounded-2xl px-4 py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--bg-l3)', color: '#e05a5a' }}>Убрать</button>}
            <button type="button" onClick={() => { setOpen(false); setCur(''); setP1(''); setP2(''); }} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="text-xs" style={{ color: 'var(--t2)' }}>{msg}</p>}
    </section>
  );
};

export const MoneySettings = ({ onBack, onLock }: { onBack: () => void; onLock: () => void }) => {
  const [info, setInfo] = useState<Info | null>(null);
  const [words, setWords] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hide, setHide] = useState(readHideBalance());

  const load = useCallback(async () => {
    const r = await apiCall<Info>('/api/skyid/money/recovery');
    if (r.ok && r.data) setInfo(r.data); else setMsg(ERR[r.error ?? ''] ?? 'Не удалось загрузить настройки');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (info?.hasPhrase && !window.confirm('Новая фраза заменит прежнюю, а дополнительное слово будет сброшено. Продолжить?')) return;
    setBusy(true); setMsg('');
    const r = await apiCall<{ words: string[] }>('/api/skyid/money/recovery/create', { method: 'POST', body: '{}' });
    setBusy(false);
    if (r.ok && r.data) { setWords(r.data.words); setSaved(false); setCopied(false); void load(); } else setMsg(ERR[r.error ?? ''] ?? 'Не получилось создать фразу');
  };
  const saveExtra = async (remove = false) => {
    setBusy(true); setMsg('');
    const r = await apiCall('/api/skyid/money/recovery/extra', { method: 'POST', body: JSON.stringify({ word: remove ? null : extra }) });
    setBusy(false);
    if (r.ok) { setExtra(''); setMsg(remove ? 'Дополнительное слово убрано' : 'Дополнительное слово сохранено'); void load(); } else setMsg(ERR[r.error ?? ''] ?? 'Не получилось сохранить');
  };
  const toggleHide = () => { const v = !hide; setHide(v); try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* память недоступна */ } window.dispatchEvent(new Event('sky:money-hide')); };
  const copy = async () => { try { await navigator.clipboard.writeText(words!.join(' ')); setCopied(true); } catch { setMsg('Не удалось скопировать — перепишите слова вручную'); } };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={onBack} aria-label="Назад" className="glass-btn round grid h-9 w-9 place-items-center"><ArrowLeft size={17} /></button>
        <h2 className="text-base font-extrabold" style={{ color: 'var(--t1)' }}>Настройки SkyMoney</h2>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <WalletPassword />
        <section className="space-y-3 rounded-3xl p-5" style={card}>
          <p className="flex items-center gap-2 text-sm font-extrabold" style={{ color: 'var(--t1)' }}><KeyRound size={16} />Фраза восстановления</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>12 слов. Если фраза задана, на неподтверждённом устройстве SkyMoney открывается только по ней. Фраза хранится на сервере в виде хеша: показать её повторно нельзя — запишите и храните отдельно от телефона.</p>
          {words ? (
            <div className="space-y-3">
              <ol className="grid grid-cols-3 gap-2" translate="no">{words.map((w, i) => <li key={i} className="rounded-xl px-2 py-2 text-center text-sm font-bold" style={sty}><span className="mr-1 text-[10px]" style={{ color: 'var(--t3)' }}>{i + 1}</span>{w}</li>)}</ol>
              <button type="button" onClick={() => void copy()} className="flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Скопировано' : 'Скопировать'}</button>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Я записал(а) фразу в надёжном месте</label>
              <button type="button" disabled={!saved} onClick={() => setWords(null)} className="w-full rounded-2xl py-2.5 text-sm font-extrabold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Готово, скрыть слова</button>
            </div>
          ) : (
            <button type="button" disabled={busy || !info} onClick={() => void create()} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-extrabold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}{info?.hasPhrase ? 'Создать новую фразу' : 'Создать фразу восстановления'}
            </button>
          )}
          {info && <p className="text-xs font-semibold" style={{ color: info.hasPhrase ? '#34c759' : 'var(--t3)' }}>{info.hasPhrase ? 'Фраза задана' : 'Фраза не задана'}</p>}
        </section>

        {info?.hasPhrase && (
          <section className="space-y-3 rounded-3xl p-5" style={card}>
            <p className="text-sm font-extrabold" style={{ color: 'var(--t1)' }}>Дополнительное слово</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>Необязательно. Если оно задано, 12 слов без него откроют на чужом устройстве пустой кошелёк, а настоящие данные покажет только фраза вместе с этим словом. Слово нигде не показывается; потеряв его, настоящие данные на неподтверждённых устройствах не открыть — только с подтверждённого.</p>
            <input type="password" value={extra} onChange={(e) => setExtra(e.target.value)} autoComplete="off" translate="no" placeholder={info.hasExtra ? 'Новое слово (заменит прежнее)' : 'Слово от 6 знаков'} aria-label="Дополнительное слово" className="w-full rounded-2xl px-4 py-3 text-base outline-none" style={sty} />
            <div className="flex gap-2">
              <button type="button" disabled={busy || extra.trim().length < 6} onClick={() => void saveExtra()} className="flex-1 rounded-2xl py-2.5 text-sm font-extrabold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Сохранить</button>
              {info.hasExtra && <button type="button" disabled={busy} onClick={() => void saveExtra(true)} className="rounded-2xl px-4 py-2.5 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Убрать</button>}
            </div>
          </section>
        )}

        <section className="space-y-2 rounded-3xl p-5" style={card}>
          <button type="button" onClick={toggleHide} className="flex w-full items-center gap-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>{hide ? <EyeOff size={16} /> : <Eye size={16} />}</span>
            <span className="flex-1"><span className="block text-sm font-bold" style={{ color: 'var(--t1)' }}>Скрывать сумму на экране</span><span className="block text-xs" style={{ color: 'var(--t3)' }}>{hide ? 'Включено' : 'Выключено'} · только на этом устройстве</span></span>
          </button>
          <button type="button" onClick={onLock} className="flex w-full items-center gap-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}><Lock size={16} /></span>
            <span className="flex-1"><span className="block text-sm font-bold" style={{ color: 'var(--t1)' }}>Закрыть SkyMoney сейчас</span><span className="block text-xs" style={{ color: 'var(--t3)' }}>Снова понадобится подтверждение доступа</span></span>
          </button>
        </section>

        {msg && <p role="status" className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>{msg}</p>}
      </div>
    </div>
  );
};
