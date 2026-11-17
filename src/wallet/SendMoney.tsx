/**
 * Перевод по Sky ID (@нику): 1) ввод → сервер проверяет получателя и отдаёт подтверждённые сведения; 2) человек проверяет получателя;
 * 3) сумма и валюта → сервер считает комиссию и итог, выдаёт подписанную котировку; 4) подтверждение → сервер повторно проверяет всё и выполняет.
 * Клиент ничего не решает: ни получателя, ни комиссию, ни баланс — только показывает ответы сервера (server/walletp2p.mjs).
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Check, Send } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { VerifiedBadge } from '@/verification/marks';
import { useMoney } from './store';
import { Secret } from './Secret';

interface Rcp { id: string; name: string; username: string; avatar?: string; memberSince: string; mark: 'verified' | 'official' | null }
interface Quote { recipient: Rcp; currency: string; amount: number; fee: number; total: number; rate?: number; rubEquiv: number; token: string; expiresAt: number }
interface Done { id: string; currency: string; amount: number; fee: number; total: number; recipient: { name: string; username: string }; duplicate?: boolean }
interface Acc { currency: string; balance: number }
interface HistItem { id: string; kind: string; currency: string; amount: number; fee?: number; rate?: number; counterparty?: string; desc?: string; createdAt: string }

const ERR: Record<string, string> = {
  not_found: 'Такого пользователя нет', cannot_send_to_self: 'Нельзя переводить самому себе', recipient_unavailable: 'Получатель сейчас не может принимать переводы',
  transfers_disabled: 'Переводы временно отключены', invalid_amount: 'Введите корректную сумму', amount_too_small: 'Сумма меньше минимальной', amount_too_large: 'Сумма больше допустимой',
  daily_limit: 'Достигнут суточный лимит переводов', new_account_limit: 'Для нового аккаунта действует сниженный лимит', too_fast: 'Слишком много переводов подряд — подождите несколько минут',
  insufficient_funds: 'Недостаточно средств (с учётом комиссии)', currency_unavailable: 'Эта валюта сейчас недоступна', no_account: 'У вас нет счёта в этой валюте',
  recipient_no_account: 'У получателя нет счёта в этой валюте', quote_changed: 'Условия изменились — проверьте данные и повторите', quote_expired: 'Время подтверждения истекло — повторите',
  idem_conflict: 'Эта операция уже выполнялась с другими данными', too_many_requests: 'Слишком часто — подождите немного', bad_currency: 'Неизвестная валюта',
};
const ru = (e?: string) => ERR[e ?? ''] ?? 'Не получилось. Попробуйте позже';
const cardSty = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const inSty = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const fmt = (cur: string, units: number) => (cur === 'RUB' ? `${units.toLocaleString('ru')} ₽` : `${(units / 100).toLocaleString('ru', { minimumFractionDigits: 2 })} ${cur}`);
const newKey = () => `p2p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const SendMoney = ({ onBack }: { onBack: () => void }) => {
  const [step, setStep] = useState<'who' | 'check' | 'amount' | 'confirm' | 'done'>('who');
  const [handle, setHandle] = useState(''); const [rcp, setRcp] = useState<Rcp | null>(null);
  const [cur, setCur] = useState('RUB'); const [amount, setAmount] = useState(''); const [accs, setAccs] = useState<Acc[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null); const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [key, setKey] = useState(newKey);
  const [hist, setHist] = useState<HistItem[] | null>(null); const [hcur, setHcur] = useState('ALL');
  useEffect(() => { void apiCall<{ accounts: Acc[] }>('/api/wallet/fx').then((r) => { if (r.ok && r.data) setAccs(r.data.accounts); }); }, []);

  const loadHist = async (c: string) => { setHcur(c); const r = await apiCall<{ items: HistItem[] }>(`/api/wallet/history?currency=${c}&limit=50`); if (r.ok && r.data) setHist(r.data.items); };
  const KIND: Record<string, string> = { p2p_out: 'Перевод', p2p_in: 'Получено', fx_exchange: 'Обмен', rub: 'Операция' };
  const units = () => { const n = Number(String(amount).replace(',', '.')); if (!Number.isFinite(n) || n <= 0) return 0; return cur === 'RUB' ? (Number.isInteger(n) ? n : 0) : Math.round(n * 100); };
  const lookup = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ recipient: Rcp }>('/api/wallet/transfer/lookup', { method: 'POST', body: JSON.stringify({ skyId: handle }) });
    setBusy(false);
    if (r.ok && r.data) { setRcp(r.data.recipient); setStep('check'); } else setErr(ru(r.error));
  };
  const getQuote = async () => {
    if (!rcp) return; const u = units(); if (!u) { setErr(ru('invalid_amount')); return; }
    setBusy(true); setErr('');
    const r = await apiCall<Quote>('/api/wallet/transfer/quote', { method: 'POST', body: JSON.stringify({ recipientId: rcp.id, currency: cur, amount: u }) });
    setBusy(false);
    if (r.ok && r.data) { setQuote(r.data); setKey(newKey()); setStep('confirm'); } else setErr(ru(r.error));
  };
  const send = async () => {
    if (!quote) return; setBusy(true); setErr('');
    const r = await apiCall<Done>('/api/wallet/transfer', { method: 'POST', body: JSON.stringify({ recipientId: quote.recipient.id, currency: quote.currency, amount: quote.amount, token: quote.token, idemKey: key }) });
    setBusy(false);
    if (r.ok && r.data) { setDone(r.data); setStep('done'); void useMoney.getState().refresh(); }
    else { setErr(ru(r.error)); if (r.error === 'quote_changed' || r.error === 'quote_expired') setStep('amount'); }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-center gap-2 py-3">
        <button type="button" onClick={step === 'done' ? onBack : step === 'who' ? onBack : () => setStep(step === 'confirm' ? 'amount' : step === 'amount' ? 'check' : 'who')} aria-label="Назад" className="grid h-9 w-9 place-items-center rounded-full" style={cardSty}><ArrowLeft size={16} /></button>
        <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>Перевод по Sky ID</p>
      </div>
      {err && <p role="alert" className="mb-3 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{err}</p>}

      {step === 'who' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Введите @ник человека. Прежде чем переводить деньги, вы увидите, кому именно уходит перевод.</p>
          <input className="w-full rounded-xl px-3 py-3 text-sm outline-none" style={inSty} value={handle} placeholder="@username" autoCapitalize="none" autoCorrect="off" onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && handle.trim()) void lookup(); }} />
          <button type="button" disabled={busy || handle.trim().length < 2} onClick={() => void lookup()} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>{busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Найти'}</button>
          <button type="button" onClick={() => void loadHist(hcur)} className="w-full rounded-xl py-2.5 text-xs font-semibold" style={cardSty}>История операций по валютам</button>
          {hist && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">{['ALL', 'RUB', ...accs.map((a) => a.currency)].map((c) => <button key={c} type="button" onClick={() => void loadHist(c)} className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: hcur === c ? 'var(--accent)' : 'var(--bg-l2)', color: hcur === c ? '#fff' : 'var(--t1)' }}><span translate="no">{c === 'ALL' ? 'Все' : c}</span></button>)}</div>
              {hist.length === 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Операций пока нет.</p>}
              {hist.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-2 rounded-xl px-3 py-2 text-xs" style={cardSty}>
                  <span style={{ color: 'var(--t2)' }}>{KIND[h.kind] ?? 'Операция'}{h.counterparty ? ' ' : ''}<span translate="no">{h.counterparty ?? ''}</span>{h.fee ? ` · комиссия ${fmt(h.currency, h.fee)}` : ''}{h.rate ? ` · курс ${h.rate}` : ''}<br /><span style={{ color: 'var(--t3)' }}>{new Date(h.createdAt).toLocaleString('ru')}</span></span>
                  <b style={{ color: h.amount < 0 ? 'var(--t1)' : '#22c55e' }}><Secret>{h.amount > 0 ? '+' : ''}{fmt(h.currency, h.amount)}</Secret></b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'check' && rcp && (
        <div className="space-y-3">
          <div className="rounded-2xl p-4" style={cardSty}>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Получатель</p>
            <p className="mt-1 text-lg font-bold" style={{ color: 'var(--t1)' }}><span translate="no">{rcp.name}</span><VerifiedBadge type="user" id={rcp.id} size={16} /></p>
            <p className="text-sm" style={{ color: 'var(--t2)' }} translate="no">@{rcp.username}</p>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>В Sky с {new Date(rcp.memberSince).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}</p>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Убедитесь, что это нужный человек: переводы нельзя отменить. Сверьте имя и @ник.</p>
          <button type="button" onClick={() => setStep('amount')} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>Это он — продолжить</button>
          <button type="button" onClick={() => { setRcp(null); setStep('who'); }} className="w-full rounded-xl py-3 text-sm font-semibold" style={cardSty}>Другой получатель</button>
        </div>
      )}

      {step === 'amount' && rcp && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Кому: <b translate="no">@{rcp.username}</b></p>
          <div className="flex flex-wrap gap-2">
            {['RUB', ...accs.map((a) => a.currency)].map((c) => (
              <button key={c} type="button" onClick={() => { setCur(c); setAmount(''); }} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: cur === c ? 'var(--accent)' : 'var(--bg-l2)', color: cur === c ? '#fff' : 'var(--t1)' }}><span translate="no">{c === 'RUB' ? '₽ RUB' : c}</span></button>
            ))}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Валюты не смешиваются: перевод идёт со счёта выбранной валюты на такой же счёт получателя. Обмен — отдельно, в «Валютных счетах».</p>
          <input className="w-full rounded-xl px-3 py-3 text-lg outline-none" style={inSty} inputMode="decimal" value={amount} placeholder={cur === 'RUB' ? 'Сумма, ₽ (целое число)' : `Сумма, ${cur}`} onChange={(e) => setAmount(e.target.value)} />
          {accs.length > 0 && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Ваши валютные счета: {accs.map((a) => <Secret key={a.currency}>{fmt(a.currency, a.balance)}</Secret>).reduce<React.ReactNode[]>((p, n, i) => (i ? [...p, ' · ', n] : [n]), [])}</p>}
          <button type="button" disabled={busy || !units()} onClick={() => void getQuote()} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>{busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Рассчитать'}</button>
        </div>
      )}

      {step === 'confirm' && quote && (
        <div className="space-y-3">
          <div className="space-y-2 rounded-2xl p-4" style={cardSty}>
            <Row k="Получатель" v={<span translate="no">{quote.recipient.name} · @{quote.recipient.username}</span>} />
            <Row k="Сумма перевода" v={fmt(quote.currency, quote.amount)} />
            <Row k="Комиссия" v={quote.fee ? fmt(quote.currency, quote.fee) : 'без комиссии'} />
            <div className="h-px" style={{ background: 'var(--border)' }} />
            <Row k="Спишется" v={<b>{fmt(quote.currency, quote.total)}</b>} />
            {quote.rate && <Row k="Курс на момент операции" v={`1 ${quote.currency} = ${quote.rate} ₽`} />}
          </div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Перед выполнением сервер ещё раз проверит получателя, сумму, комиссию, лимиты и баланс. Перевод нельзя отменить.</p>
          <button type="button" disabled={busy} onClick={() => void send()} className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>{busy ? <Loader2 size={16} className="animate-spin" /> : <><Send size={15} />Подтвердить и отправить</>}</button>
        </div>
      )}

      {step === 'done' && done && (
        <div className="space-y-3 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: 'rgba(34,197,94,0.15)' }}><Check size={26} style={{ color: '#22c55e' }} /></div>
          <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>{done.duplicate ? 'Перевод уже выполнен' : 'Перевод выполнен'}</p>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>{fmt(done.currency, done.amount)} → <span translate="no">@{done.recipient?.username}</span>{done.fee ? `, комиссия ${fmt(done.currency, done.fee)}` : ''}</p>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Запись сохранена в истории операций.</p>
          <button type="button" onClick={onBack} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>Готово</button>
        </div>
      )}
    </div>
  );
};

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-3 text-sm"><span style={{ color: 'var(--t3)' }}>{k}</span><span className="text-right" style={{ color: 'var(--t1)' }}>{v}</span></div>
);
