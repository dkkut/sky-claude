/* Страница оплаты SkyKassa Business (/p/<id>): открывается без регистрации в Sky — и отдельной страницей (pay.html), и внутри приложения после
   сканирования QR в SkyMoney. Реквизиты и сумму отдаёт сервер. «Я перевёл деньги» — заявление покупателя, а не подтверждение поступления:
   статус «оплачено» ставит только владелец бизнеса. */
import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Loader2, ShieldCheck, AlertTriangle, Store } from 'lucide-react';
import { uploadUrl } from '@/core/auth/api';
import { pubPage, pubReport, pubProviderPay, pubStatus, type PublicPage } from './api';

const METHOD: Record<string, string> = { phone: 'Номер телефона (СБП)', account: 'Номер счёта', card: 'Номер карты', other: 'Реквизиты' };
const STATE_TEXT: Record<string, string> = {
  expired: 'Срок действия этой страницы оплаты истёк.',
  disabled: 'Владелец отключил эту страницу оплаты.',
  suspended: 'Приём оплаты этим бизнесом временно приостановлен.',
  unavailable: 'Эта страница оплаты сейчас недоступна.',
};
const ERR: Record<string, string> = {
  bad_amount: 'Укажите сумму — целое число рублей от 1 до 1 000 000.', too_many_requests: 'Слишком много заявок. Попробуйте позже.',
  page_unavailable: 'Страница оплаты больше не принимает заявки.', provider_unreachable: 'Платёжный партнёр сейчас недоступен. Оплатите переводом по реквизитам.', provider_error: 'Платёжный партнёр сейчас недоступен. Оплатите переводом по реквизитам.', provider_bad_answer: 'Платёжный партнёр ответил некорректно. Оплатите переводом по реквизитам.', provider_not_set: 'Оплата у партнёра недоступна.', network: 'Нет связи. Проверьте интернет и повторите.', not_found: 'Страница не найдена.',
};
const saved = (pid: string): { id: string; key: string } | null => { try { return JSON.parse(localStorage.getItem(`kbiz:pay:${pid}`) ?? 'null'); } catch { return null; } };

const CopyBtn = ({ text, label }: { text: string; label: string }) => {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" aria-label={label} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: ok ? 'var(--green)' : 'var(--t2)' }}>
      {ok ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
};

const Row = ({ k, v, copy }: { k: string; v: string; copy?: string }) => (
  <div className="flex items-center justify-between gap-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
    <div className="min-w-0">
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{k}</p>
      <p translate="no" className="text-sm font-semibold break-words" style={{ color: 'var(--t1)' }}>{v}</p>
    </div>
    {copy && <CopyBtn text={copy} label={`Скопировать: ${k}`} />}
  </div>
);

export const PayPage = ({ pid, embedded = false }: { pid: string; embedded?: boolean }) => {
  const [page, setPage] = useState<PublicPage | null>(null);
  const [err, setErr] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<{ id: string; key: string; label: string } | null>(null);

  const refreshStatus = useCallback(async (r: { id: string; key: string }) => {
    const s = await pubStatus(r.id, r.key);
    if (s.ok) setReq({ id: r.id, key: r.key, label: s.data.statusLabel });
  }, []);

  useEffect(() => {
    let alive = true;
    void pubPage(pid).then((r) => { if (!alive) return; if (r.ok) setPage(r.data); else setErr(ERR[r.error] ?? 'Не удалось открыть страницу.'); });
    const s = saved(pid); if (s) void refreshStatus(s);
    return () => { alive = false; };
  }, [pid, refreshStatus]);

  const report = async () => {
    if (!page) return;
    setBusy(true); setErr('');
    const body: { amountRub?: number; note?: string; website?: string } = { note, website: trap };
    if (page.amountRub == null) body.amountRub = Number(amount);
    const r = await pubReport(pid, body);
    setBusy(false);
    if (!r.ok) { setErr(ERR[r.error] ?? 'Не удалось отправить заявку.'); return; }
    try { localStorage.setItem(`kbiz:pay:${pid}`, JSON.stringify({ id: r.data.id, key: r.data.statusKey })); } catch { /* ok */ }
    setReq({ id: r.data.id, key: r.data.statusKey, label: r.data.statusLabel });
  };

  const payAtPartner = async () => {
    if (!page) return;
    setBusy(true); setErr('');
    const r = await pubProviderPay(pid, { ...(page.amountRub == null ? { amountRub: Number(amount) } : {}), note, website: trap });
    setBusy(false);
    if (!r.ok) { setErr(ERR[r.error] ?? 'Не удалось перейти к оплате у партнёра.'); return; }
    try { localStorage.setItem(`kbiz:pay:${pid}`, JSON.stringify({ id: r.data.id, key: r.data.statusKey })); } catch { /* ok */ }
    if (/^https?:\/\//i.test(r.data.url)) window.location.assign(r.data.url);
  };
  const wrap = (children: React.ReactNode) => (
    <div className={embedded ? 'h-full overflow-y-auto' : 'min-h-screen'} style={{ background: 'var(--bg)', color: 'var(--t1)' }}>
      <div className="mx-auto w-full max-w-md px-4 py-6" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>{children}</div>
    </div>
  );

  if (!page && !err) return wrap(<div className="grid place-items-center py-24"><Loader2 className="animate-spin" size={22} style={{ color: 'var(--t3)' }} /></div>);
  if (!page) return wrap(<p role="alert" className="py-24 text-center text-sm" style={{ color: 'var(--red)' }}>{err}</p>);

  const { business: b } = page;
  const head = (
    <div className="flex items-center gap-3 mb-4">
      {b.logoUrl ? <img src={uploadUrl(b.logoUrl)} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}><Store size={20} style={{ color: 'var(--t3)' }} /></div>}
      <div className="min-w-0">
        <p translate="no" className="text-base font-black truncate" style={{ color: 'var(--t1)' }}>{b.name}</p>
        {b.description && <p translate="no" className="text-xs line-clamp-2" style={{ color: 'var(--t3)' }}>{b.description}</p>}
      </div>
    </div>
  );

  if (page.state !== 'open') return wrap(<>{head}<div className="rounded-2xl p-4 text-sm" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t2)' }}><AlertTriangle size={16} className="mb-2" style={{ color: 'var(--amber)' }} />{STATE_TEXT[page.state] ?? STATE_TEXT.unavailable}</div></>);

  const r = page.requisites!;
  const fixed = page.amountRub != null;
  const sum = fixed ? `${page.amountRub} ₽` : amount ? `${amount} ₽` : '—';
  return wrap(
    <>
      {head}
      <div className="rounded-2xl p-4 mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        {page.tip?.photoUrl && <img src={uploadUrl(page.tip.photoUrl)} alt="" className="mb-3 h-20 w-20 rounded-full object-cover" />}
        <p translate="no" className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{page.tip ? `Чаевые: ${page.tip.recipient}` : page.title}</p>
        {page.tip?.message && <p translate="no" className="text-xs mt-0.5" style={{ color: 'var(--t2)' }}>{page.tip.message}</p>}
        {page.tip && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {page.tip.amounts.map((a) => <button key={a} type="button" onClick={() => setAmount(String(a))} aria-pressed={amount === String(a)} className="rounded-full px-3 py-2 text-sm font-semibold"
              style={{ background: amount === String(a) ? 'var(--accent)' : 'var(--bg-l2)', color: amount === String(a) ? '#fff' : 'var(--t1)', border: '1px solid var(--border)' }}>{a} ₽</button>)}
          </div>
        )}
        {page.description && <p translate="no" className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{page.description}</p>}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>К оплате</p>
            {fixed ? <p className="text-3xl font-black" translate="no" style={{ color: 'var(--t1)' }}>{page.amountRub} ₽</p> : page.tip && !page.tip.allowCustom ? <p className="text-3xl font-black" translate="no" style={{ color: 'var(--t1)' }}>{amount ? `${amount} ₽` : 'Выберите сумму'}</p> : (
              <label className="flex items-baseline gap-1">
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} placeholder="Сумма" aria-label="Сумма, рублей"
                  className="w-32 rounded-lg px-2 py-1.5 text-2xl font-black outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
                <span className="text-xl font-black">₽</span>
              </label>
            )}
          </div>
          {(fixed || amount) && <CopyBtn text={String(fixed ? page.amountRub : amount)} label="Скопировать сумму" />}
        </div>
        {page.orderNo && <p className="mt-2 text-xs" style={{ color: 'var(--t3)' }}>{page.kind === 'invoice' ? 'Счёт' : 'Заказ'} № <span translate="no">{page.orderNo}</span></p>}
        {page.lines && page.lines.length > 0 && (
          <ul className="mt-3 text-xs" style={{ color: 'var(--t2)' }}>
            {page.lines.map((l, i) => <li key={i} translate="no" className="flex justify-between gap-2 py-0.5"><span>{l.title}{l.variant ? ` (${l.variant})` : ''} × {l.qty}</span><span>{l.qty * l.priceRub - (l.discountRub ?? 0)} ₽</span></li>)}
            {page.discountRub ? <li className="flex justify-between gap-2 py-0.5 font-semibold" style={{ color: 'var(--green)' }}><span>Скидка по промокоду</span><span>−{page.discountRub} ₽</span></li> : null}
          </ul>
        )}
      </div>

      <div className="rounded-2xl p-4 mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-bold mb-1" style={{ color: 'var(--t2)' }}>Реквизиты для перевода</p>
        <Row k="Получатель" v={r.holder} copy={r.holder} />
        <Row k={METHOD[r.method] ?? 'Реквизиты'} v={r.value} copy={r.value.replace(/\s+/g, '')} />
        {r.bank && <Row k="Банк" v={r.bank} />}
        {r.extra && <Row k="Дополнительно" v={r.extra} copy={r.extra} />}
        {r.purpose && <Row k="Назначение платежа" v={r.purpose} copy={r.purpose} />}
        {page.instruction && <p translate="no" className="mt-3 text-xs" style={{ color: 'var(--t2)' }}>{page.instruction}</p>}
      </div>

      {req ? (
        <div className="rounded-2xl p-4 mb-3" role="status" style={{ background: 'color-mix(in srgb, var(--green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--green) 40%, transparent)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--green)' }}>Заявка отправлена владельцу</p>
          <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>Статус: <b translate="no">{req.label}</b></p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>Владелец проверит поступление сам и подтвердит. Sky деньги не принимает и перевод не проверяет.</p>
          <button type="button" onClick={() => void refreshStatus(req)} className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>Обновить статус</button>
        </div>
      ) : (
        <div className="rounded-2xl p-4 mb-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--t3)' }}>{fixed || amount ? `Переведите ${sum} по реквизитам выше, затем нажмите кнопку — владелец получит уведомление.` : 'Укажите сумму, переведите её по реквизитам выше и нажмите кнопку — владелец получит уведомление.'}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} rows={2} placeholder="Комментарий для владельца (необязательно)" aria-label="Комментарий"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
          <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          {err && <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
          {page.provider && (
            <button type="button" disabled={busy || (!fixed && !amount)} onClick={() => void payAtPartner()} className="mt-3 w-full rounded-xl py-3 text-sm font-black disabled:opacity-50" style={{ background: 'var(--bg-l2)', border: '1px solid var(--accent)', color: 'var(--t1)' }}>
              Оплатить у платёжного партнёра бизнеса
            </button>
          )}
          <button type="button" disabled={busy || (!fixed && !amount)} onClick={() => void report()}
            className="mt-3 w-full rounded-xl py-3 text-sm font-black disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? 'Отправляю…' : 'Я перевёл деньги'}
          </button>
        </div>
      )}

      <p className="flex gap-2 text-[11px]" style={{ color: 'var(--t3)' }}>
        <ShieldCheck size={14} className="shrink-0" />
        {page.note ?? 'Это прямой перевод владельцу бизнеса.'} Никогда не вводите на этой странице PIN-код, CVV или коды из SMS — их здесь не просят.
      </p>
      {(b.contacts || b.website) && <p translate="no" className="mt-2 text-[11px] break-all" style={{ color: 'var(--t3)' }}>{b.contacts}{b.contacts && b.website ? ' · ' : ''}{b.website}</p>}
    </>,
  );
};
