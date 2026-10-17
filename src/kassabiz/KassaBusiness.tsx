/* SkyKassa Business — кабинет бизнеса (Профиль → Sky для бизнеса). Этап 1: бизнес и режим, реквизиты, подписка, QR-коды, заявки на оплату, журнал.
   Sky деньги покупателей не принимает: прямой перевод идёт владельцу по его реквизитам, а «оплачено» ставит только владелец. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Store, QrCode, Wallet, ListChecks, ShieldCheck, Landmark, History, LayoutDashboard, Copy, Download, Printer, Power, Archive, Plus, Building2, MapPin, Layers, Package, ShoppingBag, Globe, HeartHandshake, FileText } from 'lucide-react';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';
import { flash } from '@/shared/flash';
import * as K from './api';
import { qrSvg, downloadPng, downloadSvg, printQr } from './qr';

import { Items, ShopSettings, Orders, Tips, Invoices } from './Catalog';
import { card, field, why, dt, Btn, In, Stat, REASON } from './ui';
const MODE: Record<K.Mode, { title: string; hint: string; icon: typeof Store }> = {
  online: { title: 'Онлайн-платформа', hint: 'Платёжные ссылки и страницы оплаты, заказы и счета для клиентов в интернете.', icon: Layers },
  point: { title: 'Реальная точка', hint: 'QR на стойке или столе, чаевые, кассовый режим — для магазинов, мастерских, кафе и курьеров.', icon: MapPin },
  both: { title: 'Онлайн и точка', hint: 'Оба набора возможностей в одном кабинете.', icon: Building2 },
};
const LEGAL: Record<K.LegalType, string> = { person: 'Физическое лицо', selfemployed: 'Самозанятый', ip: 'ИП', company: 'Юридическое лицо', other: 'Другое' };
const SUB: Record<string, string> = { inactive: 'Не активирована', active: 'Активна', expiring: 'Скоро истекает', suspended: 'Приостановлена', expired: 'Истекла' };
const AUDIT: Record<string, string> = {
  business_created: 'Бизнес подключён', business_updated: 'Данные бизнеса изменены', logo_changed: 'Логотип изменён', requisites_set: 'Реквизиты указаны', requisites_changed: 'Реквизиты изменены',
  published: 'Бизнес опубликован', unpublished: 'Бизнес скрыт', qr_created: 'Создан QR-код', permanent_qr_created: 'Создан постоянный QR-код', qr_active: 'QR-код включён',
  qr_disabled: 'QR-код отключён', qr_archived: 'QR-код в архиве', subscription_paid: 'Подписка оплачена', payment_take: 'Заявка взята на проверку', payment_confirm: 'Оплата подтверждена владельцем',
  payment_not_found: 'Оплата не обнаружена', payment_cancel: 'Заявка отменена', payment_refund: 'Возврат выполнен владельцем',
};

/* ── Мастер подключения ── */
const Setup = ({ onDone }: { onDone: () => void }) => {
  const [f, setF] = useState({ name: '', mode: 'both' as K.Mode, legalType: 'person' as K.LegalType, category: '', country: 'RU', description: '', contacts: '', website: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const go = async () => {
    setBusy(true); const r = await K.kbCreateBusiness(f); setBusy(false);
    if (!r.ok) { flash(why(r)); return; }
    onDone();
  };
  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>Подключить бизнес</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>SkyKassa Business — QR-коды и страницы оплаты, чаевые, счета и каталог. Sky не принимает деньги покупателей и не берёт комиссию с продаж: переводы идут вам напрямую по вашим реквизитам. Подписка — 89 ₽ в месяц.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(MODE) as K.Mode[]).map((m) => {
          const I = MODE[m].icon; const on = f.mode === m;
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => setF({ ...f, mode: m })} className="rounded-2xl p-3 text-left"
              style={{ ...card, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-l1))' : card.background }}>
              <I size={18} style={{ color: 'var(--accent)' }} /><p className="mt-1 text-sm font-bold" style={{ color: 'var(--t1)' }}>{MODE[m].title}</p><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{MODE[m].hint}</p>
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <In label="Название бизнеса" value={f.name} onChange={set('name')} max={80} />
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Тип деятельности
          <select value={f.legalType} onChange={(e) => setF({ ...f, legalType: e.target.value as K.LegalType })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field}>
            {(Object.keys(LEGAL) as K.LegalType[]).map((k) => <option key={k} value={k}>{LEGAL[k]}</option>)}
          </select>
        </label>
        <In label="Категория (например, кафе, ремонт, курьер)" value={f.category} onChange={set('category')} max={60} />
        <In label="Страна (код, RU)" value={f.country} onChange={set('country')} max={2} />
        <In label="Контакты для покупателей" value={f.contacts} onChange={set('contacts')} max={200} />
        <In label="Сайт (https://…)" value={f.website} onChange={set('website')} max={200} />
      </div>
      <In label="Описание" value={f.description} onChange={set('description')} max={500} />
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Выбранный статус (самозанятый, ИП…) — ваши слова: Sky его не проверяет и не называет подтверждённым.</p>
      <Btn tone="accent" onClick={() => void go()} disabled={busy || f.name.trim().length < 2}>{busy ? 'Подключаю…' : 'Подключить'}</Btn>
    </div>
  );
};

/* ── Обзор ── */
const Overview = ({ me, go }: { me: K.Me; go: (s: Sec) => void }) => {
  const [st, setSt] = useState<K.Stats | null>(null);
  useEffect(() => { void K.kbOverview().then((r) => { if (r.ok) setSt(r.data.stats); }); }, []);
  const steps = [
    { done: Boolean(me.requisites), text: 'Указать реквизиты для переводов', to: 'req' as Sec },
    { done: me.subscription.active, text: `Оформить подписку — ${me.subscription.priceRub} ₽ в месяц`, to: 'sub' as Sec },
    { done: me.business?.status === 'active', text: 'Опубликовать бизнес', to: 'req' as Sec },
    { done: (st?.qr ?? 0) > 0, text: 'Создать первый QR-код', to: 'qr' as Sec },
  ];
  const exportCsv = async () => {
    const b = await K.kbExportCsv(); if (!b) { flash('Не удалось выгрузить'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'skykassa-payments.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  return (
    <div className="space-y-4">
      {steps.some((s) => !s.done) && (
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-sm font-bold mb-2" style={{ color: 'var(--t1)' }}>Что осталось до приёма оплаты</p>
          {steps.map((s) => (
            <button key={s.text} type="button" onClick={() => go(s.to)} className="flex w-full items-center gap-2 py-1.5 text-left text-sm" style={{ color: s.done ? 'var(--t3)' : 'var(--t1)' }}>
              <span className="grid h-5 w-5 place-items-center rounded-full text-[10px]" style={{ background: s.done ? 'var(--green)' : 'var(--bg-l3)', color: '#fff' }}>{s.done ? '✓' : ''}</span>{s.text}
            </button>
          ))}
        </div>
      )}
      {st && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat k="QR-кодов" v={st.qr} /><Stat k="Открытий страниц" v={st.opens} sub="уникальных за сутки" /><Stat k="Заявок" v={st.requests} /><Stat k="Ждут проверки" v={st.awaiting} />
          </div>
          <div className="rounded-2xl p-4" style={card}>
            <p className="text-sm font-bold mb-2" style={{ color: 'var(--t1)' }}>Суммы — по источнику</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat k="Заявлено покупателями" v={`${st.claimedSumRub} ₽`} sub="со слов покупателей" />
              <Stat k="Подтверждено владельцем" v={`${st.confirmedByOwnerSumRub} ₽`} sub={`${st.confirmed} заявок · подтверждение владельца`} />
              <Stat k="Подтверждено интеграцией" v={`${st.confirmedByIntegrationSumRub} ₽`} sub="платёжные партнёры пока не подключены" />
            </div>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Это учёт заявок, а не банковская выписка: Sky поступление денег не проверяет.</p>
          </div>
        </>
      )}
      <Btn small onClick={() => void exportCsv()}>Выгрузить заявки в CSV</Btn>
    </div>
  );
};

/* ── Заявки ── */
const FILTERS: [string, string][] = [['', 'Все'], ['reported', 'Сообщили об оплате'], ['pending_check', 'На проверке'], ['confirmed', 'Подтверждены'], ['not_found', 'Не обнаружены'], ['cancelled', 'Отменены'], ['refunded', 'Возвраты']];
const Payments = () => {
  const [f, setF] = useState(''); const [list, setList] = useState<K.Payment[] | null>(null); const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof K.kbPaymentLog>> | null>(null);
  const load = useCallback(async () => { const r = await K.kbPayments(f); if (r.ok) setList(r.data.payments); }, [f]);
  useEffect(() => { void load(); }, [load]);
  const act = async (p: K.Payment, action: string, needComment = false) => {
    let comment = '';
    if (needComment) { comment = window.prompt('Комментарий (обязательно):') ?? ''; if (comment.trim().length < 3) return; }
    else if (action === 'confirm' && !window.confirm(`Подтвердить, что вы получили ${p.amountRub} ₽ на свои реквизиты? Sky поступление не проверяет — это ваше подтверждение.`)) return;
    const r = await K.kbPaymentAct(p.id, action, comment); if (!r.ok) flash(why(r)); await load();
  };
  const show = async (id: string) => { if (open === id) { setOpen(null); return; } setOpen(id); setLog(await K.kbPaymentLog(id)); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ ...field, ...(f === k ? { border: '1px solid var(--accent)' } : {}) }}>{l}</button>)}</div>
      {!list ? <Loader2 className="animate-spin" size={16} /> : !list.length ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Заявок пока нет. Они появятся, когда покупатель нажмёт «Я перевёл деньги» на странице оплаты.</p> : list.map((p) => (
        <div key={p.id} className="rounded-2xl p-3" style={card}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-base font-black" style={{ color: 'var(--t1)' }}>{p.amountRub} ₽</p><p translate="no" className="text-[11px] truncate" style={{ color: 'var(--t3)' }}>{p.qrTitle ?? 'Без QR'}{p.orderNo ? ` · № ${p.orderNo}` : ''} · {dt(p.reportedAt ?? p.createdAt)}</p></div>
            <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold" style={{ background: 'var(--bg-l3)', color: p.status === 'confirmed' ? 'var(--green)' : 'var(--t2)' }}>{p.statusLabel}</span>
          </div>
          {p.buyerNote && <p translate="no" className="mt-1 text-xs" style={{ color: 'var(--t2)' }}>«{p.buyerNote}»</p>}
          {p.ownerComment && <p translate="no" className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>Ваш комментарий: {p.ownerComment}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.status === 'reported' && <Btn small onClick={() => void act(p, 'take')}>Взять на проверку</Btn>}
            {['reported', 'pending_check', 'not_found'].includes(p.status) && <Btn small tone="accent" onClick={() => void act(p, 'confirm')}>Подтвердить получение</Btn>}
            {['reported', 'pending_check'].includes(p.status) && <Btn small onClick={() => void act(p, 'not_found', true)}>Оплата не обнаружена</Btn>}
            {['reported', 'pending_check', 'not_found', 'created'].includes(p.status) && <Btn small tone="danger" onClick={() => void act(p, 'cancel', true)}>Отменить</Btn>}
            {p.status === 'confirmed' && <Btn small onClick={() => void act(p, 'refund', true)}>Отметить возврат</Btn>}
            <Btn small onClick={() => void show(p.id)}>{open === p.id ? 'Скрыть историю' : 'История'}</Btn>
          </div>
          {open === p.id && log && log.ok && <div className="mt-2 space-y-1">{log.data.log.map((l, i) => <p key={i} className="text-[11px]" style={{ color: 'var(--t3)' }}>{dt(l.at)} · {l.actor === 'buyer' ? 'покупатель' : l.actor === 'system' ? 'система' : 'владелец'}: {l.toLabel}{l.note ? ` — ${l.note}` : ''}</p>)}</div>}
        </div>
      ))}
    </div>
  );
};

/* ── QR-коды ── */
const QrView = ({ q, mode, onChange, bizName }: { q: K.Qr; mode: K.Mode; onChange: () => void; bizName: string }) => {
  const [svg, setSvg] = useState('');
  useEffect(() => { let a = true; void qrSvg(q.url, 200).then((s) => { if (a) setSvg(s); }); return () => { a = false; }; }, [q.url]);
  const set = async (status: string) => { if (status === 'archived' && !window.confirm('Убрать QR-код в архив? Страница перестанет открываться.')) return; const r = await K.kbQrStatus(q.id, status); if (!r.ok) flash(why(r)); onChange(); };
  return (
    <div className="rounded-2xl p-3 flex gap-3" style={card}>
      <div className="shrink-0 rounded-lg overflow-hidden self-start" style={{ width: 112, height: 112 }} dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="112" height="112"') }} />
      <div className="min-w-0 flex-1">
        <p translate="no" className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{q.title}{q.kind === 'permanent' ? ' · постоянный' : ''}</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>{q.amountRub != null ? `${q.amountRub} ₽` : 'Сумму вводит покупатель'}{q.expiresAt ? ` · до ${dt(q.expiresAt)}` : ''} · {q.status === 'active' ? 'включён' : q.status === 'disabled' ? 'отключён' : 'в архиве'}</p>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Открытий: {q.opens} · заявок: {q.requests} · подтверждено: {q.confirmed}</p>
        <p translate="no" className="mt-1 text-[11px] break-all" style={{ color: 'var(--t3)' }}>{q.url}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Btn small onClick={() => { void navigator.clipboard?.writeText(q.url).then(() => flash('Ссылка скопирована')); }}><Copy size={12} className="inline" /> Ссылка</Btn>
          <Btn small onClick={() => void downloadPng(q.url, `skykassa-${q.publicId}`)}><Download size={12} className="inline" /> PNG</Btn>
          <Btn small onClick={() => void downloadSvg(q.url, `skykassa-${q.publicId}`)}>SVG</Btn>
          <Btn small onClick={() => void printQr(q.url, bizName, mode === 'online' ? 'Оплата через SkyKassa' : 'Оплатить через SkyKassa — наведите камеру')}><Printer size={12} className="inline" /> Печать</Btn>
          {q.status === 'active' && <Btn small onClick={() => void set('disabled')}><Power size={12} className="inline" /> Отключить</Btn>}
          {q.status === 'disabled' && <Btn small onClick={() => void set('active')}>Включить</Btn>}
          {q.status !== 'archived' && <Btn small tone="danger" onClick={() => void set('archived')}><Archive size={12} className="inline" /> В архив</Btn>}
        </div>
      </div>
    </div>
  );
};
const Qrs = ({ me }: { me: K.Me }) => {
  const [list, setList] = useState<K.Qr[] | null>(null); const [form, setForm] = useState(false);
  const [f, setF] = useState({ title: '', amountRub: '', orderNo: '', description: '', instruction: '', expiresAt: '' });
  const load = useCallback(async () => { const r = await K.kbQrList(); if (r.ok) setList(r.data.qr); }, []);
  useEffect(() => { void load(); }, [load]);
  const mode = me.business?.mode ?? 'both'; const hasPerm = list?.some((q) => q.kind === 'permanent' && q.status !== 'archived');
  const create = async () => {
    const r = await K.kbQrCreate({ ...f, amountRub: f.amountRub || undefined, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : undefined });
    if (!r.ok) { flash(why(r)); return; } setForm(false); setF({ title: '', amountRub: '', orderNo: '', description: '', instruction: '', expiresAt: '' }); await load();
  };
  const perm = async () => { const r = await K.kbQrPermanent({ title: 'Оплата' }); if (!r.ok) flash(why(r)); await load(); };
  const needSub = !me.subscription.active;
  return (
    <div className="space-y-3">
      {needSub && <p className="rounded-xl p-3 text-xs" style={{ ...card, color: 'var(--amber)' }}>Подписка не активна: создавать новые QR-коды нельзя, существующие остаются в просмотре. Оформите подписку во вкладке «Подписка».</p>}
      <div className="flex flex-wrap gap-2">
        <Btn tone="accent" small onClick={() => setForm(!form)} disabled={needSub}><Plus size={13} className="inline" /> {mode === 'point' ? 'QR для платежа' : 'Платёжная ссылка и QR'}</Btn>
        {!hasPerm && <Btn small onClick={() => void perm()} disabled={needSub}>{mode === 'point' ? 'Постоянный QR для стойки' : 'Постоянный QR бизнеса'}</Btn>}
      </div>
      {form && (
        <div className="rounded-2xl p-3 space-y-2" style={card}>
          <In label="Название платежа" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={80} />
          <div className="grid gap-2 sm:grid-cols-3">
            <In label="Сумма, ₽ (пусто — вводит покупатель)" value={f.amountRub} onChange={(v) => setF({ ...f, amountRub: v.replace(/\D/g, '') })} max={7} />
            <In label="Номер заказа" value={f.orderNo} onChange={(v) => setF({ ...f, orderNo: v })} max={40} />
            <In label="Действует до" type="datetime-local" value={f.expiresAt} onChange={(v) => setF({ ...f, expiresAt: v })} />
          </div>
          <In label="Описание" value={f.description} onChange={(v) => setF({ ...f, description: v })} max={300} />
          <In label="Инструкция покупателю" value={f.instruction} onChange={(v) => setF({ ...f, instruction: v })} max={300} />
          <Btn tone="accent" small onClick={() => void create()} disabled={f.title.trim().length < 2}>Создать</Btn>
        </div>
      )}
      {!list ? <Loader2 className="animate-spin" size={16} /> : !list.length ? <p className="text-sm" style={{ color: 'var(--t3)' }}>QR-кодов пока нет.</p> : list.map((q) => <QrView key={q.id} q={q} mode={mode} bizName={me.business?.name ?? 'SkyKassa'} onChange={() => void load()} />)}
    </div>
  );
};

/* ── Реквизиты и публикация ── */
const Reqs = ({ me, reload }: { me: K.Me; reload: () => void }) => {
  const r0 = me.requisites;
  const [f, setF] = useState({ holder: r0?.holder ?? '', method: r0?.method ?? 'phone', value: r0?.value ?? '', bank: r0?.bank ?? '', extra: r0?.extra ?? '', purpose: r0?.purpose ?? '', instruction: r0?.instruction ?? '', twoFactorCode: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await K.kbSetRequisites(f); setBusy(false);
    if (!r.ok) { flash(why(r)); return; }
    flash('Реквизиты сохранены'); setF({ ...f, twoFactorCode: '' }); reload();
  };
  const pub = async (on: boolean) => { const r = await K.kbPublish(on); if (!r.ok) flash(why(r)); reload(); };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 space-y-3" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Реквизиты для прямых переводов</p>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Покупатель переводит деньги вам напрямую. Не указывайте и не просите PIN-код, CVV/CVC, пароли интернет-банка и коды из SMS — здесь они не нужны. Реквизиты хранятся зашифрованными, смена записывается в журнал.</p>
        <In label="Имя получателя" value={f.holder} onChange={(v) => setF({ ...f, holder: v })} />
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Способ
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as K.Requisites['method'] })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field}>
            <option value="phone">Номер телефона (СБП)</option><option value="account">Номер счёта</option><option value="card">Номер карты получателя</option><option value="other">Другое</option>
          </select>
        </label>
        <In label={f.method === 'phone' ? 'Номер телефона' : f.method === 'card' ? 'Номер карты (16 цифр)' : f.method === 'account' ? 'Номер счёта' : 'Реквизиты'} value={f.value} onChange={(v) => setF({ ...f, value: v })} max={64} />
        <In label="Банк" value={f.bank} onChange={(v) => setF({ ...f, bank: v })} max={80} />
        <In label="БИК, корр. счёт, ИНН — если нужно" value={f.extra} onChange={(v) => setF({ ...f, extra: v })} max={200} />
        <In label="Назначение платежа" value={f.purpose} onChange={(v) => setF({ ...f, purpose: v })} max={140} />
        <In label="Инструкция покупателю" value={f.instruction} onChange={(v) => setF({ ...f, instruction: v })} max={400} />
        <In label="Код аутентификатора (если он включён в Sky ID)" value={f.twoFactorCode} onChange={(v) => setF({ ...f, twoFactorCode: v })} max={16} />
        <Btn tone="accent" onClick={() => void save()} disabled={busy || !f.holder || !f.value}>{busy ? 'Сохраняю…' : 'Сохранить реквизиты'}</Btn>
      </div>
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Публикация</p>
        <p className="text-xs mb-2" style={{ color: 'var(--t3)' }}>{me.business?.status === 'active' ? 'Бизнес опубликован: страницы оплаты открываются у покупателей (при действующей подписке).' : 'Пока бизнес скрыт: страницы оплаты не открываются.'}</p>
        {me.business?.status === 'active' ? <Btn small onClick={() => void pub(false)}>Скрыть бизнес</Btn> : <Btn small tone="accent" onClick={() => void pub(true)} disabled={!me.requisites}>Опубликовать</Btn>}
      </div>
    </div>
  );
};

/* ── Профиль бизнеса ── */
const Profile = ({ me, reload }: { me: K.Me; reload: () => void }) => {
  const b = me.business!;
  const [f, setF] = useState({ name: b.name, description: b.description, category: b.category, country: b.country, contacts: b.contacts, website: b.website, mode: b.mode, legalType: b.legalType });
  const save = async () => { const r = await K.kbUpdateBusiness(f); if (!r.ok) { flash(why(r)); return; } flash('Сохранено'); reload(); };
  const logo = (file: File | undefined) => {
    if (!file) return; if (file.size > 300 * 1024) { flash(REASON.logo_too_large); return; }
    const rd = new FileReader(); rd.onload = async () => { const r = await K.kbSetLogo(String(rd.result)); if (!r.ok) flash(why(r)); else { flash('Логотип обновлён'); reload(); } }; rd.readAsDataURL(file);
  };
  return (
    <div className="rounded-2xl p-4 space-y-3" style={card}>
      <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Данные бизнеса</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(MODE) as K.Mode[]).map((m) => <button key={m} type="button" aria-pressed={f.mode === m} onClick={() => setF({ ...f, mode: m })} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ ...field, ...(f.mode === m ? { border: '1px solid var(--accent)' } : {}) }}>{MODE[m].title}</button>)}
      </div>
      <In label="Название" value={f.name} onChange={(v) => setF({ ...f, name: v })} max={80} />
      <In label="Описание" value={f.description} onChange={(v) => setF({ ...f, description: v })} max={500} />
      <div className="grid gap-2 sm:grid-cols-2">
        <In label="Категория" value={f.category} onChange={(v) => setF({ ...f, category: v })} max={60} />
        <In label="Страна" value={f.country} onChange={(v) => setF({ ...f, country: v })} max={2} />
        <In label="Контакты" value={f.contacts} onChange={(v) => setF({ ...f, contacts: v })} max={200} />
        <In label="Сайт" value={f.website} onChange={(v) => setF({ ...f, website: v })} max={200} />
      </div>
      <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Тип деятельности (со слов владельца, не проверен)
        <select value={f.legalType} onChange={(e) => setF({ ...f, legalType: e.target.value as K.LegalType })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm" style={field}>
          {(Object.keys(LEGAL) as K.LegalType[]).map((k) => <option key={k} value={k}>{LEGAL[k]}</option>)}
        </select>
      </label>
      <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Логотип (PNG, JPEG, WebP до 300 КБ)
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => logo(e.target.files?.[0])} className="mt-1 block text-xs" />
      </label>
      <Btn tone="accent" onClick={() => void save()}>Сохранить</Btn>
    </div>
  );
};

/* ── Подписка ── */
const Subscription = ({ me, reload }: { me: K.Me; reload: () => void }) => {
  const [h, setH] = useState<Awaited<ReturnType<typeof K.kbSubscription>> | null>(null); const [busy, setBusy] = useState(false);
  const s = me.subscription;
  useEffect(() => { void K.kbSubscription().then(setH); }, [me.subscription.expiresAt]);
  const buy = async () => {
    if (!window.confirm(`Списать ${s.priceRub} ₽ с кошелька SkyMoney за ${s.periodDays} дней? Автоматического продления нет.`)) return;
    setBusy(true); const r = await K.kbBuySub(`sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); setBusy(false);
    if (!r.ok) { flash(why(r)); return; } void useMoney.getState().refresh(); flash('Подписка оплачена'); reload();
  };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>SkyKassa Business — {s.priceRub} ₽ в месяц</p>
        <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Комиссии Sky с ваших продаж — 0 ₽. Оплата с кошелька SkyMoney на {s.periodDays} дней, продление вручную: срок прибавляется к текущему.</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--t1)' }}>Статус: <b>{SUB[s.status] ?? s.status}</b>{s.expiresAt ? ` · до ${dt(s.expiresAt)}` : ''}</p>
        <div className="mt-3"><Btn tone="accent" onClick={() => void buy()} disabled={busy || s.status === 'suspended'}>{busy ? 'Оплачиваю…' : s.active ? 'Продлить на 30 дней' : 'Оформить подписку'}</Btn></div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Если подписка закончится, бизнес, реквизиты, заявки и история сохранятся: останутся просмотр и выгрузка, а создание новых QR-кодов и приём заявок покупателей приостановятся.</p>
      </div>
      {h && h.ok && h.data.history.length > 0 && <div className="rounded-2xl p-4" style={card}><p className="text-sm font-bold mb-2" style={{ color: 'var(--t1)' }}>История оплат подписки</p>{h.data.history.map((x) => <p key={x.id} className="text-xs py-1" style={{ color: 'var(--t2)' }}>{dt(x.at)} · {x.priceRub} ₽ · до {dt(x.expiresAt)}</p>)}</div>}
    </div>
  );
};

/* ── Журнал ── */
const Audit = () => {
  const [a, setA] = useState<K.AuditItem[] | null>(null);
  useEffect(() => { void K.kbAudit().then((r) => { if (r.ok) setA(r.data.audit); }); }, []);
  return <div className="rounded-2xl p-4" style={card}>{!a ? <Loader2 className="animate-spin" size={16} /> : !a.length ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Записей пока нет.</p> : a.map((x, i) => <p key={i} className="text-xs py-1.5" style={{ color: 'var(--t2)', borderBottom: '1px solid var(--border)' }}>{dt(x.at)} · <b>{AUDIT[x.action] ?? x.action}</b>{x.detail ? ` — ${x.detail}` : ''}</p>)}</div>;
};

type Sec = 'overview' | 'pay' | 'qr' | 'items' | 'orders' | 'shop' | 'tips' | 'inv' | 'req' | 'biz' | 'sub' | 'audit';
const NAV: { key: Sec; label: string; icon: typeof Store }[] = [
  { key: 'overview', label: 'Обзор', icon: LayoutDashboard }, { key: 'pay', label: 'Приём оплаты', icon: ListChecks }, { key: 'qr', label: 'QR-коды', icon: QrCode },
  { key: 'items', label: 'Каталог', icon: Package }, { key: 'orders', label: 'Заказы', icon: ShoppingBag }, { key: 'shop', label: 'Витрина', icon: Globe },
  { key: 'tips', label: 'Чаевые', icon: HeartHandshake }, { key: 'inv', label: 'Счета', icon: FileText },
  { key: 'req', label: 'Реквизиты', icon: Landmark }, { key: 'biz', label: 'Бизнес', icon: Store }, { key: 'sub', label: 'Подписка', icon: Wallet }, { key: 'audit', label: 'Журнал', icon: History },
];

export const KassaBusiness = () => {
  const userId = useAuthStore((s) => s.currentUserId);
  const [me, setMe] = useState<K.Me | null>(null); const [err, setErr] = useState(false); const [sec, setSec] = useState<Sec>('overview');
  const load = useCallback(async () => { const r = await K.kbMe(); if (r.ok) { setMe(r.data); setErr(false); } else setErr(true); }, []);
  useEffect(() => { if (userId) void load(); }, [userId, load]);
  if (err) return <div className="p-4 text-sm" style={{ color: 'var(--red)' }}>Не удалось загрузить. <button type="button" className="underline" onClick={() => void load()}>Повторить</button></div>;
  if (!me) return <div className="grid place-items-center py-16"><Loader2 className="animate-spin" size={20} style={{ color: 'var(--t3)' }} /></div>;
  if (!me.business) return <div className="h-full overflow-y-auto"><Setup onDone={() => void load()} /></div>;
  const b = me.business; const M = MODE[b.mode];
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}><M.icon size={20} style={{ color: 'var(--accent)' }} /></div>
          <div className="min-w-0"><p translate="no" className="text-base font-black truncate" style={{ color: 'var(--t1)' }}>{b.name}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{M.title} · {b.status === 'active' ? 'опубликован' : b.status === 'suspended' ? 'приостановлен' : 'скрыт'} · подписка: {SUB[me.subscription.status]}</p></div>
        </div>
        {b.status === 'suspended' && <p role="alert" className="mt-2 rounded-xl p-3 text-xs" style={{ ...card, color: 'var(--red)' }}><ShieldCheck size={13} className="inline" /> Бизнес приостановлен администрацией Sky{b.suspendedReason ? `: ${b.suspendedReason}` : ''}. История сохранена.</p>}
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {NAV.map((n) => <button key={n.key} type="button" aria-current={sec === n.key} onClick={() => setSec(n.key)} className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold" style={{ ...field, ...(sec === n.key ? { border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, var(--bg-l2))' } : {}) }}><n.icon size={13} />{n.label}</button>)}
        </div>
      </div>
      <div className="p-4 pt-2 pb-24">
        {sec === 'overview' && <Overview me={me} go={setSec} />}
        {sec === 'pay' && <Payments />}
        {sec === 'qr' && <Qrs me={me} />}
        {sec === 'items' && <Items />}
        {sec === 'orders' && <Orders />}
        {sec === 'shop' && <ShopSettings />}
        {sec === 'tips' && <Tips bizName={b.name} />}
        {sec === 'inv' && <Invoices bizName={b.name} />}
        {sec === 'req' && <Reqs me={me} reload={() => void load()} />}
        {sec === 'biz' && <Profile me={me} reload={() => void load()} />}
        {sec === 'sub' && <Subscription me={me} reload={() => void load()} />}
        {sec === 'audit' && <Audit />}
        <p className="mt-6 text-[11px]" style={{ color: 'var(--t3)' }}>SkyKassa Business — программный инструмент учёта: Sky не принимает и не хранит деньги покупателей, не подтверждает банковские переводы и не заменяет кассовый чек. Статус «оплата подтверждена» ставит владелец.</p>
      </div>
    </div>
  );
};
