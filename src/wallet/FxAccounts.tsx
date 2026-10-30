/**
 * Валютные счета SkyMoney. Основной счёт — рубль; дополнительные открываются по желанию (до 5). Обмен — только рубли ↔ валюта по курсу,
 * который задаёт администрация Sky (со спредом): рыночных курсов у Sky нет. Расчёт и списание делает сервер, здесь — показ и ввод.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Loader2, ArrowRightLeft, Lock, Trash2 } from 'lucide-react';
import { useMoney } from './store';
import { fxOverview, fxOpen, fxClose, fxConvert, quoteFx, fmtCur, type FxOverview, type FxCurrency } from './fxApi';

const ERR: Record<string, string> = {
  insufficient_funds: 'Недостаточно средств', amount_out_of_range: 'Сумма вне допустимых пределов', amount_too_small: 'Сумма слишком мала для обмена', invalid_amount: 'Введите целую сумму',
  currency_unavailable: 'Валюта сейчас недоступна', too_many_accounts: 'Достигнут предел числа валютных счетов', not_empty: 'Закрыть можно только пустой счёт',
  rate_changed: 'Курс изменился — проверьте новую сумму и повторите', too_many_requests: 'Слишком часто — подождите немного', money_locked: 'SkyMoney закрыт',
};
const sty = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const newKey = () => `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const FxAccounts = ({ onBack, rubBalance }: { onBack: () => void; rubBalance: number }) => {
  const [data, setData] = useState<FxOverview | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [conv, setConv] = useState<{ c: FxCurrency; dir: 'buy' | 'sell' } | null>(null);
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    const r = await fxOverview();
    if (r.ok && r.data) { setData(r.data); setErr(''); } else setErr(ERR[r.error ?? ''] ?? 'Не удалось загрузить валютные счета');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byCode = useMemo(() => new Map((data?.currencies ?? []).map((c) => [c.code, c])), [data]);
  const free = (data?.currencies ?? []).filter((c) => c.available && !data?.accounts.some((a) => a.currency === c.code));

  const open = async (code: string) => {
    setBusy(true); setMsg('');
    const r = await fxOpen(code); setBusy(false);
    if (r.ok) { setAdding(false); await load(); } else setMsg(ERR[r.error ?? ''] ?? 'Не удалось открыть счёт');
  };
  const close = async (code: string) => {
    if (!window.confirm('Закрыть пустой счёт?')) return;
    const r = await fxClose(code);
    if (r.ok) await load(); else setMsg(ERR[r.error ?? ''] ?? 'Не удалось закрыть счёт');
  };

  const n = Math.floor(Number(amount.replace(',', '.')) * (conv?.dir === 'sell' ? 100 : 1));
  const preview = conv && n > 0 ? quoteFx(conv.c, conv.dir, n) : 0;
  const submit = async () => {
    if (!conv || n <= 0 || preview <= 0) return;
    setBusy(true); setMsg('');
    const r = await fxConvert({ currency: conv.c.code, direction: conv.dir, amount: n, expect: preview, idemKey: newKey() });
    setBusy(false);
    if (r.ok) {
      setMsg(conv.dir === 'buy' ? `Получено ${fmtCur(r.data?.amount ?? preview, conv.c.symbol)}` : `Зачислено ${(r.data?.rub ?? preview).toLocaleString('ru')} ₽`);
      setConv(null); setAmount(''); await load(); void useMoney.getState().refresh();
    } else { setMsg(ERR[r.error ?? ''] ?? 'Не получилось выполнить обмен'); if (r.error === 'rate_changed') await load(); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={onBack} aria-label="Назад" className="glass-btn round grid h-9 w-9 place-items-center"><ArrowLeft size={17} /></button>
        <h2 className="text-base font-extrabold" style={{ color: 'var(--t1)' }}>Валютные счета</h2>
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section className="rounded-3xl p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Основной счёт</p>
          <p className="mt-1 text-3xl font-black" style={{ color: 'var(--t1)' }}>{rubBalance.toLocaleString('ru')} ₽</p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>Рубль остаётся основной валютой. Дополнительные счета открываются по желанию; обмен — только из рублей и обратно в рубли по курсу Sky (со спредом).</p>
        </section>

        {!data && !err && <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={22} style={{ color: 'var(--t3)' }} /></div>}
        {err && <p role="alert" className="rounded-xl p-3 text-sm" style={{ background: 'rgba(224,90,90,.12)', color: '#e05a5a' }}>{err} <button type="button" onClick={() => void load()} className="font-bold underline">Повторить</button></p>}

        {data?.accounts.map((a) => {
          const c = byCode.get(a.currency);
          return (
            <section key={a.currency} className="space-y-3 rounded-3xl p-5" style={card}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>{c?.name ?? a.currency} · {a.currency}</p>
                  <p className="mt-1 text-3xl font-black" style={{ color: 'var(--t1)' }}>{fmtCur(a.balance, c?.symbol ?? '')}</p></div>
                {a.balance === 0 && <button type="button" onClick={() => void close(a.currency)} aria-label="Закрыть счёт" className="glass-btn round grid h-9 w-9 place-items-center"><Trash2 size={15} /></button>}
              </div>
              {c?.available ? (
                <>
                  <p className="text-xs" style={{ color: 'var(--t3)' }}>Купить: {c.buy?.toLocaleString('ru', { maximumFractionDigits: 4 })} ₽ · Продать: {c.sell?.toLocaleString('ru', { maximumFractionDigits: 4 })} ₽ за 1 {c.symbol}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setConv({ c, dir: 'buy' }); setAmount(''); setMsg(''); }} className="flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-extrabold" style={{ background: 'var(--accent)', color: '#fff' }}><ArrowRightLeft size={15} />Из рублей</button>
                    <button type="button" disabled={a.balance === 0} onClick={() => { setConv({ c, dir: 'sell' }); setAmount(''); setMsg(''); }} className="flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>В рубли</button>
                  </div>
                </>
              ) : <p className="flex items-center gap-2 text-xs" style={{ color: 'var(--t3)' }}><Lock size={13} />Курс сейчас не задан — обмен временно недоступен</p>}
            </section>
          );
        })}

        {data && data.accounts.length === 0 && <p className="px-1 text-sm" style={{ color: 'var(--t3)' }}>Валютных счетов пока нет.</p>}

        {data && data.accounts.length < data.max && (
          adding ? (
            <section className="space-y-2 rounded-3xl p-5" style={card}>
              <p className="text-sm font-extrabold" style={{ color: 'var(--t1)' }}>Открыть счёт</p>
              {free.length === 0 ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Доступных валют нет: администрация ещё не задала курсы.</p>
                : <div className="grid grid-cols-2 gap-2">{free.map((c) => <button key={c.code} type="button" disabled={busy} onClick={() => void open(c.code)} className="rounded-2xl px-3 py-3 text-left" style={sty}><span className="block text-sm font-extrabold">{c.symbol} {c.code}</span><span className="block text-[11px]" style={{ color: 'var(--t3)' }}>{c.name}</span></button>)}</div>}
              <button type="button" onClick={() => setAdding(false)} className="text-xs font-bold" style={{ color: 'var(--t3)' }}>Отмена</button>
            </section>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-extrabold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}><Plus size={16} />Открыть валютный счёт</button>
          )
        )}

        {conv && (
          <section className="space-y-3 rounded-3xl p-5" style={{ ...card, borderColor: 'var(--accent)' }}>
            <p className="text-sm font-extrabold" style={{ color: 'var(--t1)' }}>{conv.dir === 'buy' ? `Рубли → ${conv.c.code}` : `${conv.c.code} → рубли`}</p>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" autoFocus placeholder={conv.dir === 'buy' ? `Сумма в рублях (от ${data?.minRub ?? 10})` : `Сумма в ${conv.c.code}`} aria-label="Сумма" className="w-full rounded-2xl px-4 py-3 text-base outline-none" style={sty} />
            <p className="text-xs" style={{ color: 'var(--t3)' }}>
              {preview > 0 ? (conv.dir === 'buy' ? `Вы получите ≈ ${fmtCur(preview, conv.c.symbol)}` : `Вы получите ${preview.toLocaleString('ru')} ₽`) : 'Введите сумму'}
              {' · '}курс может измениться — итог подтверждает сервер
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy || preview <= 0} onClick={() => void submit()} className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-sm font-extrabold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>{busy && <Loader2 size={15} className="animate-spin" />}Обменять</button>
              <button type="button" onClick={() => setConv(null)} className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
            </div>
          </section>
        )}

        {msg && <p role="status" className="rounded-xl p-3 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>{msg}</p>}

        {data && data.history.length > 0 && (
          <section className="space-y-1 rounded-3xl p-5" style={card}>
            <p className="mb-1 text-sm font-extrabold" style={{ color: 'var(--t1)' }}>Обмены</p>
            {data.history.map((h) => {
              const c = byCode.get(h.currency);
              return <div key={h.id} className="flex items-center justify-between py-1.5 text-xs" style={{ color: 'var(--t2)' }}>
                <span>{new Date(h.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'short' })} · {h.direction === 'buy' ? `₽ → ${h.currency}` : `${h.currency} → ₽`}</span>
                <span className="font-bold" style={{ color: 'var(--t1)' }}>{h.direction === 'buy' ? `${h.rub.toLocaleString('ru')} ₽ → ${fmtCur(h.amount, c?.symbol ?? '')}` : `${fmtCur(h.amount, c?.symbol ?? '')} → ${h.rub.toLocaleString('ru')} ₽`}</span>
              </div>;
            })}
          </section>
        )}
        <p className="text-[11px] leading-snug" style={{ color: 'var(--t3)' }}>Валютные счета существуют внутри SkyMoney: это не банковские валютные счета, вывод — только обменом обратно в рубли. Курс задаёт Sky и может отличаться от рыночного.</p>
      </div>
    </div>
  );
};
