/* Вкладка «SkyKassa Business»: бизнесы, карточка (без реквизитов, секретов и контактов покупателей), приостановка и возобновление с причиной. Право `kassa_biz`. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as K from '@/kassabiz/api';
import { flash } from '@/shared/flash';

const SC = { draft: 'скрыт', active: 'опубликован', suspended: 'приостановлен' } as Record<string, string>;
const dt = (i?: string | null) => (i ? new Date(i).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const field = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;

const Card = ({ id, onChange, back }: { id: string; onChange: () => void; back: () => void }) => {
  const [c, setC] = useState<K.AdminCard | null>(null); const [reason, setReason] = useState('');
  const load = useCallback(async () => { const r = await K.kbAdminCard(id); if (r.ok) setC(r.data); }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (!c) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;
  const b = c.business;
  const act = async (a: 'suspend' | 'resume') => {
    if (reason.trim().length < 5) { flash('Напишите причину (не короче 5 знаков).'); return; }
    if (!window.confirm(a === 'suspend' ? 'Приостановить бизнес? Страницы оплаты и витрина закроются, владелец получит причину.' : 'Снять приостановку? Бизнес станет «скрыт», владелец сам опубликует его.')) return;
    const r = await K.kbAdminAct(id, a, reason); if (!r.ok) { flash('Не получилось.'); return; }
    setReason(''); void load(); onChange();
  };
  return (
    <div className="space-y-3">
      <button type="button" className="text-xs underline" onClick={back}>← К списку</button>
      <div className="rounded-2xl p-4" style={card}>
        <p translate="no" className="text-base font-black" style={{ color: 'var(--t1)' }}>{b.name}</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>@<span translate="no">{b.owner}</span> · {SC[b.status] ?? b.status} · режим {b.mode} · статус деятельности со слов владельца: {b.legalType} (не проверен)</p>
        <p className="text-xs mt-1" style={{ color: 'var(--t2)' }}>Подписка: {c.subscription.status}{c.subscription.expiresAt ? ` до ${dt(c.subscription.expiresAt)}` : ''} · подтверждено владельцем: {c.payments.by_owner}, партнёром: {c.payments.by_provider}, «не обнаружено»: {c.payments.not_found}</p>
        {c.provider && <p className="text-xs" style={{ color: 'var(--t2)' }}>Платёжный партнёр: <span translate="no">{c.provider.host}</span> ({c.provider.enabled ? 'включён' : 'выключен'}){c.provider.lastError ? `, ошибка: ${c.provider.lastError}` : ''}</p>}
        {b.shopSlug && <p className="text-xs" style={{ color: 'var(--t2)' }}>Витрина: <span translate="no">/s/{b.shopSlug}</span> ({b.shopEnabled ? 'включена' : 'выключена'})</p>}
        {b.suspendedReason && <p className="text-xs mt-1" style={{ color: 'var(--red)' }}>Причина приостановки: {b.suspendedReason}</p>}
        <div className="mt-3 flex gap-2">
          <input aria-label="Причина" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Причина (видна владельцу)" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={field} />
          {b.status === 'suspended'
            ? <button type="button" onClick={() => void act('resume')} className="rounded-xl px-3 py-2 text-sm font-semibold" style={field}>Возобновить</button>
            : <button type="button" onClick={() => void act('suspend')} className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--red) 14%, transparent)', color: 'var(--red)' }}>Приостановить</button>}
        </div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Реквизиты, контакты покупателей и секреты провайдера администрации не показываются. Проверка документов бизнеса вручную, реестры не подключены.</p>
      </div>
      <div className="rounded-2xl p-4" style={card}>
        <p className="text-xs font-bold mb-1" style={{ color: 'var(--t2)' }}>Журнал бизнеса</p>
        {c.audit.map((a, i) => <p key={i} translate="no" className="text-[11px] py-1" style={{ color: 'var(--t2)', borderBottom: '1px solid var(--border)' }}>{dt(a.at)} · {a.action}{a.detail ? ` — ${a.detail}` : ''}</p>)}
      </div>
    </div>
  );
};

export const KbizAdminTab = () => {
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [list, setList] = useState<K.AdminBiz[] | null>(null); const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await K.kbAdminList(q, st); if (r.ok) setList(r.data.businesses); }, [q, st]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  if (open) return <Card id={open} back={() => setOpen(null)} onChange={() => void load()} />;
  return (
    <div className="space-y-3 p-1">
      <div className="flex gap-2">
        <input aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, @username или id" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={field} />
        <select aria-label="Статус" value={st} onChange={(e) => setSt(e.target.value)} className="rounded-lg px-2 py-2 text-sm" style={field}><option value="">Все</option><option value="active">Опубликованные</option><option value="draft">Скрытые</option><option value="suspended">Приостановленные</option></select>
      </div>
      {!list ? <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div> : !list.length ? <p className="text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено.</p> : list.map((b) => (
        <button key={b.id} type="button" onClick={() => setOpen(b.id)} className="block w-full rounded-2xl p-3 text-left" style={card}>
          <p translate="no" className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{b.name} <span className="font-normal" style={{ color: 'var(--t3)' }}>@{b.owner}</span></p>
          <p className="text-[11px]" style={{ color: b.status === 'suspended' ? 'var(--red)' : 'var(--t3)' }}>{SC[b.status] ?? b.status} · заявок {b.requests} · подтверждено {b.confirmedSumRub} ₽ · сотрудников {b.staff}{b.hasProvider ? ' · партнёр' : ''} · подписка {b.subUntil ? `до ${dt(b.subUntil)}` : 'не оформлена'}</p>
        </button>
      ))}
    </div>
  );
};
