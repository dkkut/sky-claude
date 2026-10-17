/* SkyKassa Business, этап 3: касса, команда, промокоды, отзывы, аналитика, приглашения.
   Права сотрудников решает сервер (роль); здесь кнопки лишь не показываются тем, кому они недоступны. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Copy, Check, Star, Trash2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import * as K from './api';
import { qrSvg } from './qr';
import { card, field, why, dt, Btn, In } from './ui';

const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => flash('Скопировано')); };
const Wait = () => <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--t3)' }} /></div>;
const ROLE_HINT: Record<K.StaffRole, string> = {
  admin: 'Всё, кроме реквизитов, подписки, публикации и команды.',
  manager: 'Каталог, заказы, счета, чаевые, промокоды, отзывы, подтверждение оплат, касса, аналитика.',
  cashier: 'Только касса и просмотр обзора и заявок. Подтверждать оплату не может.',
};

/* ── Приглашения (на экране подключения бизнеса и в кабинете) ── */
export const Invites = ({ invites, onDone }: { invites: NonNullable<K.Me['invites']>; onDone: () => void }) => {
  if (!invites.length) return null;
  const answer = async (id: string, accept: boolean) => {
    if (accept && !window.confirm('Вы станете сотрудником этого бизнеса. Принять приглашение?')) return;
    const r = await K.kbInviteAnswer(id, accept); if (!r.ok) flash(why(r)); onDone();
  };
  return (
    <div className="mb-3 space-y-2">
      {invites.map((i) => (
        <div key={i.id} className="rounded-2xl p-3" style={{ ...card, border: '1px solid var(--accent)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Приглашение в «<span translate="no">{i.business}</span>»</p>
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Роль: {i.roleLabel}. Владелец сможет отозвать доступ в любой момент.</p>
          <div className="mt-2 flex gap-2"><Btn small tone="accent" onClick={() => void answer(i.id, true)}>Принять</Btn><Btn small onClick={() => void answer(i.id, false)}>Отказаться</Btn></div>
        </div>
      ))}
    </div>
  );
};

/* ── Касса ── */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];
const CASH_STATUS: Record<string, string> = { waiting: 'Ждём перевод', reported: 'Покупатель сообщил о переводе', pending_check: 'На проверке', confirmed: 'Оплата подтверждена', not_found: 'Оплата не обнаружена', cancelled: 'Отменено', expired: 'Время вышло', created: 'Ждём перевод' };
export const Cash = ({ canConfirm }: { canConfirm: boolean }) => {
  const [digits, setDigits] = useState(''); const [note, setNote] = useState('');
  const [cur, setCur] = useState<{ id: string; url: string; amountRub: number; left: number } | null>(null); const [svg, setSvg] = useState(''); const [status, setStatus] = useState('waiting');
  const [recent, setRecent] = useState<K.CashItem[]>([]); const [busy, setBusy] = useState(false);
  const loadRecent = useCallback(async () => { const r = await K.kbCashRecent(); if (r.ok) setRecent(r.data.items); }, []);
  useEffect(() => { void loadRecent(); }, [loadRecent]);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!cur) return;
    void qrSvg(cur.url, 260).then(setSvg);
    const tick = window.setInterval(async () => {
      setCur((c) => (c ? { ...c, left: Math.max(0, c.left - 3) } : c));
      const r = await K.kbCashStatus(cur.id); if (r.ok) setStatus(r.data.status);
    }, 3000);
    timer.current = tick; return () => window.clearInterval(tick);
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (k: string) => setDigits((d) => (k === '⌫' ? d.slice(0, -1) : (d + k).replace(/^0+/, '').slice(0, 7)));
  const amount = Number(digits) || 0;
  const create = async () => {
    setBusy(true); const r = await K.kbCashCreate(amount, note); setBusy(false);
    if (!r.ok) { flash(r.error === 'not_published' ? 'Сначала опубликуйте бизнес.' : r.error === 'requisites_required' ? 'Сначала укажите реквизиты.' : why(r)); return; }
    setStatus('waiting'); setSvg(''); setCur({ id: r.data.id, url: r.data.url, amountRub: r.data.amountRub, left: r.data.expiresInSec });
  };
  const done = () => { setCur(null); setDigits(''); setNote(''); void loadRecent(); };
  if (cur) {
    const fin = ['confirmed', 'not_found', 'cancelled', 'expired'].includes(status) || cur.left <= 0;
    return (
      <div className="rounded-2xl p-4 text-center" style={card}>
        <p className="text-3xl font-black" style={{ color: 'var(--t1)' }}>{cur.amountRub} ₽</p>
        <div className="mx-auto my-3 rounded-xl overflow-hidden bg-white p-2" style={{ width: 240, height: 240 }} dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="224" height="224"') }} />
        <p role="status" className="text-sm font-bold" style={{ color: status === 'confirmed' ? 'var(--green)' : 'var(--t1)' }}>{status === 'confirmed' && <Check size={14} className="inline" />} {cur.left <= 0 && status !== 'confirmed' ? 'Время вышло' : CASH_STATUS[status] ?? status}</p>
        <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>Покупатель наводит камеру или открывает ссылку, переводит сумму по реквизитам. Sky перевод не проверяет — {canConfirm ? 'подтвердите поступление в «Приём оплаты».' : 'подтвердить оплату сможет менеджер или владелец.'}</p>
        <div className="mt-3 flex justify-center gap-2"><Btn small onClick={() => copy(cur.url)}><Copy size={12} className="inline" /> Ссылка</Btn><Btn small tone={fin ? 'accent' : 'ghost'} onClick={done}>{fin ? 'Новая операция' : 'Закрыть'}</Btn></div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Сумма к оплате</p>
        <p className="text-4xl font-black" style={{ color: 'var(--t1)' }}>{amount} ₽</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {KEYS.map((k) => <button key={k} type="button" onClick={() => press(k)} aria-label={k === '⌫' ? 'Стереть' : k} className="rounded-xl py-3.5 text-xl font-bold" style={{ ...field }}>{k}</button>)}
        </div>
        <div className="mt-3"><In label="Комментарий (стол, заказ…)" value={note} onChange={setNote} max={200} /></div>
        <div className="mt-3"><Btn tone="accent" disabled={!amount || busy} onClick={() => void create()}>{busy ? 'Создаю…' : `Выставить ${amount || ''} ₽`}</Btn></div>
      </div>
      {recent.length > 0 && (
        <div className="rounded-2xl p-3" style={card}>
          <p className="text-xs font-bold mb-1" style={{ color: 'var(--t2)' }}>Последние операции</p>
          {recent.slice(0, 8).map((x) => <p key={x.id} className="flex justify-between text-xs py-1" style={{ color: 'var(--t2)', borderBottom: '1px solid var(--border)' }}><span>{dt(x.createdAt)} · {x.amountRub} ₽</span><span>{CASH_STATUS[x.status] ?? x.status}</span></p>)}
        </div>
      )}
    </div>
  );
};

/* ── Команда ── */
export const Team = () => {
  const [list, setList] = useState<K.StaffMember[] | null>(null); const [f, setF] = useState({ username: '', role: 'cashier' as K.StaffRole }); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await K.kbStaff(); if (r.ok) setList(r.data.staff); }, []);
  useEffect(() => { void load(); }, [load]);
  const invite = async () => {
    setBusy(true); const r = await K.kbStaffInvite(f.username, f.role); setBusy(false);
    if (!r.ok) { flash(r.error === 'user_not_found' ? 'Такого @username нет.' : r.error === 'already_in_business' ? 'Этот человек уже состоит в бизнесе или владеет своим.' : r.error === 'too_many_staff' ? 'Не больше 30 сотрудников.' : why(r)); return; }
    flash('Приглашение отправлено'); setF({ ...f, username: '' }); void load();
  };
  if (!list) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 space-y-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Пригласить сотрудника</p>
        <In label="@username в Sky" value={f.username} onChange={(v) => setF({ ...f, username: v.replace(/\s/g, '') })} max={40} ph="@username" />
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Роль
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as K.StaffRole })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field}>
            <option value="cashier">Кассир</option><option value="manager">Менеджер</option><option value="admin">Администратор</option></select></label>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{ROLE_HINT[f.role]} Реквизиты, подписку, публикацию и команду меняет только владелец. Человек должен принять приглашение; в одном бизнесе — не более 30 человек.</p>
        <Btn tone="accent" disabled={busy || f.username.replace('@', '').length < 2} onClick={() => void invite()}>Пригласить</Btn>
      </div>
      {!list.length && <p className="text-sm" style={{ color: 'var(--t3)' }}>Сотрудников пока нет.</p>}
      {list.map((s) => (
        <div key={s.id} className="rounded-2xl p-3 flex items-center gap-3" style={card}>
          <div className="min-w-0 flex-1">
            <p translate="no" className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{s.name} <span className="font-normal" style={{ color: 'var(--t3)' }}>@{s.username}</span></p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{s.roleLabel} · {s.status === 'invited' ? 'ждёт принятия' : 'работает'}</p>
          </div>
          <select aria-label="Роль" value={s.role} onChange={async (e) => { const r = await K.kbStaffRole(s.id, e.target.value as K.StaffRole); if (!r.ok) flash(why(r)); void load(); }} className="rounded-lg px-2 py-1.5 text-xs" style={field}>
            <option value="cashier">Кассир</option><option value="manager">Менеджер</option><option value="admin">Администратор</option></select>
          <Btn small tone="danger" onClick={async () => { if (!window.confirm(`Убрать @${s.username}? Доступ закроется сразу.`)) return; const r = await K.kbStaffRemove(s.id); if (!r.ok) flash(why(r)); void load(); }}><Trash2 size={12} /></Btn>
        </div>
      ))}
    </div>
  );
};

/* ── Промокоды ── */
const PROMO_ERR: Record<string, string> = { code: 'Код: 3–24 знака, латиница, цифры, «-» и «_».', value: 'Значение: процент 1–90 или рубли.', expiresAt: 'Срок окончания должен быть в будущем.', maxUses: 'Лимит использований — целое число.' };
export const Promos = () => {
  const [list, setList] = useState<K.Promo[] | null>(null); const [form, setForm] = useState(false);
  const [f, setF] = useState({ code: '', kind: 'percent' as 'percent' | 'fixed', value: '10', minOrderRub: '', maxUses: '', expiresAt: '' });
  const load = useCallback(async () => { const r = await K.kbPromos(); if (r.ok) setList(r.data.promos); }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    const r = await K.kbPromoCreate({ code: f.code, kind: f.kind, value: Number(f.value), minOrderRub: Number(f.minOrderRub) || 0, maxUses: f.maxUses ? Number(f.maxUses) : undefined, expiresAt: f.expiresAt || undefined });
    if (!r.ok) { flash(r.error === 'code_taken' ? 'Такой код уже есть.' : PROMO_ERR[r.field ?? ''] ?? why(r)); return; }
    setForm(false); setF({ ...f, code: '' }); void load();
  };
  if (!list) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Промокоды</p><Btn small tone="accent" onClick={() => setForm(true)}><Plus size={12} className="inline" /> Промокод</Btn></div>
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Скидка применяется на витрине к сумме товаров; итог не бывает меньше 1 ₽. Использование считает сервер: код с лимитом не достанется двум заказам сразу.</p>
      {form && (
        <div className="rounded-2xl p-4 space-y-2" style={card}>
          <In label="Код" value={f.code} onChange={(v) => setF({ ...f, code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} max={24} ph="SALE10" />
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Вид<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'percent' | 'fixed' })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field}><option value="percent">Процент</option><option value="fixed">Рубли</option></select></label>
            <In label={f.kind === 'percent' ? 'Скидка, %' : 'Скидка, ₽'} value={f.value} onChange={(v) => setF({ ...f, value: v.replace(/\D/g, '') })} max={7} />
          </div>
          <div className="grid grid-cols-2 gap-2"><In label="Заказ от, ₽" value={f.minOrderRub} onChange={(v) => setF({ ...f, minOrderRub: v.replace(/\D/g, '') })} max={7} /><In label="Макс. использований" value={f.maxUses} onChange={(v) => setF({ ...f, maxUses: v.replace(/\D/g, '') })} max={7} /></div>
          <In label="Действует до (необязательно)" type="date" value={f.expiresAt} onChange={(v) => setF({ ...f, expiresAt: v })} />
          <div className="flex gap-2"><Btn tone="accent" disabled={f.code.length < 3} onClick={() => void create()}>Создать</Btn><Btn onClick={() => setForm(false)}>Отмена</Btn></div>
        </div>
      )}
      {!list.length && !form && <p className="text-sm" style={{ color: 'var(--t3)' }}>Промокодов нет.</p>}
      {list.map((p) => (
        <div key={p.id} className="rounded-2xl p-3 flex items-center gap-3" style={card}>
          <div className="min-w-0 flex-1">
            <p translate="no" className="text-sm font-black" style={{ color: 'var(--t1)' }}>{p.code} <span className="font-normal" style={{ color: 'var(--accent)' }}>{p.kind === 'percent' ? `−${p.value}%` : `−${p.value} ₽`}</span></p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Использован {p.used}{p.maxUses ? ` из ${p.maxUses}` : ''}{p.minOrderRub ? ` · заказ от ${p.minOrderRub} ₽` : ''}{p.expiresAt ? ` · до ${dt(p.expiresAt)}` : ''} · {p.status === 'active' ? 'включён' : 'на паузе'}</p>
          </div>
          <Btn small onClick={async () => { const r = await K.kbPromoStatus(p.id, p.status === 'active' ? 'paused' : 'active'); if (!r.ok) flash(why(r)); void load(); }}>{p.status === 'active' ? 'Пауза' : 'Включить'}</Btn>
        </div>
      ))}
    </div>
  );
};

/* ── Отзывы ── */
const Stars = ({ n }: { n: number }) => <span aria-label={`Оценка ${n} из 5`} style={{ color: 'var(--amber)' }}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} className="inline" fill={i <= n ? 'currentColor' : 'none'} />)}</span>;
export const Reviews = () => {
  const [list, setList] = useState<K.Review[] | null>(null); const [reply, setReply] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await K.kbReviews(); if (r.ok) setList(r.data.reviews); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!list) return <Wait />;
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Отзыв может оставить только покупатель по своему выполненному заказу, один раз. Накрутить рейтинг нельзя; скрыть отзыв можно, удалить — нет. Скрытые не попадают в рейтинг на витрине.</p>
      {!list.length && <p className="text-sm" style={{ color: 'var(--t3)' }}>Отзывов пока нет.</p>}
      {list.map((r) => (
        <div key={r.id} className="rounded-2xl p-3" style={{ ...card, opacity: r.status === 'hidden' ? 0.6 : 1 }}>
          <p className="text-sm"><Stars n={r.rating} /> <span translate="no" className="font-bold" style={{ color: 'var(--t1)' }}>{r.author}</span> <span className="text-[11px]" style={{ color: 'var(--t3)' }}>· заказ № {r.orderNo} · {dt(r.createdAt)}{r.status === 'hidden' ? ' · скрыт' : ''}</span></p>
          {r.text && <p translate="no" className="text-sm mt-1" style={{ color: 'var(--t2)' }}>{r.text}</p>}
          {r.reply && <p translate="no" className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Ответ: {r.reply}</p>}
          <div className="mt-2 flex gap-1.5">
            <input aria-label="Ответ" value={reply[r.id] ?? ''} maxLength={400} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} placeholder="Ответить на отзыв" className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none" style={field} />
            <Btn small disabled={!(reply[r.id] ?? '').trim()} onClick={async () => { const x = await K.kbReviewAct(r.id, { reply: reply[r.id] }); if (!x.ok) flash(why(x)); setReply({ ...reply, [r.id]: '' }); void load(); }}>Ответить</Btn>
            <Btn small onClick={async () => { const x = await K.kbReviewAct(r.id, { status: r.status === 'hidden' ? 'published' : 'hidden' }); if (!x.ok) flash(why(x)); void load(); }}>{r.status === 'hidden' ? 'Показать' : 'Скрыть'}</Btn>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Аналитика ── */
const KIND: Record<string, string> = { pay: 'QR на сумму', permanent: 'Постоянный QR', tip: 'Чаевые', order: 'Заказы витрины', invoice: 'Счета', cash: 'Касса' };
export const AnalyticsView = () => {
  const [days, setDays] = useState(30); const [a, setA] = useState<K.Analytics | null | undefined>(undefined);
  useEffect(() => { setA(undefined); void K.kbAnalytics(days).then((r) => setA(r.ok ? r.data.analytics : null)); }, [days]);
  if (a === undefined) return <Wait />;
  if (!a) return <p className="text-sm" style={{ color: 'var(--t3)' }}>Данных пока нет.</p>;
  const max = Math.max(1, ...a.byDay.map((d) => d.confirmedSumRub));
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">{[7, 30, 90].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ ...field, ...(days === d ? { border: '1px solid var(--accent)' } : {}) }}>{d} дн.</button>)}</div>
      <div className="grid grid-cols-2 gap-2">
        {([['Подтверждено владельцем', `${a.confirmedSumRub} ₽`], ['Заявлено покупателями', `${a.claimedSumRub} ₽`], ['Оплат подтверждено', a.confirmed], ['Средний чек', `${a.averageRub} ₽`], ['Открытий страниц', a.opens], ['Конверсия в оплату', a.conversionPercent == null ? '—' : `${a.conversionPercent}%`]] as [string, string | number][]).map(([k, v]) => <div key={k} className="rounded-2xl p-3" style={card}><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{k}</p><p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{v}</p></div>)}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>«Подтверждено» — только оплаты, которые подтвердил владелец или сотрудник с правом. Подтверждений от платёжных партнёров пока нет. Не обнаружено: {a.notFound}, возвратов: {a.refunded}.</p>
      {a.byDay.length > 0 && (
        <div className="rounded-2xl p-3" style={card}>
          <p className="text-xs font-bold mb-2" style={{ color: 'var(--t2)' }}>Подтверждённые оплаты по дням</p>
          <div className="flex items-end gap-1 h-24" role="img" aria-label="График подтверждённых оплат по дням">
            {a.byDay.map((d) => <div key={d.day} title={`${d.day}: ${d.confirmedSumRub} ₽`} className="flex-1 rounded-t" style={{ height: `${Math.max(3, (d.confirmedSumRub / max) * 100)}%`, background: 'var(--accent)', opacity: d.confirmedSumRub ? 1 : 0.25 }} />)}
          </div>
        </div>
      )}
      {a.byKind.length > 0 && <div className="rounded-2xl p-3" style={card}><p className="text-xs font-bold mb-1" style={{ color: 'var(--t2)' }}>Откуда оплаты</p>{a.byKind.map((k) => <p key={k.kind} className="flex justify-between text-xs py-1" style={{ color: 'var(--t2)', borderBottom: '1px solid var(--border)' }}><span>{KIND[k.kind] ?? k.kind} · заявок {k.requests}</span><span>{k.confirmedSumRub} ₽ ({k.confirmed})</span></p>)}</div>}
      {a.topItems.length > 0 && <div className="rounded-2xl p-3" style={card}><p className="text-xs font-bold mb-1" style={{ color: 'var(--t2)' }}>Что покупают (по оплаченным заказам)</p>{a.topItems.map((t) => <p key={t.title} translate="no" className="flex justify-between text-xs py-1" style={{ color: 'var(--t2)', borderBottom: '1px solid var(--border)' }}><span>{t.title} × {t.qty}</span><span>{t.sumRub} ₽</span></p>)}</div>}
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Заказов: {a.orders.total}, выполнено {a.orders.done}, потеряно {a.orders.lost}; скидок по промокодам на {a.orders.discountsRub} ₽. Отзывов: {a.reviews.count}{a.reviews.count ? `, средняя оценка ${a.reviews.average}` : ''}.</p>
    </div>
  );
};
